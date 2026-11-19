import { tool } from 'ai';
import { z } from 'zod';
import { errMsg } from '../http';
import { redactSecrets, validatePushFiles, validatePath } from '../security';

interface GhCfg {
  token: string;
  repo: string;
  branch: string;
}

function ghConfig(): GhCfg {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  if (!token || !repo) throw new Error('GitHub is not configured: set GITHUB_TOKEN and GITHUB_REPO.');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('GITHUB_REPO must look like owner/name.');
  return { token, repo, branch };
}

async function gh(path: string, init: { method?: string; body?: string } = {}): Promise<unknown> {
  const { token } = ghConfig();
  const res = await fetch('https://api.github.com' + path, {
    method: init.method ?? 'GET',
    body: init.body,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(25000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error('GitHub ' + res.status + ': ' + redactSecrets(text).slice(0, 300));
  return text ? (JSON.parse(text) as unknown) : null;
}

export const listRepoFiles = tool({
  description: 'List file paths in the agent repository, optionally under a folder prefix such as "lib/" or "components/".',
  inputSchema: z.object({ prefix: z.string().max(200).optional() }),
  execute: async ({ prefix }) => {
    try {
      const { repo, branch } = ghConfig();
      const data = (await gh('/repos/' + repo + '/git/trees/' + encodeURIComponent(branch) + '?recursive=1')) as {
        tree: { path: string; type: string }[];
        truncated?: boolean;
      };
      const p = prefix ?? '';
      const files = data.tree.filter((t) => t.type === 'blob' && t.path.startsWith(p)).map((t) => t.path);
      return { ok: true, count: files.length, files: files.slice(0, 400), truncated: files.length > 400 || data.truncated === true };
    } catch (e) {
      return { ok: false, error: redactSecrets(errMsg(e)) };
    }
  },
});

export const readRepoFile = tool({
  description: 'Read one text file from the agent repository (max ~60,000 characters returned).',
  inputSchema: z.object({ path: z.string().min(1).max(200) }),
  execute: async ({ path }) => {
    try {
      const v = validatePath(path);
      if (!v.ok) return { ok: false, error: v.reason };
      const { repo, branch } = ghConfig();
      const data = (await gh('/repos/' + repo + '/contents/' + path.split('/').map(encodeURIComponent).join('/') + '?ref=' + encodeURIComponent(branch))) as {
        content?: string;
        encoding?: string;
        size?: number;
        type?: string;
      };
      if (data.type !== 'file' || data.encoding !== 'base64' || typeof data.content !== 'string') {
        return { ok: false, error: 'Not a readable text file (directory or larger than 1 MB).' };
      }
      const text = Buffer.from(data.content, 'base64').toString('utf8');
      return { ok: true, path, size: data.size ?? text.length, truncated: text.length > 60000, content: text.slice(0, 60000) };
    } catch (e) {
      return { ok: false, error: redactSecrets(errMsg(e)) };
    }
  },
});

export const pushToGitHubRepo = tool({
  description:
    'Create ONE atomic commit with several files on the agent repository. Provide the COMPLETE final content of every written file (no placeholders, no "rest unchanged"). Requires explicit user approval.',
  inputSchema: z.object({
    message: z.string().min(3).max(200),
    files: z
      .array(
        z.object({
          path: z.string().min(1).max(200),
          action: z.enum(['write', 'delete']).default('write'),
          content: z.string().max(200000).optional(),
        }),
      )
      .min(1)
      .max(30),
  }),
  execute: async (input) => {
    try {
      const verdict = validatePushFiles(input.files);
      if (!verdict.ok) return { pushed: false, error: verdict.reason };
      const { repo, branch } = ghConfig();
      const ref = (await gh('/repos/' + repo + '/git/ref/heads/' + encodeURIComponent(branch))) as { object: { sha: string } };
      const parent = (await gh('/repos/' + repo + '/git/commits/' + ref.object.sha)) as { tree: { sha: string } };
      const entries = input.files.map((f) =>
        f.action === 'delete'
          ? { path: f.path, mode: '100644', type: 'blob', sha: null }
          : { path: f.path, mode: '100644', type: 'blob', content: f.content ?? '' },
      );
      const tree = (await gh('/repos/' + repo + '/git/trees', {
        method: 'POST',
        body: JSON.stringify({ base_tree: parent.tree.sha, tree: entries }),
      })) as { sha: string };
      const commit = (await gh('/repos/' + repo + '/git/commits', {
        method: 'POST',
        body: JSON.stringify({ message: input.message, tree: tree.sha, parents: [ref.object.sha] }),
      })) as { sha: string; html_url?: string };
      await gh('/repos/' + repo + '/git/refs/heads/' + encodeURIComponent(branch), {
        method: 'PATCH',
        body: JSON.stringify({ sha: commit.sha }),
      });
      return { pushed: true, branch, commit: commit.sha, url: commit.html_url ?? '', files: input.files.length };
    } catch (e) {
      return { pushed: false, error: redactSecrets(errMsg(e)) };
    }
  },
});

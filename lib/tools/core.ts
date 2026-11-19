import { generateText, tool } from 'ai';
import { z } from 'zod';
import { getChain } from '../failover';
import { errMsg } from '../http';
import { redactSecrets } from '../security';

export const saveMemoryFact = tool({
  description: 'Save ONE durable fact or preference about the user to long-term memory (for example language, stack, goals). Never save secrets or one-off details.',
  inputSchema: z.object({
    fact: z.string().min(3).max(300),
    tag: z.enum(['preference', 'project', 'profile', 'other']).default('other'),
  }),
  execute: async ({ fact, tag }) => {
    if (redactSecrets(fact) !== fact) return { saved: false, error: 'Refused: the text looks like a secret.' };
    return { saved: true, id: crypto.randomUUID(), fact, tag, ts: Date.now() };
  },
});

export const renderMultiFileWorkspace = tool({
  description: 'Show generated files to the user in the multi-file workspace with copy buttons and a live preview for HTML/React. Use after producing code.',
  inputSchema: z.object({
    title: z.string().min(1).max(80),
    files: z.array(z.object({ path: z.string().min(1).max(200), content: z.string().max(100000) })).min(1).max(20),
  }),
  execute: async ({ title, files }) => ({ title, files }),
});

const CODER_PROMPT = [
  'You are the Coder Worker of a hybrid multi-agent system.',
  'Return ONLY one JSON object, no markdown fences, with this exact shape:',
  '{"files":[{"path":"relative/path.ext","content":"full file content"}],"notes":"one or two sentences"}',
  'Rules:',
  '- Every file must be COMPLETE and runnable. No placeholders, no ellipses, no "rest unchanged".',
  '- TypeScript strict mode, Next.js App Router, React 19, Tailwind CSS v4 unless told otherwise.',
  '- Never include secrets, API keys or .env files. Read secrets from process.env only on the server.',
  '- Never modify lib/auth.ts, lib/security.ts, app/api/auth, app/api/settings or .github.',
  '- Every app/api/**/route.ts must call requireAuth(req) from @/lib/auth first.',
  '- Keep the answer under about 400 lines of code in total; split big work into several files.',
].join('\n');

interface CoderFile {
  path: string;
  content: string;
}

function parseCoderOutput(text: string): { files: CoderFile[]; notes: string } | null {
  let t = text.trim();
  if (t.startsWith('```')) t = t.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const data = JSON.parse(t.slice(start, end + 1)) as { files?: unknown; notes?: unknown };
    if (!Array.isArray(data.files)) return null;
    const files: CoderFile[] = [];
    for (const f of data.files as unknown[]) {
      const item = f as { path?: unknown; content?: unknown };
      if (typeof item.path === 'string' && typeof item.content === 'string') files.push({ path: item.path, content: item.content });
    }
    if (files.length === 0) return null;
    return { files, notes: typeof data.notes === 'string' ? data.notes : '' };
  } catch {
    return null;
  }
}

export const delegateToCoderWorker = tool({
  description:
    'Delegate code generation to the Coder Worker (separate model chain). Use for anything over ~80 lines or more than one file. Pass existing file contents in context when editing.',
  inputSchema: z.object({
    task: z.string().min(10).max(4000),
    context: z.string().max(40000).optional(),
  }),
  execute: async ({ task, context }) => {
    const chain = getChain('coder', false);
    if (chain.length === 0) return { ok: false, error: 'No coder model configured: set GEMINI_API_KEY, OPENROUTER_API_KEY or GROQ_API_KEY.' };
    const prompt = 'TASK:\n' + task + (context ? '\n\nEXISTING CODE / CONTEXT:\n' + context : '');
    let lastError = 'Unknown error';
    for (const node of chain) {
      try {
        const result = await generateText({
          model: node.create(),
          instructions: CODER_PROMPT,
          prompt,
          maxOutputTokens: 12000,
          timeout: { totalMs: 150000 },
        });
        const parsed = parseCoderOutput(result.text);
        if (parsed) return { ok: true, node: node.label, files: parsed.files, notes: parsed.notes };
        lastError = node.label + ' returned output that is not valid JSON.';
      } catch (e) {
        lastError = node.label + ': ' + errMsg(e);
      }
    }
    return { ok: false, error: redactSecrets(lastError) };
  },
});

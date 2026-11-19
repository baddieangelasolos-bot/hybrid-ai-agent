import { tool } from 'ai';
import { z } from 'zod';
import { errMsg } from '../http';
import { redactSecrets } from '../security';
import { deploymentLogLines, latestDeployments, triggerRedeploy as redeploy } from '../vercel';

export const checkVercelDeployment = tool({
  description: 'Show the latest Vercel deployments of THIS project. If the newest one failed, include the last build log lines so the error can be fixed.',
  inputSchema: z.object({ includeLogs: z.boolean().default(true) }),
  execute: async ({ includeLogs }) => {
    try {
      const deployments = await latestDeployments(3);
      if (deployments.length === 0) return { ok: true, deployments: [], note: 'No deployments yet.' };
      const newest = deployments[0];
      const failed = newest.state === 'ERROR' || newest.state === 'CANCELED';
      const logs = includeLogs && (failed || newest.state === 'BUILDING') ? await deploymentLogLines(newest.id) : [];
      return { ok: true, deployments, logs };
    } catch (e) {
      return { ok: false, error: redactSecrets(errMsg(e)) };
    }
  },
});

export const triggerRedeploy = tool({
  description: 'Redeploy this project on Vercel (for example after environment variables changed). Requires explicit user approval.',
  inputSchema: z.object({ reason: z.string().max(200).default('manual redeploy') }),
  execute: async () => redeploy(),
});

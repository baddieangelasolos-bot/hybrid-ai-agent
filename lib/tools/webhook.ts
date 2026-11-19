import { tool } from 'ai';
import { z } from 'zod';
import { webhookEnvFor } from '../connectors/registry';
import { errMsg } from '../http';
import { assertSafeWebhookUrl, redactSecrets } from '../security';

export const callWebhookConnector = tool({
  description:
    'POST a JSON payload to a configured automation webhook. connectorId is "make", "n8n" or "custom:<id>". Use only when the user asked for the automation.',
  inputSchema: z.object({
    connectorId: z.string().regex(/^(make|n8n|custom:[a-z0-9_]{1,30})$/),
    payload: z.record(z.string(), z.unknown()),
  }),
  execute: async ({ connectorId, payload }) => {
    try {
      const envNames = webhookEnvFor(connectorId);
      if (!envNames) return { ok: false, error: 'Unknown connector.' };
      const target = process.env[envNames.url];
      if (!target) return { ok: false, error: 'Connector is not configured (' + envNames.url + ' is missing).' };
      const url = await assertSafeWebhookUrl(target);
      const body = JSON.stringify(payload);
      if (body.length > 100000) return { ok: false, error: 'Payload larger than 100 KB.' };
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const key = envNames.key ? process.env[envNames.key] : undefined;
      if (key) headers.Authorization = 'Bearer ' + key;
      const res = await fetch(url, { method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(20000) });
      const text = await res.text();
      return { ok: res.ok, status: res.status, response: redactSecrets(text).slice(0, 4000) };
    } catch (e) {
      return { ok: false, error: redactSecrets(errMsg(e)) };
    }
  },
});

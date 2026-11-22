import { tool } from 'ai';
import { z } from 'zod';
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

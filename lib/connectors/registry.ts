import type { Permission } from '../types';

export type Category = 'AI Models' | 'Productivity' | 'Development' | 'Automation' | 'Media';
export type ConnectMethod = 'token' | 'webhook' | 'oauth-google';
export type ToolRisk = 'read' | 'write' | 'critical';

export interface EnvField {
  env: string;
  label: string;
  secret: boolean;
  placeholder: string;
  help: string;
  optional?: boolean;
}

export interface ToolDef {
  name: string;
  risk: ToolRisk;
}

export interface ConnectorDef {
  id: string;
  name: string;
  category: Category;
  description: string;
  status: 'active' | 'planned';
  method: ConnectMethod;
  fields: EnvField[];
  defaultPermission: Permission;
  tools: ToolDef[];
  docsUrl: string;
  accent: string;
}

export const CATEGORIES: Category[] = ['AI Models', 'Productivity', 'Development', 'Automation', 'Media'];

export const CONNECTORS: ConnectorDef[] = [
  {
    id: 'ai_models',
    name: 'AI Models (Google + Groq)',
    category: 'AI Models',
    description: 'The brains. Google AI Studio powers the specialist agents, Groq powers the lead orchestrator. Both are free; add both for automatic failover.',
    status: 'active',
    method: 'token',
    fields: [
      { env: 'GEMINI_API_KEY', label: 'Google AI Studio key', secret: true, placeholder: 'AIza...', help: 'aistudio.google.com > Get API key (free, no card).' },
      { env: 'GROQ_API_KEY', label: 'Groq key', secret: true, placeholder: 'gsk_...', help: 'console.groq.com > API Keys (free).' },
      { env: 'OPENROUTER_API_KEY', label: 'OpenRouter key (optional)', secret: true, placeholder: 'sk-or-...', help: 'Optional third provider with free models.', optional: true },
    ],
    defaultPermission: 'always',
    tools: [],
    docsUrl: 'https://aistudio.google.com/apikey',
    accent: '#7c8cff',
  },
  {
    id: 'image_gen',
    name: 'Image Generation',
    category: 'Media',
    description: 'Free image generators for the Image Studio agent. Cloudflare is the best free option; Hugging Face is a second fallback; Pollinations needs no key.',
    status: 'active',
    method: 'token',
    fields: [
      { env: 'CLOUDFLARE_ACCOUNT_ID', label: 'Cloudflare Account ID', secret: false, placeholder: '32-character id', help: 'dash.cloudflare.com > Workers AI (the id is in the URL and on the overview page).' },
      { env: 'CLOUDFLARE_API_TOKEN', label: 'Cloudflare API token', secret: true, placeholder: 'token', help: 'My Profile > API Tokens > Create Token > template "Workers AI".' },
      { env: 'HF_TOKEN', label: 'Hugging Face token', secret: true, placeholder: 'hf_...', help: 'huggingface.co/settings/tokens (Read, free).', optional: true },
    ],
    defaultPermission: 'always',
    tools: [],
    docsUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    accent: '#e879f9',
  },
  {
    id: 'google_drive',
    name: 'Google Drive',
    category: 'Productivity',
    description: 'Cloud sync for memory, threads and artifacts. Falls back to local backup if Drive is unavailable.',
    status: 'active',
    method: 'oauth-google',
    fields: [
      { env: 'GOOGLE_CLIENT_ID', label: 'OAuth Client ID', secret: false, placeholder: '1234-abc.apps.googleusercontent.com', help: 'Google Cloud Console > Credentials > OAuth client ID (Web application).' },
      { env: 'GOOGLE_CLIENT_SECRET', label: 'OAuth Client Secret', secret: true, placeholder: 'GOCSPX-...', help: 'Shown once when you create the OAuth client.' },
    ],
    defaultPermission: 'always',
    tools: [],
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
    accent: '#34d399',
  },
  {
    id: 'gmail',
    name: 'Gmail',
    category: 'Productivity',
    description: 'Read and draft email. Needs restricted Google scopes, so it is not implemented yet.',
    status: 'planned',
    method: 'oauth-google',
    fields: [],
    defaultPermission: 'ask',
    tools: [],
    docsUrl: 'https://developers.google.com/gmail/api',
    accent: '#f87171',
  },
  {
    id: 'google_calendar',
    name: 'Google Calendar',
    category: 'Productivity',
    description: 'Read and create calendar events. Planned.',
    status: 'planned',
    method: 'oauth-google',
    fields: [],
    defaultPermission: 'ask',
    tools: [],
    docsUrl: 'https://developers.google.com/calendar/api',
    accent: '#60a5fa',
  },
  {
    id: 'web',
    name: 'Web Search & Reader',
    category: 'Productivity',
    description: 'Live search through Tavily and clean page reading through Jina Reader (free).',
    status: 'active',
    method: 'token',
    fields: [
      { env: 'TAVILY_API_KEY', label: 'Tavily API key', secret: true, placeholder: 'tvly-...', help: 'app.tavily.com > API Keys (free plan). Page reading works without a key, search needs it.' },
    ],
    defaultPermission: 'always',
    tools: [
      { name: 'webSearch', risk: 'read' },
      { name: 'readWebPage', risk: 'read' },
    ],
    docsUrl: 'https://app.tavily.com',
    accent: '#22d3ee',
  },
  {
    id: 'github',
    name: 'GitHub',
    category: 'Development',
    description: 'Read the repo and push reviewed multi-file commits. Every push needs your approval.',
    status: 'active',
    method: 'token',
    fields: [
      { env: 'GITHUB_TOKEN', label: 'Fine-grained token', secret: true, placeholder: 'github_pat_...', help: 'GitHub > Settings > Developer settings > Fine-grained tokens. Only this repo, Contents: Read and write.' },
      { env: 'GITHUB_REPO', label: 'Repository', secret: false, placeholder: 'your-username/hybrid-ai-agent', help: 'owner/name of the agent repo.' },
      { env: 'GITHUB_BRANCH', label: 'Branch', secret: false, placeholder: 'main', help: 'Branch the agent commits to. Use a separate branch to get Vercel preview builds first.', optional: true },
    ],
    defaultPermission: 'ask',
    tools: [
      { name: 'listRepoFiles', risk: 'read' },
      { name: 'readRepoFile', risk: 'read' },
      { name: 'pushToGitHubRepo', risk: 'critical' },
    ],
    docsUrl: 'https://github.com/settings/personal-access-tokens/new',
    accent: '#a78bfa',
  },
  {
    id: 'vercel',
    name: 'Vercel',
    category: 'Development',
    description: 'Check build logs, list env var names and trigger redeploys for this project only.',
    status: 'active',
    method: 'token',
    fields: [
      { env: 'VERCEL_TOKEN', label: 'Access token', secret: true, placeholder: 'Vercel access token', help: 'vercel.com/account/tokens. Scope it to the team that owns this project.' },
      { env: 'VERCEL_TEAM_ID', label: 'Team ID', secret: false, placeholder: 'team_...', help: 'Only needed when the project belongs to a team.', optional: true },
      { env: 'VERCEL_DEPLOY_HOOK_URL', label: 'Deploy hook URL', secret: true, placeholder: 'https://api.vercel.com/v1/integrations/deploy/...', help: 'Optional. Without it the app redeploys through the API.', optional: true },
    ],
    defaultPermission: 'always',
    tools: [
      { name: 'checkVercelDeployment', risk: 'read' },
      { name: 'triggerRedeploy', risk: 'critical' },
    ],
    docsUrl: 'https://vercel.com/account/tokens',
    accent: '#e5e7eb',
  },
  {
    id: 'neon',
    name: 'Neon Postgres',
    category: 'Development',
    description: 'Serverless Postgres for structured data. Planned.',
    status: 'planned',
    method: 'token',
    fields: [],
    defaultPermission: 'ask',
    tools: [],
    docsUrl: 'https://neon.tech',
    accent: '#4ade80',
  },
  {
    id: 'make',
    name: 'Make.com',
    category: 'Automation',
    description: 'Trigger a Make scenario through its Custom Webhook URL.',
    status: 'active',
    method: 'webhook',
    fields: [
      { env: 'MAKE_WEBHOOK_URL', label: 'Webhook URL', secret: true, placeholder: 'https://hook.make.com/...', help: 'Make > Scenario > Webhooks > Custom webhook > copy the address.' },
    ],
    defaultPermission: 'ask',
    tools: [{ name: 'callWebhookConnector', risk: 'write' }],
    docsUrl: 'https://www.make.com',
    accent: '#c084fc',
  },
  {
    id: 'n8n',
    name: 'n8n',
    category: 'Automation',
    description: 'Trigger an n8n workflow through its Webhook node URL.',
    status: 'active',
    method: 'webhook',
    fields: [
      { env: 'N8N_WEBHOOK_URL', label: 'Webhook URL', secret: true, placeholder: 'https://your-n8n.example.com/webhook/...', help: 'n8n > Webhook node > Production URL.' },
    ],
    defaultPermission: 'ask',
    tools: [{ name: 'callWebhookConnector', risk: 'write' }],
    docsUrl: 'https://n8n.io',
    accent: '#fb7185',
  },
  {
    id: 'picsart',
    name: 'Picsart',
    category: 'Media',
    description: 'Image generation and editing through the Picsart API. Planned.',
    status: 'planned',
    method: 'token',
    fields: [],
    defaultPermission: 'ask',
    tools: [],
    docsUrl: 'https://picsart.io/',
    accent: '#f472b6',
  },
];

const EXTRA_ENV = [
  'GROQ_API_KEY',
  'GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
  'GROQ_MODEL',
  'GEMINI_MODEL',
  'OPENROUTER_MODEL',
  'AGENT_PRIMARY_GEMINI',
  'AGENT_PRIMARY_GROQ',
  'POLLINATIONS_TOKEN',
  'GOOGLE_REFRESH_TOKEN',
  'GOOGLE_DRIVE_FOLDER_NAME',
];

const PLAIN_ENV = new Set<string>([
  'GITHUB_REPO',
  'GITHUB_BRANCH',
  'VERCEL_TEAM_ID',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_DRIVE_FOLDER_NAME',
  'GROQ_MODEL',
  'GEMINI_MODEL',
  'OPENROUTER_MODEL',
]);

export function isPlainEnv(name: string): boolean {
  return PLAIN_ENV.has(name);
}

export function knownEnvNames(): Set<string> {
  const names = new Set<string>(EXTRA_ENV);
  for (const c of CONNECTORS) for (const f of c.fields) names.add(f.env);
  return names;
}

export function getConnector(id: string): ConnectorDef | undefined {
  return CONNECTORS.find((c) => c.id === id);
}

export function requiredEnv(def: ConnectorDef): string[] {
  const names = def.fields.filter((f) => !f.optional).map((f) => f.env);
  if (def.id === 'google_drive') names.push('GOOGLE_REFRESH_TOKEN');
  return names;
}

export function webhookEnvFor(connectorId: string): { url: string; key?: string } | null {
  if (connectorId === 'make') return { url: 'MAKE_WEBHOOK_URL' };
  if (connectorId === 'n8n') return { url: 'N8N_WEBHOOK_URL' };
  const m = connectorId.match(/^custom:([a-z0-9_]{1,30})$/);
  if (m) {
    const id = m[1].toUpperCase();
    return { url: 'CUSTOM_' + id + '_URL', key: 'CUSTOM_' + id + '_KEY' };
  }
  return null;
}

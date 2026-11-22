# Hybrid AI Agent

A private, installable (PWA) multi-agent AI assistant that runs on Vercel's free tier. A fast Groq **Lead Orchestrator** answers directly; specialist agents (Coder, Researcher, Reasoner, Writer, Vision & Docs, Study Tutor, Image Studio, Quick) run on Google Gemini 4 Hydrogen first, each with its own automatic fallback chain across Google, Groq and OpenRouter. Connectors let the agent read and improve its own GitHub repo, check Vercel builds, search the web and call automation webhooks.

**Pages:** Chat, History (search, pin, branches), Agents (fallback chains), Health (free model/quota status), Settings (light/dark, accent, voice, privacy, data, install). Every message has a 3-dot menu: edit, retry (or retry with another model), branch, copy, read aloud, delete. Incognito chats are never saved.

## What is inside

| Area | What it does |
| --- | --- |
| `app/api/chat` | Streams the agent (AI SDK 7 `ToolLoopAgent`, max 8 steps, 300s window) |
| `lib/models.ts`, `lib/agents.ts` | Every model and each agent's ordered fallback chain (edit here to reorder) |
| `lib/failover.ts` | Quota ledger, first-token timeout, empty-reply detection, per-model thinking level, token-limit aware chain building |
| `lib/router.ts` | Free instant intent routing: plain chat stays on the Groq orchestrator, tasks go to a specialist |
| `app/api/health/models` | Zero-token health check (reads provider model lists only) |
| `app/api/transcribe` | Voice and audio files: Groq Whisper, Gemini fallback |
| `lib/tools/*` | GitHub (read + approved commits), Vercel (build logs, redeploy), web search/read, webhooks |
| `lib/security.ts` | Code-level guard: protected files, no auth removal, SSRF-safe webhooks, secret redaction |
| `lib/storage.ts` + `lib/drive.ts` | Google Drive first, IndexedDB fallback, self-healing sync queue |
| `components/ConnectorsDrawer.tsx` | Connector marketplace, OAuth/token prompts, custom connectors |

## Deploy

1. Import this repo in Vercel (Framework: Next.js, Node 22+).
2. Add the environment variables below (Project -> Settings -> Environment Variables).
3. Redeploy and open the site. Sign in with `APP_PASSWORD`.

## Environment variables

| Name | Required | Notes |
| --- | --- | --- |
| `APP_PASSWORD` | yes | At least 8 characters. Protects every route. |
| `GROQ_API_KEY` | one of Groq/Gemini | console.groq.com -> API Keys (free) |
| `GEMINI_API_KEY` | one of Groq/Gemini | aistudio.google.com -> Get API key (free tier). Needed for image input. |
| `GITHUB_TOKEN` | for self-editing | Fine-grained token, this repo only, Contents: Read and write |
| `GITHUB_REPO` | for self-editing | `owner/name` |
| `GITHUB_BRANCH` | optional | Defaults to `main`. Use another branch to get Vercel preview builds first. |
| `VERCEL_TOKEN` | for build checks and in-app secrets | vercel.com/account/tokens |
| `VERCEL_TEAM_ID` | team projects | `team_...` |
| `VERCEL_DEPLOY_HOOK_URL` | optional | Otherwise the app redeploys through the API |
| `OPENROUTER_API_KEY` | optional | Third fallback model (free `:free` models) |
| `TAVILY_API_KEY` | optional | Web search (free plan) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | for Drive sync | OAuth client (Web application) |
| `GOOGLE_REFRESH_TOKEN` | for Drive sync | Created by the Connect button, saved to Vercel automatically |
| `GOOGLE_DRIVE_FOLDER_NAME` | optional | Defaults to `Hybrid AI Agent - App Data` |
| `MAKE_WEBHOOK_URL`, `N8N_WEBHOOK_URL` | optional | Automation connectors |

`VERCEL_PROJECT_ID` and `VERCEL_DEPLOYMENT_ID` are provided by Vercel automatically.

## Google Drive sync (optional)

1. Google Cloud Console -> create a project -> enable the Google Drive API.
2. OAuth consent screen -> External -> add the scope `.../auth/drive.file` -> **Publish app** (otherwise refresh tokens expire after 7 days).
3. Credentials -> OAuth client ID -> Web application -> Authorized redirect URI: `https://YOUR-DOMAIN/api/oauth/google/callback`.
4. Put the Client ID and Secret in Vercel, redeploy, then open Connectors -> Google Drive -> Authorize.

The app only sees files it created (`drive.file` scope), so it makes its own folder. If Drive is unreachable or full it keeps working in Local Backup Mode and syncs the queue when Drive returns.

## Safety model

- Every API route requires the signed session cookie (`requireAuth`).
- Pushing to GitHub and redeploying always need your approval; connector permissions can only be made stricter than the server default.
- The agent cannot change `lib/auth.ts`, `lib/security.ts`, `app/api/auth`, `app/api/settings`, `app/api/oauth` or `.github`, and every new API route must call `requireAuth`.
- `/env NAME=value` in the chat saves a variable straight to Vercel and never reaches any AI model or chat history.
- Web content is treated as untrusted data.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in values
npm run dev
```


## v16 extras

| Name | Required | Notes |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | for best free images | Workers AI (FLUX.1 schnell, SDXL Lightning). Free daily allowance. |
| `HF_TOKEN` | optional | Hugging Face image fallback (free token) |
| `AGENT_PRIMARY_GEMINI` / `AGENT_PRIMARY_GROQ` | no | Replace the first model of the specialist / orchestrator chains |

Install on a phone: open the site in Chrome, menu > Add to Home screen (iPhone: Share > Add to Home Screen).
Voice typing uses the browser speech engine by default; switch to Whisper (Groq) in Settings for better Bangla accuracy.

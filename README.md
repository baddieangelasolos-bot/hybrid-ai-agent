# Hybrid AI Agent

A self-evolving, multi-model AI agent that runs on Vercel's free tier. A fast orchestrator model plans and talks to you, a separate coder model writes code, and tool connectors let the agent read and improve its own GitHub repo, check Vercel builds, search the web and call automation webhooks.

## What is inside

| Area | What it does |
| --- | --- |
| `app/api/chat` | Streams the agent (AI SDK 7 `ToolLoopAgent`, max 8 steps, 300s window) |
| `lib/failover.ts` | Model chains: Groq `openai/gpt-oss-120b` -> Gemini -> OpenRouter (free) with a retry button |
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

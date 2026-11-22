import type { AgentId } from './agents';

export interface AgentSkill {
  id: string;
  command: string;
  label: string;
  hint: string;
  prompt: string;
  /** Agent that handles this command. */
  agent: AgentId;
}

export const SKILLS: AgentSkill[] = [
  { id: 'build', command: '/build', label: 'Build', hint: 'Design and generate a feature or app', agent: 'coder', prompt: 'Skill BUILD: clarify only if essential, write the complete files, show them with renderMultiFileWorkspace and offer to push them to GitHub.' },
  { id: 'fix', command: '/fix', label: 'Fix', hint: 'Find and fix a bug or build error', agent: 'coder', prompt: 'Skill FIX: use checkVercelDeployment for build errors, readRepoFile for the failing files, write the patch, then push it (after approval) and re-check the deployment.' },
  { id: 'review', command: '/review', label: 'Review', hint: 'Review code or a repo file', agent: 'coder', prompt: 'Skill REVIEW: read the relevant files with readRepoFile, then list concrete issues ordered by severity with a suggested fix for each.' },
  { id: 'deploy-check', command: '/deploy-check', label: 'Deploy check', hint: 'Inspect the latest Vercel deployment', agent: 'coder', prompt: 'Skill DEPLOY-CHECK: call checkVercelDeployment and summarise state, errors and the next step.' },
  { id: 'research', command: '/research', label: 'Research', hint: 'Search the web and summarise with sources', agent: 'researcher', prompt: 'Skill RESEARCH: run webSearch, read the 2-3 best pages with readWebPage, then answer with source URLs.' },
  { id: 'solve', command: '/solve', label: 'Solve', hint: 'Step-by-step math, logic or planning', agent: 'reasoner', prompt: 'Skill SOLVE: reason carefully, show the steps, verify the result.' },
  { id: 'plan', command: '/plan', label: 'Plan', hint: 'Break a goal into concrete steps', agent: 'reasoner', prompt: 'Skill PLAN: produce a short numbered plan with owners, risks and the first action.' },
  { id: 'write', command: '/write', label: 'Write', hint: 'Draft or rewrite text', agent: 'writer', prompt: 'Skill WRITE: produce the finished text first, then at most one line of notes.' },
  { id: 'image', command: '/image', label: 'Image', hint: 'Generate an image', agent: 'image', prompt: 'Skill IMAGE: call generateImage with a rich prompt built from the request.' },
  { id: 'study', command: '/study', label: 'Study', hint: 'Learn a topic with a tutor', agent: 'study', prompt: 'Skill STUDY: teach the topic in small steps and check understanding.' },
  { id: 'quiz', command: '/quiz', label: 'Quiz', hint: 'Make a quiz on any topic or notes', agent: 'study', prompt: 'Skill QUIZ: call makeQuiz with 6-8 varied questions, each with a short explanation.' },
  { id: 'fast', command: '/fast', label: 'Fast', hint: 'Instant short answer', agent: 'quick', prompt: 'Skill FAST: answer in one to three sentences.' },
];

export const CLIENT_COMMANDS: { command: string; hint: string }[] = [
  { command: '/env NAME=value', hint: 'Save an environment variable straight to Vercel (never sent to any AI model)' },
  { command: '/memory', hint: 'Show saved memory facts' },
  { command: '/incognito', hint: 'Start a private chat that is not saved' },
  { command: '/clear', hint: 'Start a new chat' },
];

export function detectSkill(text: string): { skill: AgentSkill | null; cleaned: string } {
  const trimmed = text.trim();
  for (const s of SKILLS) {
    if (trimmed === s.command || trimmed.startsWith(s.command + ' ')) {
      return { skill: s, cleaned: trimmed.slice(s.command.length).trim() };
    }
  }
  return { skill: null, cleaned: trimmed };
}

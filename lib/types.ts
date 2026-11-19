export type Permission = 'always' | 'ask' | 'blocked';
export type Persona = 'default' | 'coder' | 'researcher' | 'concise';

export interface WorkspaceFile {
  path: string;
  content: string;
}

export interface MemoryFact {
  id: string;
  fact: string;
  tag: string;
  ts: number;
}

export interface ThreadMeta {
  id: string;
  title: string;
  updatedAt: number;
}

export interface ChatRequestBody {
  messages: unknown;
  permissions?: Record<string, unknown>;
  persona?: string;
  memory?: unknown;
  nodeIndex?: number;
}

export type ApiOk<T> = { ok: true } & T;
export interface ApiFail {
  ok: false;
  code: string;
  message: string;
}

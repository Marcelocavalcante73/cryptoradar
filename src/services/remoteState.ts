/**
 * Sincronização do estado do usuário (carteiras simuladas, histórico, ajustes) com o SERVIDOR.
 *
 * O servidor é a fonte única: abrir o app no AI Studio, no Render ou em outro lugar mostra a mesma carteira
 * (desde que apontem para o mesmo armazenamento). Cada gravação carrega a data (`savedAt`); a cópia mais nova vence.
 * Sem conexão, o app continua funcionando e tenta de novo depois.
 */

import { localStore } from './localStore';

export type RemoteKey = 'paper-spot' | 'paper-futures' | 'settings';
export type SyncStatus = 'checking' | 'saved' | 'saving' | 'offline' | 'locked' | 'error';

export interface StorageInfo {
  backend: 'supabase' | 'file' | 'memory';
  persistent: boolean;
  keyRequired: boolean;
}

const ACCESS_KEY = 'cryptoradar_access_key';

export const accessKey = {
  get: (): string => localStore.get(ACCESS_KEY) ?? '',
  set: (v: string) => { localStore.set(ACCESS_KEY, v); },
  clear: () => localStore.remove(ACCESS_KEY)
};

/** Qual cópia vale: a do servidor ou a deste aparelho (a mais nova vence). */
export function decideSync(localSavedAt: number, remote: { savedAt: number; value: unknown } | null): 'use-remote' | 'push-local' | 'noop' {
  if (!remote || remote.value === null || remote.value === undefined) return localSavedAt > 0 ? 'push-local' : 'noop';
  if (remote.savedAt > localSavedAt) return 'use-remote';
  if (remote.savedAt < localSavedAt) return 'push-local';
  return 'noop';
}

const headers = (): Record<string, string> => {
  const k = accessKey.get();
  return { 'Content-Type': 'application/json', ...(k ? { 'X-Access-Key': k } : {}) };
};

import { safeReadJson } from './http';

export async function fetchStorageInfo(): Promise<StorageInfo | null> {
  try {
    const r = await fetch('/api/storage', { signal: AbortSignal.timeout(6000) });
    return await safeReadJson<StorageInfo | null>(r, null, '/api/storage');
  } catch {
    return null;
  }
}

export async function verifyAccessKey(candidate: string): Promise<boolean> {
  try {
    const r = await fetch('/api/access', { method: 'POST', headers: { 'X-Access-Key': candidate }, signal: AbortSignal.timeout(6000) });
    return r.ok;
  } catch {
    return false;
  }
}

export type PullResult =
  | { kind: 'ok'; value: unknown; savedAt: number }
  | { kind: 'locked' }
  | { kind: 'offline' };

export async function pullState(key: RemoteKey): Promise<PullResult> {
  try {
    const r = await fetch(`/api/state/${key}`, { headers: headers(), signal: AbortSignal.timeout(8000) });
    if (r.status === 401) return { kind: 'locked' };
    if (!r.ok) return { kind: 'offline' };
    const j = await safeReadJson<any>(r, null, `/api/state/${key}`);
    if (!j) return { kind: 'offline' };
    return { kind: 'ok', value: j.value ?? null, savedAt: Number(j.savedAt) || 0 };
  } catch {
    return { kind: 'offline' };
  }
}

export type PushResult =
  | { kind: 'ok' }
  | { kind: 'conflict'; value: unknown; savedAt: number }
  | { kind: 'locked' }
  | { kind: 'offline' }
  | { kind: 'error'; message: string };

export async function pushState(key: RemoteKey, value: unknown, savedAt: number): Promise<PushResult> {
  try {
    const r = await fetch(`/api/state/${key}`, { method: 'PUT', headers: headers(), body: JSON.stringify({ value, savedAt }), signal: AbortSignal.timeout(10000) });
    if (r.ok) return { kind: 'ok' };
    const j = await safeReadJson<any>(r, {}, `/api/state/${key}`);
    if (r.status === 401) return { kind: 'locked' };
    if (r.status === 409) return { kind: 'conflict', value: j.value, savedAt: Number(j.savedAt) || 0 };
    if (r.status >= 500) return { kind: 'offline' };
    return { kind: 'error', message: j.error || `Erro ${r.status}` };
  } catch {
    return { kind: 'offline' };
  }
}

/**
 * Fila de gravações com atraso curto (várias alterações seguidas viram uma) e nova tentativa se a rede falhar.
 */
export class SyncQueue {
  private pending = new Map<RemoteKey, { value: unknown; savedAt: number }>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retry: ReturnType<typeof setInterval> | null = null;
  status: SyncStatus = 'checking';
  lastError: string | null = null;

  constructor(
    private onStatus: (s: SyncStatus) => void,
    private onConflict: (key: RemoteKey, value: unknown, savedAt: number) => void,
    private delayMs = 700
  ) {}

  private set(s: SyncStatus) {
    this.status = s;
    this.onStatus(s);
  }

  setStatus(s: SyncStatus) {
    this.set(s);
  }

  enqueue(key: RemoteKey, value: unknown, savedAt: number) {
    this.pending.set(key, { value, savedAt });
    this.set('saving');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, this.delayMs);
  }

  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    for (const [key, item] of Array.from(this.pending.entries())) {
      const res = await pushState(key, item.value, item.savedAt);
      if (res.kind === 'ok') {
        // só limpa se não houve gravação mais nova enquanto enviava
        if (this.pending.get(key)?.savedAt === item.savedAt) this.pending.delete(key);
      } else if (res.kind === 'conflict') {
        this.pending.delete(key);
        this.onConflict(key, res.value, res.savedAt);
      } else if (res.kind === 'locked') {
        this.set('locked');
        return;
      } else if (res.kind === 'error') {
        this.lastError = res.message;
        this.set('error');
        return;
      } else {
        this.set('offline');
        this.ensureRetry();
        return;
      }
    }
    this.lastError = null;
    if (this.pending.size === 0) {
      this.set('saved');
      if (this.retry) { clearInterval(this.retry); this.retry = null; }
    }
  }

  private ensureRetry() {
    if (this.retry) return;
    this.retry = setInterval(() => { if (this.pending.size) void this.flush(); }, 15000);
  }

  hasPending(): boolean {
    return this.pending.size > 0;
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    if (this.retry) clearInterval(this.retry);
  }
}

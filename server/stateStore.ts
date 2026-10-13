/**
 * Armazenamento do estado do app no SERVIDOR (carteiras simuladas, histórico, sinais), igual em qualquer hospedagem.
 *
 * Backends, escolhidos automaticamente:
 *  - supabase: quando SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY existem. Sobrevive a reinícios e a trocas de hospedagem.
 *  - file:     arquivo data/app-state.json. Só persiste se o disco do servidor persistir (plano gratuito do Render e
 *              Cloud Run apagam o disco ao reiniciar; defina PERSISTENT_DISK=true se o seu tem disco persistente).
 *  - memory:   só para testes (STATE_BACKEND=memory).
 */

import fs from 'fs';
import path from 'path';

export type StateBackend = 'supabase' | 'file' | 'memory';

export interface StateRecord {
  value: any;
  savedAt: number; // ms; usado para decidir qual cópia é a mais nova
}

const memory = new Map<string, StateRecord>();
let fileQueue: Promise<unknown> = Promise.resolve();

export function stateBackend(): StateBackend {
  const forced = process.env.STATE_BACKEND;
  if (forced === 'memory') return 'memory';
  if (forced === 'file') return 'file';
  if (process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return 'supabase';
  return 'file';
}

export function storageInfo() {
  const backend = stateBackend();
  return {
    backend,
    persistent: backend === 'supabase' || (backend === 'file' && process.env.PERSISTENT_DISK === 'true'),
    keyRequired: Boolean(process.env.APP_ACCESS_KEY?.trim())
  };
}

const dataFile = () => path.resolve(process.cwd(), 'data', 'app-state.json');

function readFileAll(): Record<string, StateRecord> {
  try { return JSON.parse(fs.readFileSync(dataFile(), 'utf8')) || {}; } catch { return {}; }
}

/** Serializa as gravações em arquivo para duas escritas simultâneas não se atropelarem. */
function withFileLock<T>(fn: () => T): Promise<T> {
  const run = fileQueue.then(fn, fn);
  fileQueue = run.catch(() => undefined);
  return run;
}

function supa(pathAndQuery: string, init: RequestInit = {}) {
  const base = process.env.SUPABASE_URL!.trim().replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!.trim();
  return fetch(`${base}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(10000)
  });
}

export async function getState(key: string): Promise<StateRecord | null> {
  const b = stateBackend();
  if (b === 'memory') return memory.get(key) ?? null;
  if (b === 'file') return readFileAll()[key] ?? null;
  const r = await supa(`app_state?key=eq.${encodeURIComponent(key)}&select=value,saved_at`);
  if (!r.ok) throw new Error(`Supabase HTTP ${r.status}`);
  const rows: any[] = await r.json();
  return rows[0] ? { value: rows[0].value, savedAt: Number(rows[0].saved_at) } : null;
}

export async function setState(key: string, value: any, savedAt: number = Date.now()): Promise<StateRecord> {
  const rec: StateRecord = { value, savedAt };
  const b = stateBackend();
  if (b === 'memory') { memory.set(key, rec); return rec; }
  if (b === 'file') {
    await withFileLock(() => {
      const all = readFileAll();
      all[key] = rec;
      fs.mkdirSync(path.dirname(dataFile()), { recursive: true });
      fs.writeFileSync(dataFile(), JSON.stringify(all));
    });
    return rec;
  }
  const r = await supa('app_state?on_conflict=key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key, value, saved_at: savedAt, updated_at: new Date().toISOString() })
  });
  if (!r.ok) throw new Error(`Supabase HTTP ${r.status}`);
  return rec;
}

/** Versão tolerante usada pelos scanners: erro de armazenamento não pode derrubar a varredura. */
export async function getStateSafe(key: string): Promise<StateRecord | null> {
  try { return await getState(key); } catch (e) { console.warn(`Falha ao ler "${key}" do armazenamento:`, (e as Error).message); return null; }
}

export async function setStateSafe(key: string, value: any): Promise<boolean> {
  try { await setState(key, value); return true; } catch (e) { console.warn(`Falha ao salvar "${key}" no armazenamento:`, (e as Error).message); return false; }
}

/** Teste de ida e volta (usado no diagnóstico). */
export async function storageHealth(): Promise<{ ok: boolean; backend: StateBackend; persistent: boolean; error?: string; ms: number }> {
  const t0 = Date.now();
  const info = storageInfo();
  try {
    const stamp = Date.now();
    await setState('__health', { stamp }, stamp);
    const back = await getState('__health');
    if (back?.value?.stamp !== stamp) throw new Error('o valor lido não confere com o gravado');
    return { ok: true, backend: info.backend, persistent: info.persistent, ms: Date.now() - t0 };
  } catch (e: any) {
    return { ok: false, backend: info.backend, persistent: info.persistent, error: e?.message || 'erro', ms: Date.now() - t0 };
  }
}

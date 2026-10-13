/**
 * API do estado do usuário (carteiras simuladas, histórico, ajustes), guardado no servidor.
 * Funções puras de leitura/escrita com validação e chave de acesso; as rotas do Express só repassam.
 *
 * Chave de acesso: se APP_ACCESS_KEY estiver definida no servidor, toda leitura/escrita exige o cabeçalho
 * X-Access-Key igual a ela. Sem a variável o app fica aberto: qualquer pessoa com o link vê e altera a carteira.
 */

import crypto from 'crypto';
import { getState, setState, storageInfo } from './stateStore';

export const STATE_KEYS = ['paper-spot', 'paper-futures', 'settings'] as const;
export type StateKey = (typeof STATE_KEYS)[number];

const MAX_BYTES = 2_000_000;

export interface ApiResult {
  status: number;
  json: Record<string, unknown>;
}

function accessOk(header: string | undefined): boolean {
  const expected = process.env.APP_ACCESS_KEY?.trim();
  if (!expected) return true;
  const got = Buffer.from(String(header ?? ''));
  const want = Buffer.from(expected);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/** Estrutura mínima de uma carteira simulada: evita gravar lixo que quebraria o app ao carregar. */
export function validPaperAccount(v: any): boolean {
  return !!v && isNum(v.virtualBalance) && isNum(v.initialBalance) && Array.isArray(v.positions) && Array.isArray(v.closedHistory);
}

function validate(key: StateKey, value: any): string | null {
  if (key === 'settings') return value && typeof value === 'object' && !Array.isArray(value) ? null : 'ajustes inválidos';
  return validPaperAccount(value) ? null : 'carteira inválida';
}

export async function stateRead(key: string, accessHeader: string | undefined): Promise<ApiResult> {
  if (!accessOk(accessHeader)) return { status: 401, json: { error: 'Chave de acesso inválida ou ausente.' } };
  if (!(STATE_KEYS as readonly string[]).includes(key)) return { status: 404, json: { error: 'Chave desconhecida.' } };
  try {
    const rec = await getState(key);
    return { status: 200, json: { value: rec?.value ?? null, savedAt: rec?.savedAt ?? 0 } };
  } catch (e: any) {
    return { status: 502, json: { error: `Falha ao ler do armazenamento: ${e?.message ?? 'erro'}` } };
  }
}

/**
 * Grava o estado. `savedAt` (ms) vem do cliente. Se o servidor já tem uma cópia MAIS NOVA, a gravação é recusada
 * (409) e devolve essa cópia, para um aparelho com dados velhos nunca apagar o histórico de outro.
 */
export async function stateWrite(key: string, body: any, accessHeader: string | undefined): Promise<ApiResult> {
  if (!accessOk(accessHeader)) return { status: 401, json: { error: 'Chave de acesso inválida ou ausente.' } };
  if (!(STATE_KEYS as readonly string[]).includes(key)) return { status: 404, json: { error: 'Chave desconhecida.' } };
  const value = body?.value;
  const savedAt = Number(body?.savedAt);
  if (!Number.isFinite(savedAt) || savedAt <= 0) return { status: 400, json: { error: 'savedAt inválido.' } };
  const problem = validate(key as StateKey, value);
  if (problem) return { status: 400, json: { error: problem } };
  if (JSON.stringify(value).length > MAX_BYTES) return { status: 413, json: { error: 'Estado grande demais.' } };
  try {
    const current = await getState(key);
    if (current && current.savedAt > savedAt) {
      return { status: 409, json: { error: 'O servidor tem uma versão mais nova.', value: current.value, savedAt: current.savedAt } };
    }
    const rec = await setState(key, value, savedAt);
    return { status: 200, json: { ok: true, savedAt: rec.savedAt } };
  } catch (e: any) {
    return { status: 502, json: { error: `Falha ao gravar no armazenamento: ${e?.message ?? 'erro'}` } };
  }
}

/** Informações públicas (sem segredos) para o app saber como o servidor guarda os dados. */
export function storageStatus() {
  return storageInfo();
}

/** Verifica a chave sem ler dados (usado pela tela de acesso). */
export function checkAccess(accessHeader: string | undefined): ApiResult {
  return accessOk(accessHeader) ? { status: 200, json: { ok: true } } : { status: 401, json: { error: 'Chave de acesso inválida.' } };
}

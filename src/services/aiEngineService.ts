import { MarketType, TechnicalSignal } from '../types/crypto';
import { safeReadJson } from './http';
import { accessKey } from './remoteState';

export interface AiEngineStatePayload {
  market: MarketType;
  running: boolean;
  lastScanAt: number | null;
  lastError: string | null;
  marketRegime: string;
  marketSummary: string;
  signals: TechnicalSignal[];
}

const getHeaders = (): Record<string, string> => {
  const k = accessKey.get();
  return {
    'Content-Type': 'application/json',
    ...(k ? { 'X-Access-Key': k } : {})
  };
};

export async function fetchAiEngineState(market: MarketType): Promise<AiEngineStatePayload | null> {
  try {
    const res = await fetch(`/api/ai/engine?market=${market}`, {
      headers: getHeaders(),
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    return await safeReadJson<AiEngineStatePayload | null>(res, null, '/api/ai/engine');
  } catch {
    return null;
  }
}

export async function triggerAiEngineScan(market: MarketType): Promise<{ ok: boolean; data?: AiEngineStatePayload; error?: string }> {
  try {
    const res = await fetch('/api/ai/engine/scan', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ market }),
      signal: AbortSignal.timeout(35000)
    });
    const json = await safeReadJson<any>(res, null, '/api/ai/engine/scan');
    if (!res.ok || json?.error) {
      return { ok: false, error: json?.error || `Erro HTTP ${res.status}` };
    }
    return { ok: true, data: json };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Falha ao conectar com o Motor de IA.' };
  }
}

export async function evaluateSignalWithAi(signal: TechnicalSignal): Promise<{
  ok: boolean;
  evaluation?: {
    confidence: number;
    verdict: string;
    thesis: string;
    riskLevel: 'BAIXO' | 'MEDIO' | 'ALTO';
  };
  error?: string;
}> {
  try {
    const res = await fetch('/api/ai/engine/evaluate', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ signal }),
      signal: AbortSignal.timeout(25000)
    });
    const json = await safeReadJson<any>(res, null, '/api/ai/engine/evaluate');
    if (!res.ok || json?.error) {
      return { ok: false, error: json?.error || `Erro HTTP ${res.status}` };
    }
    return { ok: true, evaluation: json };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Falha na avaliação do sinal.' };
  }
}

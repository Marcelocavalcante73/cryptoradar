/**
 * Diagnóstico: testa, de dentro do servidor, tudo de que o app depende. Serve para descobrir rápido por que algo
 * funciona numa hospedagem e em outra não (região bloqueada, disco temporário, scanner parado etc.).
 */

import { storageHealth, storageInfo } from './stateStore';
import { getScanState } from './scanner';
import { getTrendState } from './trendScanner';

export interface Check {
  id: string;
  label: string;
  ok: boolean;
  ms: number;
  detail?: string;
}

export interface HealthReport {
  at: number;
  host: string;
  node: string;
  uptimeMin: number;
  storage: { backend: string; persistent: boolean; keyRequired: boolean };
  checks: Check[];
  scanners: { spot: ScannerBrief; futures: ScannerBrief; trend: { lastScanAt: number | null; lastError: string | null; signals: number } };
  warnings: string[];
}

interface ScannerBrief { lastScanAt: number | null; lastError: string | null; signals: number; running: boolean }

export const DEFAULT_HOST = 'Servidor próprio ou ambiente de desenvolvimento';

/** Em que tipo de hospedagem o servidor está rodando (pelas variáveis que cada uma define). */
export function detectHost(env: NodeJS.ProcessEnv = process.env): string {
  if (env.K_SERVICE) return 'Google Cloud Run (AI Studio publicado)';
  if (env.RENDER) return 'Render';
  if (env.RAILWAY_ENVIRONMENT) return 'Railway';
  if (env.FLY_APP_NAME) return 'Fly.io';
  if (env.VERCEL) return 'Vercel';
  if (env.DYNO) return 'Heroku';
  return DEFAULT_HOST;
}

async function ping(id: string, label: string, url: string, accept: (body: any) => boolean = () => true): Promise<Check> {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { Accept: 'application/json' } });
    const ms = Date.now() - t0;
    if (!r.ok) return { id, label, ok: false, ms, detail: `HTTP ${r.status}${r.status === 451 || r.status === 403 ? ' (região do servidor bloqueada por esta corretora)' : r.status === 429 ? ' (limite de requisições)' : ''}` };
    const body = await r.json().catch(() => ({}));
    return accept(body) ? { id, label, ok: true, ms } : { id, label, ok: false, ms, detail: 'resposta inesperada' };
  } catch (e: any) {
    return { id, label, ok: false, ms: Date.now() - t0, detail: e?.name === 'TimeoutError' ? 'sem resposta em 6 s' : e?.message || 'falha de rede' };
  }
}

export async function runHealth(): Promise<HealthReport> {
  const [st, binSpot, binFut, bybit, okx, gecko] = await Promise.all([
    storageHealth(),
    ping('binance-spot', 'Binance (spot)', 'https://data-api.binance.vision/api/v3/ping'),
    ping('binance-futures', 'Binance (futuros)', 'https://fapi.binance.com/fapi/v1/ping'),
    ping('bybit', 'Bybit (futuros)', 'https://api.bybit.com/v5/market/time', (b) => b?.retCode === 0),
    ping('okx', 'OKX (futuros)', 'https://www.okx.com/api/v5/public/time', (b) => b?.code === '0'),
    ping('coingecko', 'CoinGecko (ranking)', 'https://api.coingecko.com/api/v3/ping')
  ]);

  const info = storageInfo();
  const checks: Check[] = [
    { id: 'storage', label: `Armazenamento (${st.backend})`, ok: st.ok, ms: st.ms, detail: st.error },
    binSpot, binFut, bybit, okx, gecko
  ];

  const brief = (m: 'spot' | 'futures'): ScannerBrief => {
    const s = getScanState(m);
    return { lastScanAt: s.lastScanAt, lastError: s.lastError, signals: s.signals.length, running: s.running };
  };
  const trend = getTrendState();

  const warnings: string[] = [];
  const host = detectHost();
  if (!st.ok) warnings.push(`O armazenamento não está funcionando (${st.error ?? 'erro'}): a carteira e o histórico não serão salvos no servidor.`);
  else if (!info.persistent) warnings.push('O servidor guarda os dados em disco temporário: a carteira, o histórico e os sinais podem sumir quando ele reiniciar. Configure o Supabase (veja DEPLOY.md).');
  if (!info.keyRequired) warnings.push('Sem chave de acesso (APP_ACCESS_KEY): qualquer pessoa com o link vê e altera a sua carteira.');
  if (!binFut.ok && !bybit.ok && !okx.ok) warnings.push('Nenhuma API de futuros respondeu: a região deste servidor está bloqueada pelas três. Mude a região da hospedagem (ex.: Frankfurt).');
  else if (!binFut.ok) warnings.push('A Binance de futuros não responde daqui; os dados de futuros virão da Bybit/OKX.');
  if (!binSpot.ok) warnings.push('A Binance (spot) não responde daqui: sem ela o spot não funciona. Mude a região da hospedagem.');
  if (!gecko.ok) warnings.push('O CoinGecko não responde; o ranking usa a CoinPaprika ou o último ranking salvo.');
  if (host.startsWith('Google Cloud Run')) warnings.push('No Cloud Run o processador só funciona durante requisições: o app mantém a conexão aberta durante as varreduras, mas sem Supabase o histórico se perde quando a instância reinicia. Limite a 1 instância para não duplicar alertas do Telegram.');
  if (host === 'Render') warnings.push('No plano gratuito do Render o serviço dorme após ~15 min sem acesso e o disco é apagado ao reiniciar. Use o Supabase para guardar os dados.');

  return {
    at: Date.now(),
    host,
    node: process.version,
    uptimeMin: Math.round(process.uptime() / 60),
    storage: info,
    checks,
    scanners: { spot: brief('spot'), futures: brief('futures'), trend: { lastScanAt: trend.lastScanAt, lastError: trend.lastError, signals: trend.signals.length } },
    warnings
  };
}

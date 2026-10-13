/**
 * Sinais ao vivo da estratégia de rompimento de 55 dias (mesmas regras do backtest, em src/services/trendBacktest.ts).
 *
 * Ciclo de um sinal, em velas diárias (o dia fecha às 00:00 UTC = 21:00 em Brasília):
 *  1. Fechamento do dia i acima da máxima dos 55 dias anteriores, com o Bitcoin acima da média de 200 dias => SINAL.
 *  2. Entrada na ABERTURA do dia i+1 (preço conhecido assim que o novo dia começa). Stop = entrada − 2 × ATR(20).
 *  3. Saída: fechamento abaixo da mínima dos 20 dias anteriores (aviso ao fim do dia; sai na abertura seguinte)
 *     ou stop atingido durante o dia.
 */

import { CandleData } from '../types/crypto';
import { DEFAULT_BACKTEST_OPTIONS } from './backtest';
import { TREND_RULES, DAY_MS, atrSeries, donchianHigh, donchianLow } from './trendBacktest';

export type TrendStatus = 'OPEN' | 'EXIT_SIGNAL' | 'STOPPED' | 'CLOSED';

export interface TrendSignal {
  id: string;
  symbol: string;
  baseAsset: string;
  signalDay: number;     // início (ms) da vela diária do rompimento
  createdAt: number;
  refPrice: number;      // fechamento do dia do sinal
  entryPrice?: number;   // abertura do dia seguinte, quando já existir
  stopPrice: number;
  atr: number;
  exitLevel: number;     // fechar abaixo disto = sair
  status: TrendStatus;
  lastPrice?: number;
  exitPrice?: number;
  closedAt?: number;
  alertedEntry?: boolean;
  alertedExit?: boolean;
}

/** Separa as velas já fechadas da vela do dia em andamento. */
export function splitClosed(candles: CandleData[], now: number): { closed: CandleData[]; current: CandleData | null } {
  const closed = candles.filter((c) => c.timestamp + DAY_MS <= now);
  const current = candles.find((c) => c.timestamp <= now && c.timestamp + DAY_MS > now) ?? null;
  return { closed, current };
}

/**
 * Mesma regra do backtest: uma posição por moeda e nova entrada só depois de a anterior ter sido encerrada
 * (o dia do sinal precisa ser posterior ao dia da saída).
 */
export function canEnter(existing: TrendSignal[], symbol: string, signalDay: number): boolean {
  return existing
    .filter((s) => s.symbol === symbol)
    .every((s) => (s.status === 'STOPPED' || s.status === 'CLOSED') && s.closedAt !== undefined && signalDay > s.closedAt);
}

/** Procura rompimento na última vela FECHADA. Mesmas condições do backtest. */
export function detectTrendEntry(
  closed: CandleData[],
  btcBullish: boolean,
  symbol: string,
  baseAsset: string,
  now: number = Date.now()
): TrendSignal | null {
  const R = TREND_RULES;
  const i = closed.length - 1;
  if (i < Math.max(R.entryLookback, R.atrPeriod + 1) || !btcBullish) return null;

  const atr = atrSeries(closed, R.atrPeriod)[i];
  if (atr === undefined || atr <= 0) return null;
  const c = closed[i];
  if (!(c.close > donchianHigh(closed, i))) return null;

  return {
    id: `${symbol}-${c.timestamp}`,
    symbol,
    baseAsset,
    signalDay: c.timestamp,
    createdAt: now,
    refPrice: c.close,
    stopPrice: c.close - R.stopAtrMult * atr, // provisório até a abertura do dia seguinte
    atr,
    exitLevel: donchianLow(closed, i + 1), // mínima das últimas 20 velas fechadas
    status: 'OPEN',
    lastPrice: c.close
  };
}

/**
 * Atualiza um sinal com as velas mais recentes (inclui a vela do dia em andamento).
 * Aplica as mesmas regras de saída do backtest e devolve uma cópia.
 */
export function updateTrendSignal(sig: TrendSignal, candles: CandleData[], now: number = Date.now()): TrendSignal {
  if (sig.status === 'STOPPED' || sig.status === 'CLOSED') return sig;
  const R = TREND_RULES;
  const entryIdx = candles.findIndex((c) => c.timestamp === sig.signalDay + DAY_MS);
  const out: TrendSignal = { ...sig };

  if (entryIdx < 0) return out; // o dia da entrada ainda não começou: sinal pendente

  const entry = candles[entryIdx].open;
  out.entryPrice = entry;
  out.stopPrice = entry - R.stopAtrMult * sig.atr;
  const last = candles[candles.length - 1];
  out.lastPrice = last.close;

  for (let j = entryIdx; j < candles.length; j++) {
    const d = candles[j];
    const isClosed = d.timestamp + DAY_MS <= now;

    if (d.low <= out.stopPrice) {
      out.status = 'STOPPED';
      out.exitPrice = Math.min(out.stopPrice, d.open); // gap para baixo sai na abertura
      out.closedAt = d.timestamp;
      return out;
    }
    if (j > entryIdx && isClosed && d.close < donchianLow(candles, j)) {
      if (j + 1 < candles.length) {
        out.status = 'CLOSED';
        out.exitPrice = candles[j + 1].open;
        out.closedAt = candles[j + 1].timestamp;
      } else {
        out.status = 'EXIT_SIGNAL'; // sai na abertura de amanhã
      }
      return out;
    }
  }

  // Nível de saída para o fechamento de hoje: mínima das últimas 20 velas fechadas
  const closedCount = candles.filter((c) => c.timestamp + DAY_MS <= now).length;
  if (closedCount >= R.exitLookback) out.exitLevel = donchianLow(candles, closedCount);
  return out;
}

/** Resultado líquido de um sinal encerrado: percentual e múltiplos do risco inicial (2 ATR). */
export function trendSignalResult(sig: TrendSignal): { netPct: number; r: number } | null {
  if ((sig.status !== 'STOPPED' && sig.status !== 'CLOSED') || sig.entryPrice === undefined || sig.exitPrice === undefined) return null;
  const cost = 2 * (DEFAULT_BACKTEST_OPTIONS.feeRate + DEFAULT_BACKTEST_OPTIONS.slippageRate) * 100;
  const net = ((sig.exitPrice - sig.entryPrice) / sig.entryPrice) * 100 - cost;
  const riskPct = ((TREND_RULES.stopAtrMult * sig.atr) / sig.entryPrice) * 100;
  return { netPct: net, r: riskPct > 0 ? net / riskPct : 0 };
}

// ---------------------------------------------------------------------------
// Validação ao vivo: poucos sinais por mês, então os critérios são em meses, não em semanas
// ---------------------------------------------------------------------------

export const TREND_READINESS = { minClosed: 10, minDays: 84, minProfitFactor: 1.3 } as const;

export interface TrendReadiness {
  status: 'collecting' | 'failed' | 'ready';
  headline: string;
  checks: { label: string; ok: boolean; detail: string }[];
}

export function evaluateTrendReadiness(signals: TrendSignal[], now = Date.now()): TrendReadiness {
  const results = signals.map(trendSignalResult).filter((r): r is { netPct: number; r: number } => r !== null);
  const n = results.length;
  const days = signals.length ? (now - Math.min(...signals.map((s) => s.createdAt))) / 86400000 : 0;
  const gains = results.filter((x) => x.netPct > 0).reduce((a, x) => a + x.netPct, 0);
  const losses = Math.abs(results.filter((x) => x.netPct <= 0).reduce((a, x) => a + x.netPct, 0));
  const pf = losses > 0 ? gains / losses : gains > 0 ? Infinity : 0;
  const avg = n ? results.reduce((a, x) => a + x.netPct, 0) / n : 0;
  const T = TREND_READINESS;

  const checks = [
    { label: `Pelo menos ${T.minClosed} operações encerradas`, ok: n >= T.minClosed, detail: `${n} de ${T.minClosed}` },
    { label: `Pelo menos ${T.minDays} dias (12 semanas) de acompanhamento`, ok: days >= T.minDays, detail: `${Math.floor(days)} de ${T.minDays} dias` },
    { label: 'Resultado médio por operação positivo (depois dos custos)', ok: n > 0 && avg > 0, detail: n ? `${avg >= 0 ? '+' : '−'}${Math.abs(avg).toFixed(2)}%` : '—' },
    { label: `Fator de lucro de ${T.minProfitFactor.toFixed(1)} ou mais`, ok: n > 0 && pf >= T.minProfitFactor, detail: n ? (pf === Infinity ? '∞' : pf.toFixed(2)) : '—' }
  ];

  if (checks.every((c) => c.ok)) {
    return { status: 'ready', headline: 'Critérios atingidos ao vivo. Se quiser, comece com valor pequeno, sempre com stop.', checks };
  }
  if (n >= T.minClosed && days >= T.minDays) {
    return { status: 'failed', headline: 'Dados suficientes e o resultado ao vivo não passou nos critérios. Não opere com dinheiro real.', checks };
  }
  return { status: 'collecting', headline: 'Ainda coletando. Esta estratégia dá poucos sinais por mês: continue só simulando.', checks };
}

/**
 * Desempenho dos sinais reais já emitidos pelo scanner.
 *
 * Resultado de cada sinal encerrado, em R (múltiplos do risco inicial = distância até o stop):
 *  - ALVO atingido  -> retorno pelo preço do alvo
 *  - STOP atingido  -> retorno pelo preço do stop
 *  - EXPIRADO       -> retorno pelo preço no momento da expiração (se conhecido)
 * Todos descontam taxa + derrapagem (mesmos custos do backtest) para não inflar o resultado.
 */

import { TechnicalSignal } from '../types/crypto';
import { DEFAULT_BACKTEST_OPTIONS } from './backtest';

export type PerfSignal = TechnicalSignal & {
  score?: number;
  closePrice?: number;
  spotExit?: boolean;
};

export interface PerfGroup {
  label: string;
  resolved: number;     // alvo + stop + expirado com preço
  wins: number;         // resultado líquido > 0
  winRate: number;      // 0-100
  avgR: number;
  totalR: number;
  profitFactor: number | null;
}

export interface SignalPerformance {
  total: number;
  open: number;
  closed: number;       // alvo + stop + expirado
  targetHits: number;
  stopHits: number;
  expired: number;
  overall: PerfGroup;
  byDirection: PerfGroup[];
  byTimeframe: PerfGroup[];
  byScore: PerfGroup[];
  reliable: boolean;    // amostra suficiente (>= 30 encerrados)
}

export const MIN_RELIABLE_SAMPLE = 30;

/** Resultado líquido do sinal em R, ou null se ainda não resolvido / sem preço de saída. */
export function signalResultR(s: PerfSignal, costRate = 2 * (DEFAULT_BACKTEST_OPTIONS.feeRate + DEFAULT_BACKTEST_OPTIONS.slippageRate)): number | null {
  const sign = s.direction === 'LONG' ? 1 : -1;
  let exit: number | undefined;
  if (s.status === 'TARGET_HIT') exit = s.targetPrice;
  else if (s.status === 'STOP_HIT') exit = s.stopLossPrice;
  else if (s.status === 'EXPIRED') exit = s.closePrice;
  if (exit === undefined || !Number.isFinite(exit)) return null;

  const riskPct = (Math.abs(s.entryPrice - s.stopLossPrice) / s.entryPrice) * 100;
  if (riskPct <= 0) return null;
  const netPct = sign * ((exit - s.entryPrice) / s.entryPrice) * 100 - costRate * 100;
  return netPct / riskPct;
}

function group(label: string, results: number[]): PerfGroup {
  const wins = results.filter((r) => r > 0);
  const gains = wins.reduce((a, r) => a + r, 0);
  const losses = Math.abs(results.filter((r) => r <= 0).reduce((a, r) => a + r, 0));
  const total = results.reduce((a, r) => a + r, 0);
  return {
    label,
    resolved: results.length,
    wins: wins.length,
    winRate: results.length ? (wins.length / results.length) * 100 : 0,
    avgR: results.length ? total / results.length : 0,
    totalR: total,
    profitFactor: losses > 0 ? gains / losses : null
  };
}

export function computeSignalPerformance(all: PerfSignal[]): SignalPerformance {
  const real = all.filter((s) => !s.isDemo);
  const withR = real.map((s) => ({ s, r: signalResultR(s) })).filter((x): x is { s: PerfSignal; r: number } => x.r !== null);

  const by = (label: string, pred: (s: PerfSignal) => boolean) => group(label, withR.filter((x) => pred(x.s)).map((x) => x.r));
  const absScore = (s: PerfSignal) => Math.abs(s.score ?? 0);

  const closed = real.filter((s) => s.status !== 'OPEN').length;
  return {
    total: real.length,
    open: real.filter((s) => s.status === 'OPEN').length,
    closed,
    targetHits: real.filter((s) => s.status === 'TARGET_HIT').length,
    stopHits: real.filter((s) => s.status === 'STOP_HIT').length,
    expired: real.filter((s) => s.status === 'EXPIRED').length,
    overall: group('Geral', withR.map((x) => x.r)),
    byDirection: [
      by('Compras', (s) => s.direction === 'LONG'),
      by('Vendas', (s) => s.direction === 'SHORT')
    ],
    byTimeframe: [by('1h', (s) => s.timeframe === '1h'), by('4h', (s) => s.timeframe === '4h')],
    byScore: [
      by('60–69', (s) => absScore(s) >= 60 && absScore(s) < 70),
      by('70–79', (s) => absScore(s) >= 70 && absScore(s) < 80),
      by('80+', (s) => absScore(s) >= 80)
    ],
    reliable: withR.length >= MIN_RELIABLE_SAMPLE
  };
}

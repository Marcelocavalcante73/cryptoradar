/**
 * Resultado agregado de um backtest em várias moedas, com veredito objetivo.
 * Função pura: recebe os resultados por moeda e devolve tabela, estatísticas somadas,
 * as duas metades do período (para checar se o resultado se repete) e os critérios de aprovação.
 */

import { BacktestResult, BacktestStats, BacktestTrade, computeStats } from './backtest';

export const BACKTEST_CRITERIA = {
  minTrades: 100,
  minProfitFactor: 1.3,
  minHalfProfitFactor: 1.0
} as const;

export interface BatchRow {
  symbol: string;
  trades: number;
  winRate: number;
  avgNetPct: number;
  avgR: number;
  profitFactor: number | null;
  maxDrawdownPct: number;
}

export interface VerdictCheck {
  label: string;
  ok: boolean;
  detail: string;
}

export interface BatchSummary {
  rows: BatchRow[];
  aggregate: BacktestStats;
  firstHalf: BacktestStats;
  secondHalf: BacktestStats;
  checks: VerdictCheck[];
  passed: boolean;
}

const pfText = (pf: number | null) => (pf === null ? '∞' : pf.toFixed(2));

export function summarizeBatch(results: BacktestResult[]): BatchSummary {
  const all: BacktestTrade[] = [];
  const first: BacktestTrade[] = [];
  const second: BacktestTrade[] = [];

  const rows: BatchRow[] = results.map((r) => {
    for (const t of r.trades) {
      all.push(t);
      (t.entryIndex < r.candlesUsed / 2 ? first : second).push(t);
    }
    const s = r.stats;
    return {
      symbol: r.symbol, trades: s.trades, winRate: s.winRate, avgNetPct: s.avgNetPct,
      avgR: s.avgR, profitFactor: s.profitFactor, maxDrawdownPct: s.maxDrawdownPct
    };
  });

  const aggregate = computeStats(all);
  const firstHalf = computeStats(first);
  const secondHalf = computeStats(second);
  const C = BACKTEST_CRITERIA;
  const pfOk = (s: BacktestStats) => s.trades > 0 && (s.profitFactor === null || s.profitFactor >= C.minHalfProfitFactor);

  const checks: VerdictCheck[] = [
    { label: `Pelo menos ${C.minTrades} operações`, ok: aggregate.trades >= C.minTrades, detail: `${aggregate.trades}` },
    { label: `Fator de lucro de ${C.minProfitFactor.toFixed(1)} ou mais`, ok: aggregate.trades > 0 && (aggregate.profitFactor === null || aggregate.profitFactor >= C.minProfitFactor), detail: pfText(aggregate.profitFactor) },
    { label: 'Resultado médio por operação positivo (depois dos custos)', ok: aggregate.trades > 0 && aggregate.avgNetPct > 0, detail: `${aggregate.avgNetPct >= 0 ? '+' : '−'}${Math.abs(aggregate.avgNetPct).toFixed(2)}%` },
    { label: 'Primeira metade do período com fator de lucro de 1,0 ou mais', ok: pfOk(firstHalf), detail: firstHalf.trades ? `${pfText(firstHalf.profitFactor)} (${firstHalf.trades} op.)` : '—' },
    { label: 'Segunda metade do período com fator de lucro de 1,0 ou mais', ok: pfOk(secondHalf), detail: secondHalf.trades ? `${pfText(secondHalf.profitFactor)} (${secondHalf.trades} op.)` : '—' }
  ];

  return { rows, aggregate, firstHalf, secondHalf, checks, passed: checks.every((c) => c.ok) };
}

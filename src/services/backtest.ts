/**
 * Backtest do motor de sinais.
 *
 * Regras para não se enganar (evitar resultados otimistas):
 *  - Sem look-ahead: o sinal usa só candles até o fechamento da vela i; a entrada é na ABERTURA da vela i+1.
 *  - Stop e alvo são recalculados a partir do preço real de entrada, com o mesmo ATR do sinal.
 *  - Se stop e alvo caem na mesma vela, considera-se o STOP (pior caso).
 *  - Custos: taxa por lado + derrapagem por lado, descontados de cada operação.
 *  - Uma posição por vez por moeda (sem sobreposição).
 *  - Posição que não resolve em `maxHoldBars` é encerrada no fechamento.
 */

import { CandleData, SignalDirection } from '../types/crypto';
import { calculateAllIndicators } from './indicators';
import { priceDecimals } from './apiService';
import { evaluateSignal, ATR_STOP_MULT, ATR_TARGET_MULT, MIN_CANDLES } from './signalEngine';

export interface BacktestOptions {
  feeRate: number;      // por lado, ex: 0.001 = 0,1%
  slippageRate: number; // por lado, ex: 0.0005
  maxHoldBars: number;
  minScore?: number;    // filtro adicional sobre a pontuação do motor
  longOnly?: boolean;   // spot: ignora sinais de VENDA (não há short)
}

export const DEFAULT_BACKTEST_OPTIONS: BacktestOptions = {
  feeRate: 0.001,
  slippageRate: 0.0005,
  maxHoldBars: 48
};

export type TradeExit = 'TARGET' | 'STOP' | 'TIMEOUT';

export interface BacktestTrade {
  symbol: string;
  timeframe: string;
  direction: SignalDirection;
  score: number;
  entryIndex: number;
  exitIndex: number;
  entryPrice: number;
  exitPrice: number;
  exit: TradeExit;
  grossPct: number; // retorno bruto da operação (%)
  netPct: number;   // após taxas e derrapagem (%)
  rMultiple: number; // netPct dividido pelo risco inicial (%)
}

export interface BacktestStats {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;        // 0-100
  avgNetPct: number;      // expectativa por operação (%)
  avgR: number;
  profitFactor: number | null; // null = sem perdas
  totalNetPct: number;    // soma simples dos retornos (%)
  maxDrawdownPct: number; // sobre a curva de soma dos retornos
  targetExits: number;
  stopExits: number;
  timeoutExits: number;
  longTrades: number;
  shortTrades: number;
}

export interface BacktestResult {
  symbol: string;
  timeframe: string;
  candlesUsed: number;
  trades: BacktestTrade[];
  stats: BacktestStats;
}

export function computeStats(trades: BacktestTrade[]): BacktestStats {
  const wins = trades.filter((t) => t.netPct > 0);
  const losses = trades.filter((t) => t.netPct <= 0);
  const grossWin = wins.reduce((s, t) => s + t.netPct, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPct, 0));
  const total = trades.reduce((s, t) => s + t.netPct, 0);

  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const t of trades) {
    equity += t.netPct;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }

  const n = trades.length;
  return {
    trades: n,
    wins: wins.length,
    losses: losses.length,
    winRate: n ? (wins.length / n) * 100 : 0,
    avgNetPct: n ? total / n : 0,
    avgR: n ? trades.reduce((s, t) => s + t.rMultiple, 0) / n : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    totalNetPct: total,
    maxDrawdownPct: maxDd,
    targetExits: trades.filter((t) => t.exit === 'TARGET').length,
    stopExits: trades.filter((t) => t.exit === 'STOP').length,
    timeoutExits: trades.filter((t) => t.exit === 'TIMEOUT').length,
    longTrades: trades.filter((t) => t.direction === 'LONG').length,
    shortTrades: trades.filter((t) => t.direction === 'SHORT').length
  };
}

/**
 * Executa o backtest sobre candles CRUS (sem indicadores) em ordem cronológica, todos já fechados.
 */
export function runBacktest(
  rawCandles: CandleData[],
  symbol: string,
  baseAsset: string,
  timeframe: string,
  options: Partial<BacktestOptions> = {}
): BacktestResult {
  const opt = { ...DEFAULT_BACKTEST_OPTIONS, ...options };
  const decimals = rawCandles.length > 0 ? priceDecimals(rawCandles[rawCandles.length - 1].close) : 4;
  // Os indicadores são recursivos e causais: o valor na vela i só depende de velas ≤ i.
  const candles = calculateAllIndicators(rawCandles, decimals);
  const trades: BacktestTrade[] = [];

  let i = MIN_CANDLES;
  while (i < candles.length - 1) {
    const sig = evaluateSignal(candles.slice(0, i + 1), { symbol, baseAsset, timeframe });
    if (!sig || (opt.longOnly && sig.direction === 'SHORT') || (opt.minScore !== undefined && Math.abs(sig.score) < opt.minScore)) {
      i++;
      continue;
    }

    const sign = sig.direction === 'LONG' ? 1 : -1;
    const entryBar = candles[i + 1];
    const entry = entryBar.open;
    const stop = entry - sign * sig.atr * ATR_STOP_MULT;
    const target = entry + sign * sig.atr * ATR_TARGET_MULT;
    if (stop <= 0) { i++; continue; }

    let exitIdx = Math.min(i + 1 + opt.maxHoldBars, candles.length - 1);
    let exitPrice = candles[exitIdx].close;
    let exit: TradeExit = 'TIMEOUT';

    for (let j = i + 1; j <= Math.min(i + 1 + opt.maxHoldBars, candles.length - 1); j++) {
      const c = candles[j];
      const stopHit = sign === 1 ? c.low <= stop : c.high >= stop;
      const targetHit = sign === 1 ? c.high >= target : c.low <= target;
      if (stopHit) { exitIdx = j; exitPrice = stop; exit = 'STOP'; break; } // stop tem prioridade
      if (targetHit) { exitIdx = j; exitPrice = target; exit = 'TARGET'; break; }
    }

    const grossPct = sign * ((exitPrice - entry) / entry) * 100;
    const costPct = 2 * (opt.feeRate + opt.slippageRate) * 100;
    const netPct = grossPct - costPct;
    const riskPct = ((sig.atr * ATR_STOP_MULT) / entry) * 100;

    trades.push({
      symbol, timeframe, direction: sig.direction, score: sig.score,
      entryIndex: i + 1, exitIndex: exitIdx, entryPrice: entry, exitPrice, exit,
      grossPct, netPct, rMultiple: riskPct > 0 ? netPct / riskPct : 0
    });

    i = exitIdx + 1; // sem sobreposição
  }

  return { symbol, timeframe, candlesUsed: candles.length, trades, stats: computeStats(trades) };
}

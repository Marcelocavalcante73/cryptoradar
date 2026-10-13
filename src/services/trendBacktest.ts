/**
 * Estratégia de seguimento de tendência (rompimento de 55 dias, estilo "Turtle"), em velas diárias, só compras.
 *
 * REGRAS FIXAS (definidas antes de ver qualquer resultado, para não ajustar até dar certo):
 *  - Entrada: o FECHAMENTO do dia fica acima da máxima dos 55 dias anteriores E o Bitcoin está acima da média
 *    simples de 200 dias (filtro de mercado). Compra na ABERTURA do dia seguinte (sem olhar o futuro).
 *  - Stop inicial: 2 × ATR(20) abaixo da entrada. Se o dia abrir abaixo do stop (gap), sai na abertura.
 *  - Saída pela tendência: o FECHAMENTO fica abaixo da mínima dos 20 dias anteriores; sai na abertura seguinte.
 *  - Sem alvo fixo: os ganhos correm. Uma posição por vez por moeda.
 *  - Custos: taxa + derrapagem por lado (mesmos do backtest de sinais).
 */

import { CandleData } from '../types/crypto';
import {
  BacktestResult, BacktestTrade, DEFAULT_BACKTEST_OPTIONS, computeStats
} from './backtest';

export const TREND_RULES = {
  entryLookback: 55,
  exitLookback: 20,
  atrPeriod: 20,
  stopAtrMult: 2,
  btcSmaPeriod: 200
} as const;

const DAY_MS = 86400000;
const dayKey = (ts: number) => Math.floor(ts / DAY_MS);

/** ATR de Wilder para cada vela (undefined enquanto não há dados suficientes). */
function atrSeries(c: CandleData[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(c.length).fill(undefined);
  if (c.length <= period) return out;
  const tr = (i: number) => Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
  let atr = 0;
  for (let i = 1; i <= period; i++) atr += tr(i);
  atr /= period;
  out[period] = atr;
  for (let i = period + 1; i < c.length; i++) {
    atr = (atr * (period - 1) + tr(i)) / period;
    out[i] = atr;
  }
  return out;
}

/** Para cada dia do BTC: o fechamento está acima da média simples de `period` dias? (usa só dados até o próprio dia) */
export function btcRegimeByDay(btc: CandleData[], period: number = TREND_RULES.btcSmaPeriod): Map<number, boolean> {
  const map = new Map<number, boolean>();
  let sum = 0;
  for (let i = 0; i < btc.length; i++) {
    sum += btc[i].close;
    if (i >= period) sum -= btc[i - period].close;
    if (i >= period - 1) map.set(dayKey(btc[i].timestamp), btc[i].close > sum / period);
  }
  return map;
}

export interface TrendOptions {
  feeRate: number;
  slippageRate: number;
}

export function runTrendBacktest(
  candles: CandleData[],
  btcCandles: CandleData[],
  symbol: string,
  options: Partial<TrendOptions> = {}
): BacktestResult {
  const opt = { feeRate: DEFAULT_BACKTEST_OPTIONS.feeRate, slippageRate: DEFAULT_BACKTEST_OPTIONS.slippageRate, ...options };
  const R = TREND_RULES;
  const regime = btcRegimeByDay(btcCandles);
  const atr = atrSeries(candles, R.atrPeriod);
  const trades: BacktestTrade[] = [];
  const n = candles.length;

  const highestHigh = (i: number) => { let m = -Infinity; for (let k = i - R.entryLookback; k < i; k++) m = Math.max(m, candles[k].high); return m; };
  const lowestLow = (i: number) => { let m = Infinity; for (let k = i - R.exitLookback; k < i; k++) m = Math.min(m, candles[k].low); return m; };

  let i = Math.max(R.entryLookback, R.atrPeriod + 1);
  while (i < n - 1) {
    const c = candles[i];
    const a = atr[i];
    const bullish = regime.get(dayKey(c.timestamp)) === true;

    if (!(bullish && a !== undefined && a > 0 && c.close > highestHigh(i))) { i++; continue; }

    const entryIdx = i + 1;
    const entry = candles[entryIdx].open;
    const stop = entry - R.stopAtrMult * a;
    if (stop <= 0) { i++; continue; }

    let exitIdx = n - 1;
    let exitPrice = candles[n - 1].close;
    let exit: BacktestTrade['exit'] = 'TIMEOUT'; // dados acabaram com a posição aberta

    for (let j = entryIdx; j < n; j++) {
      const d = candles[j];
      if (d.low <= stop) {
        exitIdx = j; exit = 'STOP';
        exitPrice = Math.min(stop, d.open); // gap para baixo: sai na abertura, pior que o stop
        break;
      }
      if (j > entryIdx && j + 1 < n && d.close < lowestLow(j)) {
        exitIdx = j + 1; exit = 'TRAIL';
        exitPrice = candles[j + 1].open;
        break;
      }
    }

    const gross = ((exitPrice - entry) / entry) * 100;
    const net = gross - 2 * (opt.feeRate + opt.slippageRate) * 100;
    const riskPct = ((R.stopAtrMult * a) / entry) * 100;

    trades.push({
      symbol, timeframe: '1d', direction: 'LONG', score: 0,
      entryIndex: entryIdx, entryTimestamp: candles[entryIdx].timestamp, exitIndex: exitIdx,
      entryPrice: entry, exitPrice, exit, grossPct: gross, netPct: net, rMultiple: riskPct > 0 ? net / riskPct : 0
    });

    i = exitIdx + 1; // sem sobreposição
  }

  return { symbol, timeframe: '1d', candlesUsed: n, trades, stats: computeStats(trades) };
}

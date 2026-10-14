/**
 * Swing trade na B3: sinais diários, só compras (a B3 à vista não tem venda a descoberto simples para o varejo).
 *
 * Duas estratégias, ambas em velas diárias, só com o Ibovespa em alta (acima da média de 200 dias):
 *  - Tendência: rompimento de 55 dias (regras em trendSignals.ts).
 *  - Indicadores: o mesmo motor das criptos (EMA 20/50, MACD, RSI, volume; pontuação ≥ 60).
 *    Entrada na ABERTURA do pregão seguinte, stop 1,5 ATR, alvo 3 ATR, saída por tempo após 20 pregões.
 *
 * O dia B3 fecha às 17h (Brasília); o scanner considera o pregão fechado a partir das 21h, como nas criptos.
 */

import { CandleData } from '../types/crypto';
import { DEFAULT_BACKTEST_OPTIONS } from './backtest';
import { calculateAllIndicators, calculateATR } from './indicators';
import { evaluateSignal, ATR_STOP_MULT, ATR_TARGET_MULT } from './signalEngine';
import { readinessFromResults, TrendReadiness } from './trendSignals';
import { DAY_MS, btcRegimeByDay } from './trendBacktest';

export const B3_HOLD_DAYS = 20;

export type B3Status = 'OPEN' | 'EXIT_SIGNAL' | 'TARGET' | 'STOP' | 'TIMEOUT';

export interface B3Signal {
  id: string;
  symbol: string;          // ticker, ex.: PETR4
  signalDay: number;       // início (ms) do pregão do sinal
  createdAt: number;
  refPrice: number;        // fechamento do dia do sinal
  entryPrice?: number;     // abertura do pregão seguinte, quando já existir
  stopPrice: number;
  targetPrice: number;
  atr: number;
  score: number;
  status: B3Status;
  lastPrice?: number;
  exitPrice?: number;
  closedAt?: number;
  alertedExit?: boolean;
}

export const isB3Done = (s: B3Signal) => s.status === 'TARGET' || s.status === 'STOP' || s.status === 'TIMEOUT';

/** Estado do mercado: Ibovespa em relação às médias de 50 e 200 dias. */
export interface MarketTrend {
  bullish: boolean;
  close: number;
  sma50: number;
  sma200: number;
  change20dPct: number;
  label: 'Alta' | 'Lateral' | 'Baixa';
}

export function marketTrend(closed: CandleData[]): MarketTrend | null {
  if (closed.length < 200) return null;
  const mean = (n: number) => closed.slice(-n).reduce((a, c) => a + c.close, 0) / n;
  const close = closed[closed.length - 1].close;
  const sma50 = mean(50), sma200 = mean(200);
  const bullish = close > sma200;
  const label = close > sma200 && sma50 > sma200 ? 'Alta' : close < sma200 && sma50 < sma200 ? 'Baixa' : 'Lateral';
  return { bullish, close, sma50, sma200, change20dPct: (close / closed[closed.length - 21].close - 1) * 100, label };
}

export { btcRegimeByDay as ibovRegimeByDay };

/** Procura sinal de indicadores na última vela FECHADA (mesmo motor das criptos, só compra). */
export function detectIndicatorEntry(closed: CandleData[], bullish: boolean, symbol: string, now: number = Date.now()): B3Signal | null {
  if (!bullish || closed.length < 80) return null;
  const window = calculateAllIndicators(closed.slice(-120), 10);
  const sig = evaluateSignal(window, { symbol, baseAsset: symbol, timeframe: '1D' });
  if (!sig || sig.direction !== 'LONG') return null;
  const c = closed[closed.length - 1];
  return {
    id: `${symbol}-ind-${c.timestamp}`,
    symbol,
    signalDay: c.timestamp,
    createdAt: now,
    refPrice: c.close,
    stopPrice: c.close - ATR_STOP_MULT * sig.atr,   // provisório até a abertura do pregão seguinte
    targetPrice: c.close + ATR_TARGET_MULT * sig.atr,
    atr: sig.atr,
    score: sig.score,
    status: 'OPEN',
    lastPrice: c.close
  };
}

/** Pontuação de compra (para o ranking "mais fortes agora"); null se não houver dados. */
export function indicatorScoreNow(closed: CandleData[]): number | null {
  if (closed.length < 80) return null;
  const w = calculateAllIndicators(closed.slice(-120), 10);
  const last = w[w.length - 1];
  const prev = w[w.length - 2];
  if (!last.macd || !prev.macd || last.rsi === undefined || last.ema20 === undefined || last.ema50 === undefined) return null;
  // mesma conta do motor, sem as travas (para mostrar o quanto falta)
  let t = (last.close > last.ema50 ? 15 : -15) + (last.ema20 > last.ema50 ? 15 : -15);
  t += (last.macd.histogram > 0 ? 15 : -15) + (last.macd.histogram > prev.macd.histogram ? 10 : -10);
  t += last.rsi <= 30 ? 25 : last.rsi >= 70 ? -25 : last.rsi >= 55 ? 15 : last.rsi <= 45 ? -15 : 0;
  return t;
}

/** Atualiza um sinal com as velas mais recentes (inclui o pregão em andamento). Mesmas regras do backtest. */
export function updateIndicatorSignal(sig: B3Signal, candles: CandleData[], now: number = Date.now()): B3Signal {
  if (isB3Done(sig)) return sig;
  const entryIdx = candles.findIndex((c) => c.timestamp > sig.signalDay);
  const out: B3Signal = { ...sig };
  if (entryIdx < 0) return out; // o pregão da entrada ainda não começou

  const entry = candles[entryIdx].open;
  out.entryPrice = entry;
  out.stopPrice = entry - ATR_STOP_MULT * sig.atr;
  out.targetPrice = entry + ATR_TARGET_MULT * sig.atr;
  out.lastPrice = candles[candles.length - 1].close;

  for (let j = entryIdx; j < candles.length; j++) {
    const d = candles[j];
    if (d.low <= out.stopPrice) { // o stop tem prioridade; gap para baixo sai na abertura
      out.status = 'STOP'; out.exitPrice = Math.min(out.stopPrice, d.open); out.closedAt = d.timestamp; return out;
    }
    if (d.high >= out.targetPrice) {
      out.status = 'TARGET'; out.exitPrice = Math.max(out.targetPrice, d.open); // gap para cima sai na abertura
      out.closedAt = d.timestamp; return out;
    }
    const closedDay = d.timestamp + DAY_MS <= now;
    if (closedDay && j - entryIdx >= B3_HOLD_DAYS) {
      if (j + 1 < candles.length) { out.status = 'TIMEOUT'; out.exitPrice = candles[j + 1].open; out.closedAt = candles[j + 1].timestamp; }
      else out.status = 'EXIT_SIGNAL'; // prazo de 20 pregões: sai na abertura de amanhã
      return out;
    }
  }
  return out;
}

export function indicatorSignalResult(sig: B3Signal): { netPct: number; r: number } | null {
  if (!isB3Done(sig) || sig.entryPrice === undefined || sig.exitPrice === undefined) return null;
  const cost = 2 * (DEFAULT_BACKTEST_OPTIONS.feeRate + DEFAULT_BACKTEST_OPTIONS.slippageRate) * 100;
  const net = ((sig.exitPrice - sig.entryPrice) / sig.entryPrice) * 100 - cost;
  const riskPct = ((ATR_STOP_MULT * sig.atr) / sig.entryPrice) * 100;
  return { netPct: net, r: riskPct > 0 ? net / riskPct : 0 };
}

export function evaluateB3Readiness(signals: B3Signal[], now = Date.now()): TrendReadiness {
  const results = signals.map(indicatorSignalResult).filter((r): r is { netPct: number; r: number } => r !== null);
  const days = signals.length ? (now - Math.min(...signals.map((s) => s.createdAt))) / 86400000 : 0;
  return readinessFromResults(results.map((r) => r.netPct), days);
}

/**
 * Tamanho da posição pelo risco: quanto do capital se perde se o stop for atingido.
 * Lote padrão da B3 = 100 ações; o mercado fracionário (ticker com F) permite de 1 a 99.
 */
export function b3Sizing(capital: number, riskPercent: number, entry: number, stop: number) {
  if (!(capital > 0) || !(entry > stop) || !(stop > 0)) return null;
  const riskBrl = capital * (riskPercent / 100);
  let shares = Math.floor(riskBrl / (entry - stop));
  shares = Math.min(shares, Math.floor(capital / entry)); // sem alavancagem: não passa do capital
  if (shares < 1) return null;
  return { shares, cost: shares * entry, riskBrl: shares * (entry - stop), fractional: shares % 100 !== 0, lots: Math.floor(shares / 100) };
}

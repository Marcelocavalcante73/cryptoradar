/**
 * Motor de sinais do CryptoRadar.
 *
 * Função pura: recebe candles FECHADOS (já com indicadores via calculateAllIndicators)
 * e devolve um sinal de COMPRA (LONG) ou VENDA (SHORT) apenas quando a confluência
 * de indicadores atinge a pontuação mínima. Stop e alvo são calculados pelo ATR.
 *
 * Pontuação (-100 a +100, positivo = comprador):
 *  - Tendência (±30): preço vs EMA50 e EMA20 vs EMA50
 *  - Momentum  (±25): sinal e inclinação do histograma MACD
 *  - RSI       (±25): sobrevenda/sobrecompra e zona de força
 *  - Volume    (±10): volume acima da média confirma a direção do candle
 *  - Evento    (±10): cruzamento recente de EMA20/50 ou do MACD
 *
 * Filtro: sem separação mínima entre EMA20 e EMA50 (em ATR) o mercado é tratado como lateral e não há sinal.
 */

import { CandleData, SignalDirection, SignalStrategy, TechnicalSignal } from '../types/crypto';
import { calculateATR } from './indicators';

export const MIN_CANDLES = 60;
export const MIN_SCORE = 60;
export const ATR_STOP_MULT = 1.5;
export const ATR_TARGET_MULT = 3; // R:R 1:2
export const MIN_TREND_STRENGTH_ATR = 1; // |EMA20 - EMA50| mínimo, em múltiplos de ATR (filtra mercado lateral)

export interface SignalContext {
  symbol: string;
  baseAsset: string;
  timeframe: string;
  now?: Date;
}

export interface ScoreBreakdown {
  trend: number;
  momentum: number;
  rsi: number;
  volume: number;
  event: number;
  total: number;
}

export interface EngineSignal extends TechnicalSignal {
  score: number;
  breakdown: ScoreBreakdown;
  atr: number;
}

const STRATEGY_NAMES: Record<SignalStrategy, string> = {
  RSI_DIVERGENCE: 'Reversão por RSI Extremo',
  EMA_GOLDEN_CROSS: 'Cruzamento de Médias (EMA 20/50)',
  BREAKOUT_RESISTANCE: 'Rompimento com Volume',
  SUPPORT_RETEST: 'Reteste de Suporte',
  MEAN_REVERSION: 'Reversão à Média',
  VOLUME_SPIKE: 'Pico de Volume'
};

const DISCLAIMER =
  'Sinal técnico automático, não é recomendação de investimento. Cripto é ativo de alto risco; use sempre stop loss.';

function avgVolume(candles: CandleData[], lookback = 20): number {
  const slice = candles.slice(-lookback - 1, -1);
  if (slice.length === 0) return 0;
  return slice.reduce((s, c) => s + c.volume, 0) / slice.length;
}

export function scoreCandles(candles: CandleData[]): ScoreBreakdown | null {
  if (candles.length < MIN_CANDLES) return null;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  if (
    last.ema20 === undefined || last.ema50 === undefined ||
    last.rsi === undefined || last.macd === undefined || prev.macd === undefined
  ) {
    return null;
  }

  // Tendência
  let trend = 0;
  trend += last.close > last.ema50 ? 15 : -15;
  trend += last.ema20 > last.ema50 ? 15 : -15;

  // Momentum (MACD)
  let momentum = 0;
  momentum += last.macd.histogram > 0 ? 15 : -15;
  momentum += last.macd.histogram > prev.macd.histogram ? 10 : -10;

  // RSI
  let rsi = 0;
  if (last.rsi <= 30) rsi = 25;
  else if (last.rsi >= 70) rsi = -25;
  else if (last.rsi >= 55) rsi = 15;
  else if (last.rsi <= 45) rsi = -15;

  // Volume confirma a direção do candle
  let volume = 0;
  const avgVol = avgVolume(candles);
  if (avgVol > 0 && last.volume >= avgVol * 1.5) {
    volume = last.close >= last.open ? 10 : -10;
  }

  // Eventos de cruzamento nas últimas 3 velas
  let event = 0;
  for (let i = candles.length - 3; i < candles.length; i++) {
    const a = candles[i - 1];
    const b = candles[i];
    if (a.ema20 !== undefined && a.ema50 !== undefined && b.ema20 !== undefined && b.ema50 !== undefined) {
      if (a.ema20 <= a.ema50 && b.ema20 > b.ema50) event = 10;
      else if (a.ema20 >= a.ema50 && b.ema20 < b.ema50) event = -10;
    }
    if (a.macd && b.macd) {
      if (a.macd.macd <= a.macd.signal && b.macd.macd > b.macd.signal) event = Math.max(event, 10);
      else if (a.macd.macd >= a.macd.signal && b.macd.macd < b.macd.signal) event = Math.min(event, -10);
    }
  }

  return { trend, momentum, rsi, volume, event, total: trend + momentum + rsi + volume + event };
}

function pickStrategy(candles: CandleData[], b: ScoreBreakdown, direction: SignalDirection): SignalStrategy {
  const sign = direction === 'LONG' ? 1 : -1;
  const last = candles[candles.length - 1];
  if (b.event * sign > 0) return 'EMA_GOLDEN_CROSS';
  if (last.rsi !== undefined && (last.rsi <= 30 || last.rsi >= 70) && b.rsi * sign > 0) return 'RSI_DIVERGENCE';
  if (b.volume * sign > 0) return 'VOLUME_SPIKE';
  return 'BREAKOUT_RESISTANCE';
}

function roundPrice(price: number): number {
  const decimals = price >= 1000 ? 2 : price >= 1 ? 4 : price >= 0.01 ? 6 : 8;
  return Number(price.toFixed(decimals));
}

/**
 * Avalia candles fechados e devolve um sinal, ou null se não houver confluência suficiente.
 */
export function evaluateSignal(candles: CandleData[], ctx: SignalContext): EngineSignal | null {
  const breakdown = scoreCandles(candles);
  if (!breakdown || Math.abs(breakdown.total) < MIN_SCORE) return null;

  const atr = calculateATR(candles);
  if (atr === undefined || atr <= 0) return null;

  const last = candles[candles.length - 1];
  // Filtro de mercado lateral: sem separação relevante entre as médias, a "tendência" é ruído
  if (Math.abs(last.ema20! - last.ema50!) < atr * MIN_TREND_STRENGTH_ATR) return null;
  const direction: SignalDirection = breakdown.total > 0 ? 'LONG' : 'SHORT';
  const sign = direction === 'LONG' ? 1 : -1;
  const entry = last.close;
  const stop = entry - sign * atr * ATR_STOP_MULT;
  const target = entry + sign * atr * ATR_TARGET_MULT;
  if (stop <= 0) return null;

  const strategy = pickStrategy(candles, breakdown, direction);
  const now = ctx.now ?? new Date();

  const triggered: string[] = [
    `Tendência ${breakdown.trend * sign > 0 ? 'alinhada' : 'mista'} (${breakdown.trend > 0 ? '+' : ''}${breakdown.trend})`,
    `MACD ${breakdown.momentum * sign > 0 ? 'confirma' : 'neutro'} (${breakdown.momentum > 0 ? '+' : ''}${breakdown.momentum})`,
    `RSI ${last.rsi!.toFixed(1)}`
  ];
  if (breakdown.volume !== 0) triggered.push('Volume acima da média');
  if (breakdown.event !== 0) triggered.push('Cruzamento recente');

  return {
    id: `${ctx.symbol}-${ctx.timeframe}-${last.timestamp}`,
    symbol: ctx.symbol,
    baseAsset: ctx.baseAsset,
    direction,
    strategy,
    strategyName: STRATEGY_NAMES[strategy],
    timeframe: ctx.timeframe,
    entryPrice: roundPrice(entry),
    targetPrice: roundPrice(target),
    stopLossPrice: roundPrice(stop),
    riskRewardRatio: `1:${(ATR_TARGET_MULT / ATR_STOP_MULT).toFixed(1)}`,
    status: 'OPEN',
    technicalReason:
      `${direction === 'LONG' ? 'Compra' : 'Venda'} com pontuação ${breakdown.total > 0 ? '+' : ''}${breakdown.total}/100 ` +
      `(mínimo ${MIN_SCORE}). Stop e alvo baseados em ATR(14) = ${roundPrice(atr)}.`,
    indicatorsTriggered: triggered,
    timestamp: now.toLocaleString('pt-BR'),
    isDemo: false,
    disclaimer: DISCLAIMER,
    score: breakdown.total,
    breakdown,
    atr: roundPrice(atr)
  };
}

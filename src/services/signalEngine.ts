/**
 * Motor de sinais do CryptoRadar.
 *
 * Função pura: recebe candles FECHADOS (já com indicadores via calculateAllIndicators)
 * e devolve um sinal de COMPRA (LONG) ou VENDA (SHORT) apenas quando a confluência
 * de indicadores atinge a pontuação mínima. Stop e alvo são calculados pelo ATR.
 *
 * Pontuação (-100 a +100, positivo = comprador):
 *  - Tendência (±30): preço vs EMA50 e EMA20 vs EMA50 com alinhamento direcional
 *  - Momentum  (±25): sinal e inclinação do histograma MACD
 *  - RSI       (±25): zonas de momento saudável e proteção contra exaustão de topo/fundo
 *  - Volume    (±10): volume acima da média confirma a direção do candle
 *  - Evento    (±10): cruzamento recente de EMA20/50, MACD ou rompimento de Bandas de Bollinger
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
  RSI_DIVERGENCE: 'Reversão por RSI',
  EMA_GOLDEN_CROSS: 'Cruzamento de Médias (EMA 20/50)',
  BREAKOUT_RESISTANCE: 'Rompimento de Tendência',
  SUPPORT_RETEST: 'Reteste de Suporte / Médias',
  MEAN_REVERSION: 'Reversão às Bandas de Bollinger',
  VOLUME_SPIKE: 'Pico de Volume Direcional',
  AI_ENGINE_MOMENTUM: 'Motor IA: Momentum',
  AI_ENGINE_BREAKOUT: 'Motor IA: Rompimento',
  AI_ENGINE_REVERSAL: 'Motor IA: Reversão'
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

  // 1. Tendência (±30)
  let trend = 0;
  trend += last.close > last.ema50 ? 15 : -15;
  trend += last.ema20 > last.ema50 ? 15 : -15;

  // 2. Momentum (MACD) (±25)
  let momentum = 0;
  momentum += last.macd.histogram > 0 ? 15 : -15;
  momentum += last.macd.histogram > prev.macd.histogram ? 10 : -10;

  // 3. RSI inteligente ajustado para LONG e SHORT (±25)
  let rsi = 0;
  if (trend > 0) {
    // Mercado em alta:
    if (last.rsi >= 80) {
      // Exaustão de alta parabólica: não comprar topo
      rsi = -25;
    } else if (last.rsi >= 52 && last.rsi < 75) {
      // Zona ideal de expansão de momentum para Long
      rsi = 25;
    } else if (last.rsi >= 40 && last.rsi < 52) {
      // Zona de pullback saudável com espaço para expansão
      rsi = 15;
    } else if (last.rsi < 35) {
      // Sobrevenda com potencial de repique no suporte
      rsi = 20;
    } else {
      rsi = 0;
    }
  } else if (trend < 0) {
    // Mercado em baixa:
    if (last.rsi <= 18) {
      // Exaustão de queda extrema: não vender no fundo do poço
      rsi = 20;
    } else if (last.rsi <= 48 && last.rsi > 20) {
      // Zona ideal de expansão de momentum para Short
      rsi = -25;
    } else if (last.rsi > 48 && last.rsi <= 60) {
      // Pullback de baixa sendo rejeitado
      rsi = -15;
    } else if (last.rsi >= 65) {
      // Repique de sobrecompra em tendência de baixa
      rsi = -20;
    } else {
      rsi = 0;
    }
  } else {
    // Mercado neutro / em transição
    if (last.rsi <= 30) rsi = 25;
    else if (last.rsi >= 70) rsi = -25;
    else if (last.rsi >= 55) rsi = 15;
    else if (last.rsi <= 45) rsi = -15;
  }

  // 4. Volume confirma a direção do candle (±10)
  let volume = 0;
  const avgVol = avgVolume(candles);
  if (avgVol > 0 && last.volume >= avgVol * 1.2) {
    volume = last.close >= last.open ? 10 : -10;
  }

  // 5. Eventos de cruzamento ou rompimento nas últimas 3 velas (±10)
  let event = 0;
  for (let i = candles.length - 3; i < candles.length; i++) {
    const a = candles[i - 1];
    const b = candles[i];
    if (a && b) {
      if (a.ema20 !== undefined && a.ema50 !== undefined && b.ema20 !== undefined && b.ema50 !== undefined) {
        if (a.ema20 <= a.ema50 && b.ema20 > b.ema50) event = 10;
        else if (a.ema20 >= a.ema50 && b.ema20 < b.ema50) event = -10;
      }
      if (a.macd && b.macd) {
        if (a.macd.macd <= a.macd.signal && b.macd.macd > b.macd.signal) event = Math.max(event, 10);
        else if (a.macd.macd >= a.macd.signal && b.macd.macd < b.macd.signal) event = Math.min(event, -10);
      }
    }
  }

  // Se não houve cruzamento de médias/MACD, verifica rompimento de Bandas de Bollinger
  if (event === 0 && last.bollinger && prev.bollinger) {
    if (trend > 0 && last.close > last.bollinger.middle && prev.close <= prev.bollinger.middle) {
      event = 10;
    } else if (trend < 0 && last.close < last.bollinger.middle && prev.close >= prev.bollinger.middle) {
      event = -10;
    }
  }

  return { trend, momentum, rsi, volume, event, total: trend + momentum + rsi + volume + event };
}

function pickStrategy(candles: CandleData[], b: ScoreBreakdown, direction: SignalDirection): SignalStrategy {
  const sign = direction === 'LONG' ? 1 : -1;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  if (b.event * sign > 0) {
    if (prev && last.ema20 && last.ema50 && prev.ema20 && prev.ema50) {
      if ((sign === 1 && prev.ema20 <= prev.ema50 && last.ema20 > last.ema50) ||
          (sign === -1 && prev.ema20 >= prev.ema50 && last.ema20 < last.ema50)) {
        return 'EMA_GOLDEN_CROSS';
      }
    }
  }

  if (last.bollinger) {
    if (sign === 1 && last.low <= last.bollinger.lower && last.close > last.open) {
      return 'MEAN_REVERSION';
    }
    if (sign === -1 && last.high >= last.bollinger.upper && last.close < last.open) {
      return 'MEAN_REVERSION';
    }
  }

  if (last.rsi !== undefined && ((sign === 1 && last.rsi <= 35) || (sign === -1 && last.rsi >= 65))) {
    return 'RSI_DIVERGENCE';
  }

  if (last.ema20 !== undefined && Math.abs(last.close - last.ema20) / last.close < 0.008) {
    return 'SUPPORT_RETEST';
  }

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
  const prev = candles[candles.length - 2];
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

  // Cálculo detalhado dos indicadores para confluência técnica transparente
  const avgVol = avgVolume(candles);
  const volRatio = avgVol > 0 ? Number((last.volume / avgVol).toFixed(2)) : 1.0;
  const atrPct = Number(((atr / entry) * 100).toFixed(2));
  const trendGapAtr = Number((Math.abs(last.ema20! - last.ema50!) / atr).toFixed(2));

  let bbPos = 'Neutro';
  if (last.bollinger) {
    if (last.close > last.bollinger.upper) bbPos = 'Rompimento Banda Superior';
    else if (last.close < last.bollinger.lower) bbPos = 'Rompimento Banda Inferior';
    else if (last.close >= last.bollinger.middle) bbPos = 'Acima da Banda Central';
    else bbPos = 'Abaixo da Banda Central';
  }

  const rsiVal = Number(last.rsi!.toFixed(1));
  const rsiZone = rsiVal >= 75 ? 'Sobrecompra' : rsiVal <= 25 ? 'Sobrevenda' : rsiVal >= 50 ? 'Zona Compradora' : 'Zona Vendedora';

  const macdHistVal = Number(last.macd!.histogram.toFixed(4));
  const macdSig = last.macd!.histogram > 0
    ? (last.macd!.histogram > prev.macd!.histogram ? 'Aceleração Bullish' : 'Perda de Força Bullish')
    : (last.macd!.histogram < prev.macd!.histogram ? 'Aceleração Bearish' : 'Desaceleração Bearish');

  const emaTrendDesc = last.ema20! > last.ema50! ? 'EMA 20 > EMA 50 (Alta)' : 'EMA 20 < EMA 50 (Baixa)';

  const indicatorMetrics = {
    rsi: rsiVal,
    rsiZone,
    macdHistogram: macdHistVal,
    macdSignal: macdSig,
    emaTrend: emaTrendDesc,
    bollingerPosition: bbPos,
    volumeRatio: volRatio,
    atrPercent: atrPct,
    trendStrengthAtr: trendGapAtr
  };

  const triggered: string[] = [
    `RSI ${rsiVal} (${rsiZone})`,
    `MACD Hist ${macdHistVal > 0 ? '+' : ''}${macdHistVal.toFixed(2)} (${macdSig})`,
    `Médias: ${emaTrendDesc}`,
    `Bandas: ${bbPos}`,
    `Volume: ${volRatio}x da média`,
    `ATR(14): ${atrPct}% (R:R 1:${(ATR_TARGET_MULT / ATR_STOP_MULT).toFixed(1)})`
  ];

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
      `${direction === 'LONG' ? 'Compra (Long)' : 'Venda (Short)'} por confluência técnica com pontuação ${breakdown.total > 0 ? '+' : ''}${breakdown.total}/100 ` +
      `(mínimo ${MIN_SCORE}). Stop em ${roundPrice(stop)} e alvo em ${roundPrice(target)} via ATR(14) = ${roundPrice(atr)}.`,
    indicatorsTriggered: triggered,
    indicatorMetrics,
    timestamp: now.toLocaleString('pt-BR'),
    isDemo: false,
    disclaimer: DISCLAIMER,
    score: breakdown.total,
    breakdown,
    atr: roundPrice(atr)
  };
}

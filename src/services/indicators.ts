import { CandleData, CryptoAsset } from '../types/crypto';

export interface SentimentIndex {
  score: number;
  label: 'Medo Extremo' | 'Medo' | 'Neutro' | 'Ganância' | 'Ganância Extrema';
  sentiment: 'extreme_fear' | 'fear' | 'neutral' | 'greed' | 'extreme_greed';
  color: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
  averageChange: number;
  advancersCount: number;
  declinersCount: number;
  totalAssets: number;
}

/**
 * Cálculo do RSI (Relative Strength Index) utilizando a suavização de Wilder (1978).
 * Trata rigorosamente:
 * - Séries curtas (< período)
 * - Cenários sem perdas (apenas altas => RSI = 100.0)
 * - Cenários sem ganhos (apenas quedas => RSI = 0.0)
 * - Cenários sem variação (preço estável => RSI = 50.0)
 */
export function calculateWilderRSI(candles: CandleData[], period: number = 14): CandleData[] {
  const result = candles.map((c) => ({ ...c }));
  if (result.length === 0) return result;

  if (result.length === 1) {
    result[0].rsi = 50.0;
    return result;
  }

  // Primeira vela não possui variação anterior
  result[0].rsi = 50.0;

  if (result.length <= period) {
    // Série curta: menor ou igual ao período configurado (ex: <= 14)
    let cumulativeGain = 0;
    let cumulativeLoss = 0;

    for (let i = 1; i < result.length; i++) {
      const diff = result[i].close - result[i - 1].close;
      if (diff > 0) cumulativeGain += diff;
      else if (diff < 0) cumulativeLoss += Math.abs(diff);

      if (cumulativeGain === 0 && cumulativeLoss === 0) {
        result[i].rsi = 50.0; // Sem ganhos e sem perdas
      } else if (cumulativeLoss === 0) {
        result[i].rsi = 100.0; // Apenas ganhos, sem perdas
      } else if (cumulativeGain === 0) {
        result[i].rsi = 0.0; // Apenas perdas, sem ganhos
      } else {
        const rs = cumulativeGain / cumulativeLoss;
        const rsi = 100 - (100 / (1 + rs));
        result[i].rsi = Number(Math.min(100, Math.max(0, rsi)).toFixed(1));
      }
    }

    return result;
  }

  // Série com mais velas que o período configurado:
  // Inicialização no índice `period` acumulando os primeiros `period` deltas
  let initialGainSum = 0;
  let initialLossSum = 0;

  for (let i = 1; i < period; i++) {
    const diff = result[i].close - result[i - 1].close;
    if (diff > 0) initialGainSum += diff;
    else if (diff < 0) initialLossSum += Math.abs(diff);

    if (initialGainSum === 0 && initialLossSum === 0) {
      result[i].rsi = 50.0;
    } else if (initialLossSum === 0) {
      result[i].rsi = 100.0;
    } else if (initialGainSum === 0) {
      result[i].rsi = 0.0;
    } else {
      const rs = initialGainSum / initialLossSum;
      const rsi = 100 - (100 / (1 + rs));
      result[i].rsi = Number(Math.min(100, Math.max(0, rsi)).toFixed(1));
    }
  }

  // Delta da vela no índice `period`
  const periodDiff = result[period].close - result[period - 1].close;
  if (periodDiff > 0) initialGainSum += periodDiff;
  else if (periodDiff < 0) initialLossSum += Math.abs(periodDiff);

  let avgGain = initialGainSum / period;
  let avgLoss = initialLossSum / period;

  if (avgGain === 0 && avgLoss === 0) {
    result[period].rsi = 50.0;
  } else if (avgLoss === 0) {
    result[period].rsi = 100.0;
  } else if (avgGain === 0) {
    result[period].rsi = 0.0;
  } else {
    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    result[period].rsi = Number(Math.min(100, Math.max(0, rsi)).toFixed(1));
  }

  // A partir de period + 1: aplicação estrita da suavização de Wilder
  for (let i = period + 1; i < result.length; i++) {
    const diff = result[i].close - result[i - 1].close;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgGain === 0 && avgLoss === 0) {
      result[i].rsi = 50.0;
    } else if (avgLoss === 0) {
      result[i].rsi = 100.0;
    } else if (avgGain === 0) {
      result[i].rsi = 0.0;
    } else {
      const rs = avgGain / avgLoss;
      const rsi = 100 - (100 / (1 + rs));
      result[i].rsi = Number(Math.min(100, Math.max(0, rsi)).toFixed(1));
    }
  }

  return result;
}

/**
 * Calcula EMA (Exponential Moving Average) para um período específico.
 */
export function calculateEMA(candles: CandleData[], period: number, decimals: number = 2): CandleData[] {
  const result = candles.map((c) => ({ ...c }));
  if (result.length === 0) return result;

  const k = 2 / (period + 1);
  let ema = result[0].close;

  for (let i = 0; i < result.length; i++) {
    ema = result[i].close * k + ema * (1 - k);
    if (period === 20) {
      result[i].ema20 = Number(ema.toFixed(decimals));
    } else if (period === 50) {
      result[i].ema50 = Number(ema.toFixed(decimals));
    }
  }

  return result;
}

/**
 * Calcula MACD (Moving Average Convergence Divergence) e Linha de Sinal.
 */
export function calculateMACD(
  candles: CandleData[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9,
  decimals: number = 2
): CandleData[] {
  const result = candles.map((c) => ({ ...c }));
  if (result.length === 0) return result;

  const kFast = 2 / (fastPeriod + 1);
  const kSlow = 2 / (slowPeriod + 1);
  const kSignal = 2 / (signalPeriod + 1);

  let emaFast = result[0].close;
  let emaSlow = result[0].close;
  let signal = 0;

  for (let i = 0; i < result.length; i++) {
    emaFast = result[i].close * kFast + emaFast * (1 - kFast);
    emaSlow = result[i].close * kSlow + emaSlow * (1 - kSlow);
    const macdLine = emaFast - emaSlow;

    if (i === 0) {
      signal = macdLine;
    } else {
      signal = macdLine * kSignal + signal * (1 - kSignal);
    }
    const histogram = macdLine - signal;

    result[i].macd = {
      macd: Number(macdLine.toFixed(decimals)),
      signal: Number(signal.toFixed(decimals)),
      histogram: Number(histogram.toFixed(decimals))
    };
  }

  return result;
}

/**
 * Agrupa o cálculo de todos os indicadores técnicos sobre as velas.
 */
export function calculateAllIndicators(candles: CandleData[], decimals: number = 2): CandleData[] {
  let processed = calculateEMA(candles, 20, decimals);
  processed = calculateEMA(processed, 50, decimals);
  processed = calculateWilderRSI(processed, 14);
  processed = calculateMACD(processed, 12, 26, 9, decimals);
  return processed;
}

/**
 * Calcula o Índice de Sentimento (Fear & Greed) com base nas flutuações de preços dos ativos monitorados.
 * Combina:
 * 1. Momentum ponderado de 24h (50% do peso, com maior relevância para BTC, ETH e SOL)
 * 2. Posição relativa dentro da amplitude diária [High24h - Low24h] (30% do peso)
 * 3. Amplitude de mercado (proporção de moedas em alta vs baixa) (20% do peso)
 */
export function calculateFearGreedIndex(assets: CryptoAsset[]): SentimentIndex {
  if (!assets || assets.length === 0) {
    return {
      score: 50,
      label: 'Neutro',
      sentiment: 'neutral',
      color: '#94A3B8',
      bgClass: 'bg-slate-500/15',
      textClass: 'text-slate-300',
      borderClass: 'border-slate-500/30',
      averageChange: 0,
      advancersCount: 0,
      declinersCount: 0,
      totalAssets: 0
    };
  }

  // 1. Momentum ponderado de 24h
  let totalWeight = 0;
  let weightedChangeSum = 0;
  let rawChangeSum = 0;
  let advancers = 0;
  let decliners = 0;
  let rangeScoreSum = 0;
  let validRangeCount = 0;

  for (const asset of assets) {
    const change = Number.isFinite(asset.change24h) ? asset.change24h : 0;
    rawChangeSum += change;

    if (change > 0) advancers++;
    else if (change < 0) decliners++;

    // Pesos específicos de dominância
    let weight = 1.0;
    if (asset.symbol === 'BTCUSDT') weight = 4.0;
    else if (asset.symbol === 'ETHUSDT') weight = 2.5;
    else if (asset.symbol === 'SOLUSDT') weight = 1.8;

    weightedChangeSum += change * weight;
    totalWeight += weight;

    // Amplitude dentro do range 24h (High - Low)
    if (asset.high24h > asset.low24h && asset.price >= asset.low24h) {
      const posInRange = Math.max(0, Math.min(1, (asset.price - asset.low24h) / (asset.high24h - asset.low24h)));
      rangeScoreSum += posInRange * weight;
      validRangeCount += weight;
    }
  }

  const weightedChange = totalWeight > 0 ? weightedChangeSum / totalWeight : 0;
  const averageChange = Number((rawChangeSum / assets.length).toFixed(2));

  // Converte momentum ponderado (-8% a +8% representa faixa usual de alta/baixa) para escala 0 a 100
  // 0% -> 50 | +8% -> 90 | -8% -> 10
  const momentumScore = Math.max(5, Math.min(95, 50 + (weightedChange / 8) * 40));

  // Range score (proximidade de máximas vs mínimas de 24h)
  const rangeScore = validRangeCount > 0 ? Math.max(5, Math.min(95, (rangeScoreSum / validRangeCount) * 100)) : 50;

  // Breadth score (percentual de ativos em alta)
  const breadthScore = Math.max(5, Math.min(95, (advancers / assets.length) * 100));

  // Pontuação final composta (0 a 100)
  const rawScore = Math.round(0.50 * momentumScore + 0.30 * rangeScore + 0.20 * breadthScore);
  const score = Math.max(0, Math.min(100, rawScore));

  let label: 'Medo Extremo' | 'Medo' | 'Neutro' | 'Ganância' | 'Ganância Extrema';
  let sentiment: 'extreme_fear' | 'fear' | 'neutral' | 'greed' | 'extreme_greed';
  let color: string;
  let bgClass: string;
  let textClass: string;
  let borderClass: string;

  if (score <= 24) {
    label = 'Medo Extremo';
    sentiment = 'extreme_fear';
    color = '#F43F5E';
    bgClass = 'bg-rose-500/15';
    textClass = 'text-rose-400';
    borderClass = 'border-rose-500/30';
  } else if (score <= 44) {
    label = 'Medo';
    sentiment = 'fear';
    color = '#FB923C';
    bgClass = 'bg-orange-500/15';
    textClass = 'text-orange-400';
    borderClass = 'border-orange-500/30';
  } else if (score <= 55) {
    label = 'Neutro';
    sentiment = 'neutral';
    color = '#94A3B8';
    bgClass = 'bg-slate-500/15';
    textClass = 'text-slate-300';
    borderClass = 'border-slate-500/30';
  } else if (score <= 75) {
    label = 'Ganância';
    sentiment = 'greed';
    color = '#10B981';
    bgClass = 'bg-emerald-500/15';
    textClass = 'text-emerald-400';
    borderClass = 'border-emerald-500/30';
  } else {
    label = 'Ganância Extrema';
    sentiment = 'extreme_greed';
    color = '#22C55E';
    bgClass = 'bg-green-500/20';
    textClass = 'text-green-400';
    borderClass = 'border-green-500/30';
  }

  return {
    score,
    label,
    sentiment,
    color,
    bgClass,
    textClass,
    borderClass,
    averageChange,
    advancersCount: advancers,
    declinersCount: decliners,
    totalAssets: assets.length
  };
}


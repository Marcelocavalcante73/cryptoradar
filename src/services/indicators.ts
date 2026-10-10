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
 * Cálculo do RSI (Relative Strength Index) utilizando a suavização estrita de J. Welles Wilder Jr. (1978).
 * 
 * Regras auditadas de conformidade matemática:
 * 1. Warm-up: Nas primeiras `period` velas (índices 0 até `period - 1`), o indicador está em aquecimento
 *    e retorna estritamente `undefined` (diferencia indisponível de neutro 50.0).
 * 2. Inicialização: No índice `period` (após exatamente `period` variações de preço),
 *    calcula-se a média aritmética simples inicial de ganhos e perdas (SMA dos primeiros `period` deltas).
 * 3. Suavização: A partir do índice `period + 1`, aplica-se o alisamento exponencial de Wilder:
 *    avgGain = (prevAvgGain * (period - 1) + gain) / period
 *    avgLoss = (prevAvgLoss * (period - 1) + loss) / period
 * 4. Casos Limite Legítimos:
 *    - Se avgGain === 0 e avgLoss === 0 (mercado flat por todo o período) => RSI = 50.0 (neutro legítimo).
 *    - Se avgLoss === 0 (somente altas) => RSI = 100.0.
 *    - Se avgGain === 0 (somente baixas) => RSI = 0.0.
 */
export function calculateWilderRSI(candles: CandleData[], period: number = 14): CandleData[] {
  const result = candles.map((c) => ({ ...c }));
  if (result.length === 0) return result;

  // Séries curtas ou em período de aquecimento: todos os candles anteriores ao período ficam indefinidos
  if (result.length <= period) {
    for (let i = 0; i < result.length; i++) {
      result[i].rsi = undefined;
    }
    return result;
  }

  // Velas 0 até period - 1 estão em warm-up (cálculo indisponível)
  for (let i = 0; i < period; i++) {
    result[i].rsi = undefined;
  }

  // Acumulação dos primeiros `period` deltas (índices 1 a period)
  let initialGainSum = 0;
  let initialLossSum = 0;

  for (let i = 1; i <= period; i++) {
    const prevClose = result[i - 1].close;
    const currentClose = result[i].close;

    if (!Number.isFinite(prevClose) || !Number.isFinite(currentClose)) {
      continue;
    }

    const diff = currentClose - prevClose;
    if (diff > 0) initialGainSum += diff;
    else if (diff < 0) initialLossSum += Math.abs(diff);
  }

  let avgGain = initialGainSum / period;
  let avgLoss = initialLossSum / period;

  // Cálculo da primeira vela no índice `period`
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

  // A partir de `period + 1`: aplicação do Wilder smoothing
  for (let i = period + 1; i < result.length; i++) {
    const prevClose = result[i - 1].close;
    const currentClose = result[i].close;

    if (!Number.isFinite(prevClose) || !Number.isFinite(currentClose)) {
      result[i].rsi = result[i - 1].rsi;
      continue;
    }

    const diff = currentClose - prevClose;
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
 * Calcula EMA (Exponential Moving Average) com período de aquecimento explícito.
 * - Índices antes de `period - 1`: `undefined` (aquecimento / indisponível).
 * - Índice `period - 1`: Média aritmética simples (SMA) dos primeiros `period` fechamentos.
 * - Índices `>= period`: Fórmula exponencial de alisamento com multiplicador k = 2 / (period + 1).
 */
export function calculateEMA(candles: CandleData[], period: number, decimals: number = 2): CandleData[] {
  const result = candles.map((c) => ({ ...c }));
  if (result.length === 0) return result;

  // Se a série tiver menos velas que o período necessário, a EMA fica indefinida
  if (result.length < period) {
    for (let i = 0; i < result.length; i++) {
      if (period === 20) result[i].ema20 = undefined;
      else if (period === 50) result[i].ema50 = undefined;
    }
    return result;
  }

  // Warm-up: velas antes de period - 1
  for (let i = 0; i < period - 1; i++) {
    if (period === 20) result[i].ema20 = undefined;
    else if (period === 50) result[i].ema50 = undefined;
  }

  // Inicialização no índice period - 1 com a SMA dos primeiros `period` valores
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += Number.isFinite(result[i].close) ? result[i].close : 0;
  }
  let currentEma = sum / period;

  if (period === 20) {
    result[period - 1].ema20 = Number(currentEma.toFixed(decimals));
  } else if (period === 50) {
    result[period - 1].ema50 = Number(currentEma.toFixed(decimals));
  }

  // Demais velas aplicam o multiplicador exponencial k
  const k = 2 / (period + 1);

  for (let i = period; i < result.length; i++) {
    const close = Number.isFinite(result[i].close) ? result[i].close : currentEma;
    currentEma = close * k + currentEma * (1 - k);

    if (period === 20) {
      result[i].ema20 = Number(currentEma.toFixed(decimals));
    } else if (period === 50) {
      result[i].ema50 = Number(currentEma.toFixed(decimals));
    }
  }

  return result;
}

/**
 * Calcula MACD (Moving Average Convergence Divergence) e Linha de Sinal com aquecimento estrito.
 * - MACD Line = EMA(fast) - EMA(slow). Exige `slowPeriod` velas para aquecimento da EMA lenta.
 * - Signal Line = EMA(signalPeriod) da MACD Line. Exige `slowPeriod + signalPeriod - 1` velas.
 * - Histogram = MACD Line - Signal Line.
 * - Antes desse aquecimento, `macd` retorna `undefined` diferenciando dado indisponível.
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

  const minWarmup = slowPeriod + signalPeriod - 1; // Ex: 26 + 9 - 1 = 34 velas

  // Se a série for muito curta para inicialização completa do MACD + Sinal, define como undefined
  if (result.length < minWarmup) {
    for (let i = 0; i < result.length; i++) {
      result[i].macd = undefined;
    }
    return result;
  }

  // 1. Calcula EMA Rápida (12)
  const kFast = 2 / (fastPeriod + 1);
  const fastEmaValues: (number | undefined)[] = new Array(result.length).fill(undefined);
  let sumFast = 0;
  for (let i = 0; i < fastPeriod; i++) sumFast += result[i].close;
  let currentFastEma = sumFast / fastPeriod;
  fastEmaValues[fastPeriod - 1] = currentFastEma;
  for (let i = fastPeriod; i < result.length; i++) {
    currentFastEma = result[i].close * kFast + currentFastEma * (1 - kFast);
    fastEmaValues[i] = currentFastEma;
  }

  // 2. Calcula EMA Lenta (26)
  const kSlow = 2 / (slowPeriod + 1);
  const slowEmaValues: (number | undefined)[] = new Array(result.length).fill(undefined);
  let sumSlow = 0;
  for (let i = 0; i < slowPeriod; i++) sumSlow += result[i].close;
  let currentSlowEma = sumSlow / slowPeriod;
  slowEmaValues[slowPeriod - 1] = currentSlowEma;
  for (let i = slowPeriod; i < result.length; i++) {
    currentSlowEma = result[i].close * kSlow + currentSlowEma * (1 - kSlow);
    slowEmaValues[i] = currentSlowEma;
  }

  // 3. Linha MACD (Fast - Slow)
  const macdLineValues: (number | undefined)[] = new Array(result.length).fill(undefined);
  for (let i = slowPeriod - 1; i < result.length; i++) {
    const f = fastEmaValues[i];
    const s = slowEmaValues[i];
    if (f !== undefined && s !== undefined) {
      macdLineValues[i] = f - s;
    }
  }

  // 4. Linha de Sinal: EMA(signalPeriod) sobre a linha MACD
  // Começa no índice (slowPeriod - 1) + (signalPeriod - 1) = minWarmup - 1
  const kSignal = 2 / (signalPeriod + 1);
  let sumSignal = 0;
  const signalStartIndex = slowPeriod - 1; // Índice onde a MACD Line começa a existir
  const signalInitIndex = signalStartIndex + signalPeriod - 1; // Onde a SMA inicial do Sinal pode ser calculada

  for (let i = signalStartIndex; i <= signalInitIndex; i++) {
    sumSignal += macdLineValues[i]!;
  }
  let currentSignal = sumSignal / signalPeriod;

  // Marca velas antes do aquecimento total como undefined
  for (let i = 0; i < signalInitIndex; i++) {
    result[i].macd = undefined;
  }

  // Inicializa o primeiro valor completo de MACD
  const initialMacd = macdLineValues[signalInitIndex]!;
  result[signalInitIndex].macd = {
    macd: Number(initialMacd.toFixed(decimals)),
    signal: Number(currentSignal.toFixed(decimals)),
    histogram: Number((initialMacd - currentSignal).toFixed(decimals))
  };

  // Calcula subsequentes
  for (let i = signalInitIndex + 1; i < result.length; i++) {
    const macdVal = macdLineValues[i]!;
    currentSignal = macdVal * kSignal + currentSignal * (1 - kSignal);
    const hist = macdVal - currentSignal;

    result[i].macd = {
      macd: Number(macdVal.toFixed(decimals)),
      signal: Number(currentSignal.toFixed(decimals)),
      histogram: Number(hist.toFixed(decimals))
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
 * Calcula o Índice de Sentimento (Fear & Greed) com base nas flutuações dos ativos monitorados.
 * Combina momentum ponderado de 24h, posição no range diário e amplitude de mercado.
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

    let weight = 1.0;
    if (asset.symbol === 'BTCUSDT') weight = 4.0;
    else if (asset.symbol === 'ETHUSDT') weight = 2.5;
    else if (asset.symbol === 'SOLUSDT') weight = 1.8;

    weightedChangeSum += change * weight;
    totalWeight += weight;

    if (asset.high24h > asset.low24h && asset.price >= asset.low24h) {
      const posInRange = Math.max(0, Math.min(1, (asset.price - asset.low24h) / (asset.high24h - asset.low24h)));
      rangeScoreSum += posInRange * weight;
      validRangeCount += weight;
    }
  }

  const weightedChange = totalWeight > 0 ? weightedChangeSum / totalWeight : 0;
  const averageChange = Number((rawChangeSum / assets.length).toFixed(2));

  // Escala de momentum (-8% a +8% mapeia para 10 a 90)
  const momentumScore = Math.max(5, Math.min(95, 50 + (weightedChange / 8) * 40));
  const rangeScore = validRangeCount > 0 ? Math.max(5, Math.min(95, (rangeScoreSum / validRangeCount) * 100)) : 50;
  const breadthScore = Math.max(5, Math.min(95, (advancers / assets.length) * 100));

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

export interface TechnicalDiagnosis {
  oscillators: {
    label: string;
    sentiment: 'bullish' | 'bearish' | 'neutral' | 'insufficient';
    valueDisplay: string;
    ruleExplanation: string;
  };
  movingAverages: {
    label: string;
    sentiment: 'bullish' | 'bearish' | 'neutral' | 'insufficient';
    valueDisplay: string;
    ruleExplanation: string;
  };
  summary: {
    buyCount: number;
    sellCount: number;
    neutralCount: number;
    totalEvaluated: number;
    verdict: string;
    sentiment: 'bullish' | 'bearish' | 'neutral' | 'insufficient';
    ruleExplanation: string;
  };
}

/**
 * Realiza o diagnóstico técnico auditado sobre os candles e indicadores efetivamente carregados.
 * Identifica períodos de aquecimento e emite "dados insuficientes" quando os requisitos mínimos
 * de cada indicador não foram atingidos.
 */
export function calculateTechnicalDiagnosis(candles: CandleData[]): TechnicalDiagnosis {
  if (!candles || candles.length === 0) {
    return {
      oscillators: {
        label: 'Dados Insuficientes',
        sentiment: 'insufficient',
        valueDisplay: 'Sem velas carregadas',
        ruleExplanation: 'Aguardando carregamento da série temporal de preços.'
      },
      movingAverages: {
        label: 'Dados Insuficientes',
        sentiment: 'insufficient',
        valueDisplay: 'Sem velas carregadas',
        ruleExplanation: 'Aguardando carregamento da série temporal de preços.'
      },
      summary: {
        buyCount: 0,
        sellCount: 0,
        neutralCount: 0,
        totalEvaluated: 0,
        verdict: 'Dados Insuficientes',
        sentiment: 'insufficient',
        ruleExplanation: 'Nenhum candle disponível para avaliação técnica.'
      }
    };
  }

  const latest = candles[candles.length - 1];

  // 1. Diagnóstico de Osciladores (RSI de Wilder de 14 períodos)
  let oscLabel = 'Neutro';
  let oscSentiment: 'bullish' | 'bearish' | 'neutral' | 'insufficient' = 'neutral';
  let oscValueDisplay = 'RSI: --';
  let oscRule = '';

  if (latest.rsi === undefined) {
    oscLabel = 'Dados Insuficientes';
    oscSentiment = 'insufficient';
    oscValueDisplay = `Aquecimento (${candles.length}/14 velas)`;
    oscRule = 'O RSI de Wilder exige no mínimo 14 períodos completos para estabilizar o cálculo de ganhos e perdas médios.';
  } else {
    const rsi = latest.rsi;
    oscValueDisplay = `RSI(14): ${rsi.toFixed(1)}`;
    if (rsi >= 70) {
      oscLabel = 'Sobrecomprado';
      oscSentiment = 'bearish';
      oscRule = 'RSI ≥ 70 indica ativo em zona de exaustão compradora e risco elevado de correção.';
    } else if (rsi <= 30) {
      oscLabel = 'Sobrevendido';
      oscSentiment = 'bullish';
      oscRule = 'RSI ≤ 30 indica ativo em sobrevenda extrema com assimetria técnica favorável a repique.';
    } else if (rsi > 55) {
      oscLabel = 'Momentum de Alta';
      oscSentiment = 'bullish';
      oscRule = 'RSI entre 55 e 70 sustenta viés comprador sem estar em nível de sobrecompra.';
    } else if (rsi < 45) {
      oscLabel = 'Pressão Vendedora';
      oscSentiment = 'bearish';
      oscRule = 'RSI entre 30 e 45 aponta domínio da pressão vendedora no curto prazo.';
    } else {
      oscLabel = 'Neutro';
      oscSentiment = 'neutral';
      oscRule = 'RSI na faixa de 45 a 55 sinaliza equilíbrio entre oferta e demanda.';
    }
  }

  // 2. Diagnóstico de Médias Móveis (EMA 20, EMA 50 e Preço)
  let maLabel = 'Neutro';
  let maSentiment: 'bullish' | 'bearish' | 'neutral' | 'insufficient' = 'neutral';
  let maValueDisplay = 'EMA: --';
  let maRule = '';

  if (latest.ema20 === undefined || latest.ema50 === undefined) {
    maLabel = 'Dados Insuficientes';
    maSentiment = 'insufficient';
    maValueDisplay = latest.ema20 === undefined
      ? `Aquecimento EMA20 (${candles.length}/20)`
      : `Aquecimento EMA50 (${candles.length}/50)`;
    maRule = 'As Médias Móveis Exponenciais exigem respectivamente 20 e 50 períodos para formação do primeiro valor.';
  } else {
    const p = latest.close;
    const e20 = latest.ema20;
    const e50 = latest.ema50;

    if (p > e20 && e20 > e50) {
      maLabel = 'Compra Forte';
      maSentiment = 'bullish';
      maValueDisplay = 'Preço > EMA20 > EMA50';
      maRule = 'Alinhamento altista clássico: preço e média rápida (20) acima da média institucional longa (50).';
    } else if (p < e20 && e20 < e50) {
      maLabel = 'Venda Forte';
      maSentiment = 'bearish';
      maValueDisplay = 'Preço < EMA20 < EMA50';
      maRule = 'Alinhamento baixista: preço e média rápida (20) abaixo da média institucional longa (50).';
    } else if (e20 > e50 && p <= e20) {
      maLabel = 'Correção em Alta';
      maSentiment = 'neutral';
      maValueDisplay = 'EMA20 > EMA50 (Preço em recuo)';
      maRule = 'Tendência primária de alta mantida com teste de suporte na EMA 20.';
    } else if (e20 < e50 && p >= e20) {
      maLabel = 'Repique em Baixa';
      maSentiment = 'neutral';
      maValueDisplay = 'EMA20 < EMA50 (Preço em repique)';
      maRule = 'Tendência primária de baixa com teste de resistência na EMA 20.';
    } else {
      maLabel = 'Cruzamento / Indefinido';
      maSentiment = 'neutral';
      maValueDisplay = 'EMAs em convergência';
      maRule = 'Médias móveis próximas em consolidação lateral.';
    }
  }

  // 3. Resumo dos Sinais (Contagem algorítmica real sobre os indicadores carregados)
  let buyCount = 0;
  let sellCount = 0;
  let neutralCount = 0;

  // Regra 1: RSI
  if (latest.rsi !== undefined) {
    if (latest.rsi <= 35) buyCount++;
    else if (latest.rsi >= 65) sellCount++;
    else neutralCount++;
  }

  // Regra 2: Posição do Preço em relação à EMA 20
  if (latest.ema20 !== undefined) {
    if (latest.close > latest.ema20) buyCount++;
    else if (latest.close < latest.ema20) sellCount++;
    else neutralCount++;
  }

  // Regra 3: Alinhamento EMA 20 vs EMA 50
  if (latest.ema20 !== undefined && latest.ema50 !== undefined) {
    if (latest.ema20 > latest.ema50) buyCount++;
    else if (latest.ema20 < latest.ema50) sellCount++;
    else neutralCount++;
  }

  // Regra 4: MACD Histograma
  if (latest.macd !== undefined) {
    if (latest.macd.histogram > 0) buyCount++;
    else if (latest.macd.histogram < 0) sellCount++;
    else neutralCount++;
  }

  const totalEvaluated = buyCount + sellCount + neutralCount;

  if (totalEvaluated === 0) {
    return {
      oscillators: { label: oscLabel, sentiment: oscSentiment, valueDisplay: oscValueDisplay, ruleExplanation: oscRule },
      movingAverages: { label: maLabel, sentiment: maSentiment, valueDisplay: maValueDisplay, ruleExplanation: maRule },
      summary: {
        buyCount: 0,
        sellCount: 0,
        neutralCount: 0,
        totalEvaluated: 0,
        verdict: 'Dados Insuficientes',
        sentiment: 'insufficient',
        ruleExplanation: 'Indicadores ainda em período de aquecimento para gerar resumo.'
      }
    };
  }

  let summaryVerdict = 'Indecisão';
  let summarySentiment: 'bullish' | 'bearish' | 'neutral' | 'insufficient' = 'neutral';

  if (buyCount > sellCount) {
    summaryVerdict = buyCount >= 3 ? 'Forte Compra' : 'Viés Comprador';
    summarySentiment = 'bullish';
  } else if (sellCount > buyCount) {
    summaryVerdict = sellCount >= 3 ? 'Forte Venda' : 'Viés Vendedor';
    summarySentiment = 'bearish';
  } else {
    summaryVerdict = 'Consolidação / Neutro';
    summarySentiment = 'neutral';
  }

  const summaryRule = `Consenso de ${totalEvaluated} regras auditadas (RSI, Preço/EMA20, Alinhamento de Médias e Histograma MACD) calculadas sobre os candles reais.`;

  return {
    oscillators: {
      label: oscLabel,
      sentiment: oscSentiment,
      valueDisplay: oscValueDisplay,
      ruleExplanation: oscRule
    },
    movingAverages: {
      label: maLabel,
      sentiment: maSentiment,
      valueDisplay: maValueDisplay,
      ruleExplanation: maRule
    },
    summary: {
      buyCount,
      sellCount,
      neutralCount,
      totalEvaluated,
      verdict: summaryVerdict,
      sentiment: summarySentiment,
      ruleExplanation: summaryRule
    }
  };
}

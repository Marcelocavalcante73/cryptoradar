import { CryptoAsset, TechnicalSignal, CandleData } from '../types/crypto';
import { calculateAllIndicators } from './indicators';

export const INITIAL_ASSETS: CryptoAsset[] = [
  {
    id: 'bitcoin',
    symbol: 'BTCUSDT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    name: 'Bitcoin',
    price: 64280.50,
    change24h: 3.42,
    high24h: 65120.00,
    low24h: 62890.00,
    volume24h: 28450120000,
    marketCap: 1264000000000,
    exchanges: ['binance', 'bybit'],
    sparkline: [62890, 63100, 63450, 63200, 63900, 64150, 63800, 64500, 64280],
    lastUpdated: new Date().toLocaleTimeString('pt-BR'),
    isDemoData: true
  },
  {
    id: 'ethereum',
    symbol: 'ETHUSDT',
    baseAsset: 'ETH',
    quoteAsset: 'USDT',
    name: 'Ethereum',
    price: 3485.20,
    change24h: 2.15,
    high24h: 3540.00,
    low24h: 3390.40,
    volume24h: 15420000000,
    marketCap: 418000000000,
    exchanges: ['binance', 'bybit'],
    sparkline: [3390, 3410, 3425, 3400, 3460, 3490, 3470, 3510, 3485],
    lastUpdated: new Date().toLocaleTimeString('pt-BR'),
    isDemoData: true
  },
  {
    id: 'solana',
    symbol: 'SOLUSDT',
    baseAsset: 'SOL',
    quoteAsset: 'USDT',
    name: 'Solana',
    price: 152.75,
    change24h: -1.84,
    high24h: 158.40,
    low24h: 149.10,
    volume24h: 3890000000,
    marketCap: 71200000000,
    exchanges: ['binance', 'bybit'],
    sparkline: [156, 158, 157, 154, 152, 151, 150, 153, 152.75],
    lastUpdated: new Date().toLocaleTimeString('pt-BR'),
    isDemoData: true
  },
  {
    id: 'binancecoin',
    symbol: 'BNBUSDT',
    baseAsset: 'BNB',
    quoteAsset: 'USDT',
    name: 'BNB',
    price: 588.60,
    change24h: 0.95,
    high24h: 594.00,
    low24h: 580.20,
    volume24h: 1120000000,
    marketCap: 86500000000,
    exchanges: ['binance'],
    sparkline: [581, 583, 585, 584, 589, 592, 587, 590, 588.6],
    lastUpdated: new Date().toLocaleTimeString('pt-BR'),
    isDemoData: true
  },
  {
    id: 'ripple',
    symbol: 'XRPUSDT',
    baseAsset: 'XRP',
    quoteAsset: 'USDT',
    name: 'XRP',
    price: 0.584,
    change24h: -0.65,
    high24h: 0.598,
    low24h: 0.575,
    volume24h: 1450000000,
    marketCap: 32800000000,
    exchanges: ['binance', 'bybit'],
    sparkline: [0.589, 0.592, 0.585, 0.580, 0.578, 0.581, 0.583, 0.584],
    lastUpdated: new Date().toLocaleTimeString('pt-BR'),
    isDemoData: true
  },
  {
    id: 'cardano',
    symbol: 'ADAUSDT',
    baseAsset: 'ADA',
    quoteAsset: 'USDT',
    name: 'Cardano',
    price: 0.392,
    change24h: 4.80,
    high24h: 0.405,
    low24h: 0.371,
    volume24h: 890000000,
    marketCap: 14100000000,
    exchanges: ['binance', 'bybit'],
    sparkline: [0.372, 0.375, 0.379, 0.384, 0.388, 0.395, 0.390, 0.392],
    lastUpdated: new Date().toLocaleTimeString('pt-BR'),
    isDemoData: true
  },
  {
    id: 'avalanche-2',
    symbol: 'AVAXUSDT',
    baseAsset: 'AVAX',
    quoteAsset: 'USDT',
    name: 'Avalanche',
    price: 28.45,
    change24h: -3.12,
    high24h: 29.90,
    low24h: 27.80,
    volume24h: 460000000,
    marketCap: 11200000000,
    exchanges: ['binance', 'bybit'],
    sparkline: [29.6, 29.8, 29.1, 28.5, 28.2, 28.0, 28.6, 28.45],
    lastUpdated: new Date().toLocaleTimeString('pt-BR'),
    isDemoData: true
  },
  {
    id: 'chainlink',
    symbol: 'LINKUSDT',
    baseAsset: 'LINK',
    quoteAsset: 'USDT',
    name: 'Chainlink',
    price: 12.80,
    change24h: 5.62,
    high24h: 13.15,
    low24h: 12.05,
    volume24h: 580000000,
    marketCap: 7800000000,
    exchanges: ['binance', 'bybit'],
    sparkline: [12.1, 12.2, 12.4, 12.6, 12.9, 13.1, 12.7, 12.8],
    lastUpdated: new Date().toLocaleTimeString('pt-BR'),
    isDemoData: true
  },
  {
    id: 'sui',
    symbol: 'SUIUSDT',
    baseAsset: 'SUI',
    quoteAsset: 'USDT',
    name: 'Sui Network',
    price: 1.95,
    change24h: 8.33,
    high24h: 2.05,
    low24h: 1.78,
    volume24h: 920000000,
    marketCap: 5400000000,
    exchanges: ['binance', 'bybit'],
    sparkline: [1.79, 1.82, 1.86, 1.89, 1.94, 2.02, 1.98, 1.95],
    lastUpdated: new Date().toLocaleTimeString('pt-BR'),
    isDemoData: true
  },
  {
    id: 'near',
    symbol: 'NEARUSDT',
    baseAsset: 'NEAR',
    quoteAsset: 'USDT',
    name: 'NEAR Protocol',
    price: 4.88,
    change24h: -2.40,
    high24h: 5.10,
    low24h: 4.75,
    volume24h: 310000000,
    marketCap: 5900000000,
    exchanges: ['binance', 'bybit'],
    sparkline: [5.05, 5.08, 4.95, 4.90, 4.82, 4.86, 4.85, 4.88],
    lastUpdated: new Date().toLocaleTimeString('pt-BR'),
    isDemoData: true
  }
];

export const INITIAL_SIGNALS: TechnicalSignal[] = [
  {
    id: 'sig-001',
    symbol: 'BTCUSDT',
    baseAsset: 'BTC',
    direction: 'LONG',
    strategy: 'EMA_GOLDEN_CROSS',
    strategyName: 'Cruzamento de Médias EMA (20/50)',
    timeframe: '4h',
    entryPrice: 63950.00,
    targetPrice: 66800.00,
    stopLossPrice: 62500.00,
    riskRewardRatio: '1:1.96',
    status: 'OPEN',
    technicalReason: 'EMA 20 cruzou acima da EMA 50 no gráfico de 4 horas com expansão de volume de compra.',
    indicatorsTriggered: ['EMA 20 > EMA 50', 'Volume 1.4x Média', 'RSI 58 (Neutro-Alta)'],
    timestamp: 'Hoje, há 35 min',
    isDemo: true,
    disclaimer: 'Sinal demonstrativo algorítmico para fins educacionais. Não há garantia de assertividade.'
  },
  {
    id: 'sig-002',
    symbol: 'SOLUSDT',
    baseAsset: 'SOL',
    direction: 'LONG',
    strategy: 'RSI_DIVERGENCE',
    strategyName: 'Divergência de Alta no RSI',
    timeframe: '1h',
    entryPrice: 151.20,
    targetPrice: 161.00,
    stopLossPrice: 147.50,
    riskRewardRatio: '1:2.65',
    status: 'OPEN',
    technicalReason: 'Fundo mais baixo no preço com fundo mais alto no RSI (14) em zona de sobrevenda (32).',
    indicatorsTriggered: ['RSI 32.4 (Divergência)', 'Suporte $148.00 testado', 'MACD Histograma Virando'],
    timestamp: 'Hoje, há 1h 15 min',
    isDemo: true,
    disclaimer: 'Sinal demonstrativo algorítmico para fins educacionais. Não há garantia de assertividade.'
  },
  {
    id: 'sig-003',
    symbol: 'ETHUSDT',
    baseAsset: 'ETH',
    direction: 'LONG',
    strategy: 'BREAKOUT_RESISTANCE',
    strategyName: 'Rompimento de Resistência',
    timeframe: '1D',
    entryPrice: 3420.00,
    targetPrice: 3650.00,
    stopLossPrice: 3310.00,
    riskRewardRatio: '1:2.09',
    status: 'TARGET_HIT',
    technicalReason: 'Superação com fechamento diário da máxima semanal dos $3.400.',
    indicatorsTriggered: ['Rompimento $3.400', 'Volume institucional +42%', 'ADX 28.5 (Tendência Forte)'],
    timestamp: 'Ontem, 16:40',
    isDemo: true,
    disclaimer: 'Sinal demonstrativo algorítmico para fins educacionais. Não há garantia de assertividade.'
  },
  {
    id: 'sig-004',
    symbol: 'AVAXUSDT',
    baseAsset: 'AVAX',
    direction: 'SHORT',
    strategy: 'MEAN_REVERSION',
    strategyName: 'Rejeição na Banda Superior',
    timeframe: '4h',
    entryPrice: 29.80,
    targetPrice: 27.50,
    stopLossPrice: 30.90,
    riskRewardRatio: '1:2.09',
    status: 'STOP_HIT',
    technicalReason: 'Rejeição com pavio superior de absorção na zona psicológica de $30.00.',
    indicatorsTriggered: ['RSI 71.8 (Sobrecomprado)', 'Pavio de absorção', 'MACD divergente de baixa'],
    timestamp: 'Anteontem, 09:20',
    isDemo: true,
    disclaimer: 'Sinal demonstrativo algorítmico para fins educacionais. Não há garantia de assertividade.'
  },
  {
    id: 'sig-005',
    symbol: 'LINKUSDT',
    baseAsset: 'LINK',
    direction: 'LONG',
    strategy: 'SUPPORT_RETEST',
    strategyName: 'Reteste de Suporte com Pavio',
    timeframe: '1h',
    entryPrice: 12.30,
    targetPrice: 13.50,
    stopLossPrice: 11.80,
    riskRewardRatio: '1:2.40',
    status: 'TARGET_HIT',
    technicalReason: 'Defesa compradora no nível Fibonacci de 0.618 após recuo controlado.',
    indicatorsTriggered: ['Fibo 0.618 em $12.20', 'Volume vendedor secando', 'Estocástico cruzado'],
    timestamp: '3 dias atrás',
    isDemo: true,
    disclaimer: 'Sinal demonstrativo algorítmico para fins educacionais. Não há garantia de assertividade.'
  },
  {
    id: 'sig-006',
    symbol: 'SUIUSDT',
    baseAsset: 'SUI',
    direction: 'LONG',
    strategy: 'VOLUME_SPIKE',
    strategyName: 'Explosão de Volume em Consolidação',
    timeframe: '15m',
    entryPrice: 1.84,
    targetPrice: 2.05,
    stopLossPrice: 1.76,
    riskRewardRatio: '1:2.62',
    status: 'TARGET_HIT',
    technicalReason: 'Volume 3.5 vezes superior à média das últimas 20 velas de 15 minutos.',
    indicatorsTriggered: ['Volume Spike 350%', 'Rompimento de canal', 'RSI 64'],
    timestamp: '4 dias atrás',
    isDemo: true,
    disclaimer: 'Sinal demonstrativo algorítmico para fins educacionais. Não há garantia de assertividade.'
  }
];

/**
 * Gerador de velas sintéticas consistentes com o ativo selecionado.
 * Permite renderização rica do gráfico de candles, médias EMA, RSI e MACD.
 */
export function generateCandlesForAsset(asset: CryptoAsset, count: number = 36): CandleData[] {
  const candles: CandleData[] = [];
  const basePrice = asset.price;
  const now = Date.now();
  const stepMs = 4 * 60 * 60 * 1000; // 4h por vela

  let currentClose = basePrice * 0.94; // começa levemente abaixo para criar movimento natural

  for (let i = count; i >= 0; i--) {
    const timestamp = now - i * stepMs;
    const dateObj = new Date(timestamp);
    const time = `${dateObj.getDate().toString().padStart(2, '0')}/${(dateObj.getMonth() + 1).toString().padStart(2, '0')} ${dateObj.getHours().toString().padStart(2, '0')}:00`;

    // Variação pseudo-aleatória porém suave e realista
    const volatility = basePrice * 0.018;
    const trendFactor = (count - i) / count * (basePrice * 0.06);
    const noise = (Math.sin(i * 0.8) + Math.cos(i * 0.4)) * volatility;
    
    const open = currentClose;
    let close = open + (noise * 0.7) + (trendFactor * 0.03);
    if (i === 0) close = basePrice; // Última vela termina no preço exato atual

    const calculatedHigh = Math.max(open, close) + Math.abs(noise * 0.6) + (Math.random() * volatility * 0.3);
    const calculatedLow = Math.max(basePrice * 0.05, Math.min(open, close) - Math.abs(noise * 0.6) - (Math.random() * volatility * 0.3));
    const high = Math.max(calculatedHigh, Math.max(open, close));
    const low = Math.min(calculatedLow, Math.min(open, close));
    const volume = Math.round((asset.volume24h / 120) * (0.6 + Math.random() * 0.8));

    currentClose = close;

    const decimals = asset.price < 10 ? 4 : 2;

    candles.push({
      time,
      timestamp,
      open: Number(open.toFixed(decimals)),
      high: Number(high.toFixed(decimals)),
      low: Number(low.toFixed(decimals)),
      close: Number(close.toFixed(decimals)),
      volume
    });
  }

  // Calcula indicadores técnicos (EMA 20, EMA 50, RSI 14, MACD) via Wilder smoothing
  return calculateAllIndicators(candles, asset.price < 10 ? 4 : 2);
}


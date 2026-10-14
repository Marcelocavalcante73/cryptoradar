/**
 * Tipos e interfaces de domínio do CryptoRadar
 * Preparados para integração futura com FastAPI, Supabase e Binance/Bybit.
 */

export type ExchangeId = 'all' | 'binance' | 'bybit';

/** Mercado do sinal e da carteira: à vista (spot) ou perpétuos USDT-M (futuros). */
export type MarketType = 'spot' | 'futures';

export type Timeframe = '15m' | '1h' | '4h' | '1D' | '1W';

export interface CryptoAsset {
  id: string;
  symbol: string;        // ex: 'BTCUSDT'
  baseAsset: string;     // ex: 'BTC'
  quoteAsset: string;    // ex: 'USDT'
  name: string;          // ex: 'Bitcoin'
  price: number;
  change24h: number;     // percentual (+2.45 ou -1.20)
  high24h: number;
  low24h: number;
  volume24h: number;     // em milhões ou total
  marketCap?: number;
  exchanges: ('binance' | 'bybit')[];
  sparkline: number[];   // 10 a 20 pontos de tendência
  lastUpdated: string;
  isDemoData: boolean;
}

export interface CandleData {
  time: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ema20?: number;
  ema50?: number;
  ema200?: number;
  rsi?: number;
  macd?: {
    macd: number;
    signal: number;
    histogram: number;
  };
  bollinger?: {
    upper: number;
    middle: number;
    lower: number;
  };
}

export type SignalStrategy = 
  | 'RSI_DIVERGENCE'
  | 'EMA_GOLDEN_CROSS'
  | 'BREAKOUT_RESISTANCE'
  | 'SUPPORT_RETEST'
  | 'MEAN_REVERSION'
  | 'VOLUME_SPIKE';

export type SignalStatus = 'OPEN' | 'TARGET_HIT' | 'STOP_HIT' | 'EXPIRED';

export type SignalDirection = 'LONG' | 'SHORT';

export interface TechnicalSignal {
  id: string;
  market?: MarketType;
  symbol: string;
  baseAsset: string;
  direction: SignalDirection;
  strategy: SignalStrategy;
  strategyName: string;
  timeframe: string;
  entryPrice: number;
  targetPrice: number;
  stopLossPrice: number;
  riskRewardRatio: string;
  status: SignalStatus;
  technicalReason: string;
  indicatorsTriggered: string[];
  timestamp: string;
  isDemo: boolean; // true = sinal de demonstração (mock); false = gerado pelo motor com dados reais
  disclaimer: string;
}

export type OrderType = 'MARKET' | 'LIMIT';

export interface PaperPosition {
  id: string;
  symbol: string;
  direction: SignalDirection;
  orderType: OrderType;
  entryPrice: number;
  currentPrice: number;
  limitPrice?: number;  // Preço limite para ordens LIMIT
  amount: number;       // Quantidade da moeda
  investedUSDT: number; // Margem investida
  leverage: number;     // 1x, 2x, 5x, 10x
  targetPrice?: number;
  stopLossPrice?: number;
  openTimestamp: number;
  triggeredTimestamp?: number; // Momento em que a ordem LIMIT foi executada
  status: 'PENDING' | 'OPEN' | 'CLOSED';
  closedTimestamp?: number;
  closePrice?: number;
  openFee: number;      // Taxa de abertura em USDT (ex: 0.05% do nocional)
  closeFee?: number;    // Taxa de encerramento em USDT
  totalFees?: number;   // Taxas acumuladas da operação
  realizedPnl?: number; // PnL líquido realizado
  realizedPnlPercent?: number;
  closeReason?: 'MANUAL' | 'TAKE_PROFIT' | 'STOP_LOSS' | 'LIQUIDATION' | 'CANCELLED';
  isDemo: true;
}

export interface PaperAccount {
  virtualBalance: number;    // Saldo disponível em USDT
  initialBalance: number;    // Saldo inicial de referência ($10,000)
  totalTrades: number;
  winTrades: number;
  lossTrades: number;
  totalFeesPaid: number;     // Total de taxas de corretagem pagas em USDT
  positions: PaperPosition[];
  closedHistory: PaperPosition[];
}

export interface RiskSettings {
  maxRiskPerTradePercent: number; // ex: 2.0%
  dailyMaxDrawdownPercent: number; // ex: 5.0%
  defaultStopLossPercent: number;  // ex: 2.5%
  defaultTakeProfitRatio: number;  // ex: 2.0 (1:2 R:R)
  enableTrailingStop: boolean;
  alertOnHighVolatility: boolean;
}

export interface ExchangeConfig {
  binanceEnabled: boolean;
  binanceApiKeyPreview: string; // Exclusivamente para demo / teste leitura
  bybitEnabled: boolean;
  bybitApiKeyPreview: string;
  connectionMode: 'READ_ONLY_SIMULATED' | 'DIRECT_PUBLIC_API';
}

export interface TelegramConfig {
  enabled: boolean;
  botTokenPlaceholder: string;
  chatIdPlaceholder: string;
  notifyOnSignals: boolean;
  notifyOnPaperExecution: boolean;
}

export interface AppSettings {
  baseCurrency: 'USDT' | 'BRL' | 'EUR';
  refreshIntervalSeconds: number; // 10, 30, 60
  soundAlerts: boolean;
  risk: RiskSettings;
  exchange: ExchangeConfig;
  telegram: TelegramConfig;
  realCapital?: number;        // capital real (USDT) usado só para sugerir tamanho de posição; 0/ausente = desligado
  b3Capital?: number;          // capital (R$) para sugerir quantidade de ações na B3; 0/ausente = desligado
  realRiskPercent?: number;    // % do capital real arriscado por operação (padrão 1)
  futuresLeverage?: number;    // alavancagem padrão sugerida em futuros (padrão 3)
}

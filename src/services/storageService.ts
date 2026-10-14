import { AppSettings, MarketType, PaperAccount, PaperPosition } from '../types/crypto';
import { localStore } from './localStore';

const SETTINGS_KEY = 'cryptoradar_settings_v1';
// A conta de spot mantém a chave antiga para não perder o histórico já salvo
const PAPER_KEYS: Record<MarketType, string> = {
  spot: 'cryptoradar_paper_account_v1',
  futures: 'cryptoradar_paper_account_futures_v1'
};
const MARKET_KEY = 'cryptoradar_market_v1';

export const DEFAULT_SETTINGS: AppSettings = {
  baseCurrency: 'USDT',
  realCapital: 0,
  b3Capital: 0,
  realRiskPercent: 1,
  futuresLeverage: 3,
  refreshIntervalSeconds: 30,
  soundAlerts: false,
  risk: {
    maxRiskPerTradePercent: 2.0,
    dailyMaxDrawdownPercent: 5.0,
    defaultStopLossPercent: 2.5,
    defaultTakeProfitRatio: 2.0, // 1:2
    enableTrailingStop: false,
    alertOnHighVolatility: true
  },
  exchange: {
    binanceEnabled: true,
    binanceApiKeyPreview: '',
    bybitEnabled: true,
    bybitApiKeyPreview: '',
    connectionMode: 'DIRECT_PUBLIC_API'
  },
  telegram: {
    enabled: false,
    botTokenPlaceholder: '',
    chatIdPlaceholder: '',
    notifyOnSignals: true,
    notifyOnPaperExecution: true
  }
};

/**
 * Conta Inicial Limpa:
 * Permite ao usuário iniciar o Paper Trading com estado 100% zerado e sem dados residuais de exemplo.
 */
export const INITIAL_PAPER_ACCOUNT: PaperAccount = {
  virtualBalance: 10000.00,
  initialBalance: 10000.00,
  totalTrades: 0,
  winTrades: 0,
  lossTrades: 0,
  totalFeesPaid: 0,
  positions: [],
  closedHistory: []
};

/**
 * Conjunto de dados demonstrativos estritamente identificados como fictícios (isDemo: true)
 * para fins de visualização de exemplo quando o usuário optar por carregá-los.
 */
export const DEMO_SAMPLE_PAPER_ACCOUNT: PaperAccount = {
  virtualBalance: 5663.44,
  initialBalance: 10000.00,
  totalTrades: 3,
  winTrades: 1,
  lossTrades: 0,
  totalFeesPaid: 4.79,
  positions: [
    {
      id: 'demo-pos-101',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      orderType: 'MARKET',
      entryPrice: 63800.00,
      currentPrice: 64280.50,
      amount: 0.045,
      investedUSDT: 2871.00,
      leverage: 1,
      targetPrice: 66500.00,
      stopLossPrice: 62400.00,
      openTimestamp: Date.now() - 3600000 * 5,
      openFee: 1.44,
      status: 'OPEN',
      isDemo: true
    },
    {
      id: 'demo-pos-102',
      symbol: 'SOLUSDT',
      direction: 'LONG',
      orderType: 'MARKET',
      entryPrice: 154.20,
      currentPrice: 152.75,
      amount: 10.0,
      investedUSDT: 1542.00,
      leverage: 1,
      targetPrice: 165.00,
      stopLossPrice: 148.00,
      openTimestamp: Date.now() - 3600000 * 12,
      openFee: 0.77,
      status: 'OPEN',
      isDemo: true
    }
  ],
  closedHistory: [
    {
      id: 'demo-pos-099',
      symbol: 'ETHUSDT',
      direction: 'LONG',
      orderType: 'MARKET',
      entryPrice: 3380.00,
      currentPrice: 3490.00,
      amount: 0.75,
      investedUSDT: 2535.00,
      leverage: 1,
      openTimestamp: Date.now() - 86400000 * 2,
      status: 'CLOSED',
      closedTimestamp: Date.now() - 86400000,
      closePrice: 3490.00,
      openFee: 1.27,
      closeFee: 1.31,
      totalFees: 2.58,
      realizedPnl: 79.92,
      realizedPnlPercent: 3.15,
      closeReason: 'MANUAL',
      isDemo: true
    }
  ]
};

/** Guardamos `{ v, t }`: o valor e o instante (ms) da última gravação, para reconciliar com o servidor. */
function readStamped<T>(key: string): { v: T; t: number } | null {
  try {
    const raw = localStore.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 't' in parsed && 'v' in parsed) return parsed;
    return { v: parsed as T, t: 0 }; // formato antigo (sem data)
  } catch {
    return null;
  }
}

function writeStamped(key: string, value: unknown, t: number): void {
  localStore.set(key, JSON.stringify({ v: value, t }));
}

export const StorageService = {
  getSettings(): AppSettings {
    const rec = readStamped<AppSettings>(SETTINGS_KEY);
    return rec ? { ...DEFAULT_SETTINGS, ...rec.v } : DEFAULT_SETTINGS;
  },

  getSettingsSavedAt(): number {
    return readStamped(SETTINGS_KEY)?.t ?? 0;
  },

  /** Devolve o instante da gravação (ms). Se vier `at`, usa-o (ex.: cópia adotada do servidor). */
  saveSettings(settings: AppSettings, at: number = Date.now()): number {
    writeStamped(SETTINGS_KEY, settings, at);
    return at;
  },

  getMarket(): MarketType {
    return localStore.get(MARKET_KEY) === 'futures' ? 'futures' : 'spot';
  },

  saveMarket(market: MarketType): void {
    localStore.set(MARKET_KEY, market);
  },

  getPaperAccount(market: MarketType = 'spot'): PaperAccount {
    const rec = readStamped<PaperAccount>(PAPER_KEYS[market]);
    return rec && rec.v && Array.isArray(rec.v.positions) ? rec.v : INITIAL_PAPER_ACCOUNT;
  },

  getPaperAccountSavedAt(market: MarketType = 'spot'): number {
    return readStamped(PAPER_KEYS[market])?.t ?? 0;
  },

  /** Devolve o instante da gravação (ms). */
  savePaperAccount(account: PaperAccount, market: MarketType = 'spot', at: number = Date.now()): number {
    writeStamped(PAPER_KEYS[market], account, at);
    return at;
  },

  /** Zera saldo e posições. O histórico de operações é preservado, a menos que `keepHistory` seja false. */
  resetPaperAccount(initialAmount: number = 10000, keepHistory: boolean = false, market: MarketType = 'spot'): PaperAccount {
    const previousHistory = keepHistory ? StorageService.getPaperAccount(market).closedHistory || [] : [];
    const fresh: PaperAccount = {
      virtualBalance: initialAmount,
      initialBalance: initialAmount,
      totalTrades: 0,
      winTrades: 0,
      lossTrades: 0,
      totalFeesPaid: 0,
      positions: [],
      closedHistory: previousHistory
    };
    StorageService.savePaperAccount(fresh, market);
    return fresh;
  },

  loadDemoAccount(): PaperAccount {
    StorageService.savePaperAccount(DEMO_SAMPLE_PAPER_ACCOUNT);
    return DEMO_SAMPLE_PAPER_ACCOUNT;
  }
};

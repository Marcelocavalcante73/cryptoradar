import { AppSettings, PaperAccount, PaperPosition } from '../types/crypto';

const SETTINGS_KEY = 'cryptoradar_settings_v1';
const PAPER_KEY = 'cryptoradar_paper_account_v1';

export const DEFAULT_SETTINGS: AppSettings = {
  baseCurrency: 'USDT',
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
    binanceApiKeyPreview: 'vm38...91ad (Apenas Leitura)',
    bybitEnabled: false,
    bybitApiKeyPreview: 'Não conectado (Integração pública pendente)',
    connectionMode: 'DIRECT_PUBLIC_API'
  },
  telegram: {
    enabled: false,
    botTokenPlaceholder: '',
    chatIdPlaceholder: '@cryptoradar_alertas_me',
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

export const StorageService = {
  getSettings(): AppSettings {
    try {
      if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS;
      const data = localStorage.getItem(SETTINGS_KEY);
      return data ? { ...DEFAULT_SETTINGS, ...JSON.parse(data) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  },

  saveSettings(settings: AppSettings): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      console.warn('Falha ao salvar configurações no localStorage', e);
    }
  },

  getPaperAccount(): PaperAccount {
    try {
      if (typeof localStorage === 'undefined') return INITIAL_PAPER_ACCOUNT;
      const data = localStorage.getItem(PAPER_KEY);
      return data ? JSON.parse(data) : INITIAL_PAPER_ACCOUNT;
    } catch {
      return INITIAL_PAPER_ACCOUNT;
    }
  },

  savePaperAccount(account: PaperAccount): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(PAPER_KEY, JSON.stringify(account));
    } catch (e) {
      console.warn('Falha ao salvar conta simulada no localStorage', e);
    }
  },

  resetPaperAccount(initialAmount: number = 10000): PaperAccount {
    const fresh: PaperAccount = {
      virtualBalance: initialAmount,
      initialBalance: initialAmount,
      totalTrades: 0,
      winTrades: 0,
      lossTrades: 0,
      totalFeesPaid: 0,
      positions: [],
      closedHistory: []
    };
    StorageService.savePaperAccount(fresh);
    return fresh;
  },

  loadDemoAccount(): PaperAccount {
    StorageService.savePaperAccount(DEMO_SAMPLE_PAPER_ACCOUNT);
    return DEMO_SAMPLE_PAPER_ACCOUNT;
  }
};

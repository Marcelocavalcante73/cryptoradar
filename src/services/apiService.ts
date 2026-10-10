import { CryptoAsset } from '../types/crypto';
import { INITIAL_ASSETS } from './mockData';

export type ExchangeStatus = 'CONNECTED' | 'DISCONNECTED' | 'NOT_IMPLEMENTED' | 'OFFLINE_DEMO';

export interface ExchangeHealth {
  exchange: 'binance' | 'bybit';
  status: ExchangeStatus;
  statusLabel: string;
  isImplemented: boolean;
  isLive: boolean;
  lastChecked: string;
  errorMessage?: string;
}

export interface MarketDataProvider {
  fetchTickers(): Promise<CryptoAsset[]>;
  fetchTickerBySymbol(symbol: string): Promise<CryptoAsset | null>;
  checkExchangeHealth(): Promise<{ binance: ExchangeHealth; bybit: ExchangeHealth }>;
}

export class CryptoApiService implements MarketDataProvider {
  private fallbackAssets: CryptoAsset[] = INITIAL_ASSETS;
  private binanceHealth: ExchangeHealth = {
    exchange: 'binance',
    status: 'OFFLINE_DEMO',
    statusLabel: 'Demonstração (Snapshot)',
    isImplemented: true,
    isLive: false,
    lastChecked: new Date().toLocaleTimeString('pt-BR')
  };

  private bybitHealth: ExchangeHealth = {
    exchange: 'bybit',
    status: 'NOT_IMPLEMENTED',
    statusLabel: 'Não Implementada',
    isImplemented: false,
    isLive: false,
    lastChecked: new Date().toLocaleTimeString('pt-BR'),
    errorMessage: 'A integração pública com a Bybit não está implementada nesta versão do CryptoRadar.'
  };

  /**
   * Consulta a API pública da Binance.
   * Só declara conexão funcional após validar resposta HTTP 200 com array de preços válido.
   * Se a API falhar ou estiver bloqueada por região, ativa o modo de demonstração com aviso explícito.
   */
  async fetchTickers(): Promise<CryptoAsset[]> {
    try {
      const targetSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'SUIUSDT', 'NEARUSDT'];
      const symbolsParam = encodeURIComponent(JSON.stringify(targetSymbols));

      const response = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${symbolsParam}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4000)
      });

      if (!response.ok) {
        throw new Error(`Binance API retornou status HTTP ${response.status}`);
      }

      const rawData = await response.json();
      if (!Array.isArray(rawData)) {
        throw new Error('Formato retornado pela Binance não é uma lista de cotações válida');
      }

      const priceMap = new Map<string, any>();
      rawData.forEach((item: any) => {
        if (item && item.symbol && item.lastPrice) {
          priceMap.set(item.symbol, item);
        }
      });

      if (priceMap.size === 0) {
        throw new Error('Nenhum dado de ticker válido retornado pela API da Binance');
      }

      const updated = this.fallbackAssets.map((asset) => {
        const live = priceMap.get(asset.symbol);
        if (live) {
          const lastPrice = parseFloat(live.lastPrice);
          const priceChangePercent = parseFloat(live.priceChangePercent);
          const highPrice = parseFloat(live.highPrice);
          const lowPrice = parseFloat(live.lowPrice);
          const volume = parseFloat(live.quoteVolume);

          const newSparkline = [...asset.sparkline.slice(1), lastPrice];

          return {
            ...asset,
            price: Number.isFinite(lastPrice) ? lastPrice : asset.price,
            change24h: Number.isFinite(priceChangePercent) ? priceChangePercent : asset.change24h,
            high24h: Number.isFinite(highPrice) ? highPrice : asset.high24h,
            low24h: Number.isFinite(lowPrice) ? lowPrice : asset.low24h,
            volume24h: Number.isFinite(volume) ? volume : asset.volume24h,
            sparkline: newSparkline,
            lastUpdated: new Date().toLocaleTimeString('pt-BR'),
            isDemoData: false
          };
        }
        return asset;
      });

      this.fallbackAssets = updated;
      this.binanceHealth = {
        exchange: 'binance',
        status: 'CONNECTED',
        statusLabel: 'Conectada (Ao Vivo)',
        isImplemented: true,
        isLive: true,
        lastChecked: new Date().toLocaleTimeString('pt-BR')
      };

      return updated;
    } catch (err: any) {
      this.binanceHealth = {
        exchange: 'binance',
        status: 'OFFLINE_DEMO',
        statusLabel: 'Demonstração (Offline)',
        isImplemented: true,
        isLive: false,
        lastChecked: new Date().toLocaleTimeString('pt-BR'),
        errorMessage: err?.message || 'Falha de conexão com a API pública da Binance'
      };

      return this.fallbackAssets.map((asset) => ({
        ...asset,
        isDemoData: true,
        lastUpdated: new Date().toLocaleTimeString('pt-BR')
      }));
    }
  }

  async fetchTickerBySymbol(symbol: string): Promise<CryptoAsset | null> {
    const list = await this.fetchTickers();
    return list.find((a) => a.symbol === symbol) || null;
  }

  /**
   * Retorna o diagnóstico separado de cada exchange.
   * A Bybit é explicitamente reportada como NÃO implementada.
   */
  async checkExchangeHealth(): Promise<{ binance: ExchangeHealth; bybit: ExchangeHealth }> {
    return {
      binance: { ...this.binanceHealth },
      bybit: { ...this.bybitHealth }
    };
  }
}

export const apiService = new CryptoApiService();

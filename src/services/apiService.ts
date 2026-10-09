import { CryptoAsset } from '../types/crypto';
import { INITIAL_ASSETS } from './mockData';

/**
 * Interface para abstração de provedores de dados.
 * Preparada para transição transparente entre Mock/Demo e FastAPI / Supabase / Binance / Bybit.
 */
export interface MarketDataProvider {
  fetchTickers(): Promise<CryptoAsset[]>;
  fetchTickerBySymbol(symbol: string): Promise<CryptoAsset | null>;
}

export class CryptoApiService implements MarketDataProvider {
  private fallbackAssets: CryptoAsset[] = INITIAL_ASSETS;

  /**
   * Tenta consultar endpoints públicos de cotações da Binance para obter preços em tempo real.
   * Em caso de falha de rede ou CORS, utiliza os dados de demonstração com aviso explícito.
   */
  async fetchTickers(): Promise<CryptoAsset[]> {
    try {
      // Símbolos mapeados
      const targetSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'SUIUSDT', 'NEARUSDT'];
      const symbolsParam = encodeURIComponent(JSON.stringify(targetSymbols));
      
      const response = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${symbolsParam}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4000)
      });

      if (!response.ok) {
        throw new Error(`Binance API respondeu status ${response.status}`);
      }

      const rawData = await response.json();
      if (!Array.isArray(rawData)) {
        throw new Error('Formato inesperado da API');
      }

      const priceMap = new Map<string, any>();
      rawData.forEach((item: any) => priceMap.set(item.symbol, item));

      // Atualiza os ativos locais mantendo metadados
      const updated = this.fallbackAssets.map(asset => {
        const live = priceMap.get(asset.symbol);
        if (live) {
          const lastPrice = parseFloat(live.lastPrice);
          const priceChangePercent = parseFloat(live.priceChangePercent);
          const highPrice = parseFloat(live.highPrice);
          const lowPrice = parseFloat(live.lowPrice);
          const volume = parseFloat(live.quoteVolume);

          // Atualiza sparkline com novo ponto
          const newSparkline = [...asset.sparkline.slice(1), lastPrice];

          return {
            ...asset,
            price: lastPrice,
            change24h: priceChangePercent,
            high24h: highPrice,
            low24h: lowPrice,
            volume24h: volume,
            sparkline: newSparkline,
            lastUpdated: new Date().toLocaleTimeString('pt-BR'),
            isDemoData: false // Indica cotação pública oficial ao vivo
          };
        }
        return asset;
      });

      this.fallbackAssets = updated;
      return updated;
    } catch (err) {
      // Falha esperada em ambientes isolados / offline -> Mantém modo de demonstração transparente
      console.info('CryptoRadar: Utilizando dados de demonstração (fallback offline/sandbox).', err);
      return this.fallbackAssets.map(asset => ({
        ...asset,
        isDemoData: true,
        lastUpdated: new Date().toLocaleTimeString('pt-BR')
      }));
    }
  }

  async fetchTickerBySymbol(symbol: string): Promise<CryptoAsset | null> {
    const list = await this.fetchTickers();
    return list.find(a => a.symbol === symbol) || null;
  }
}

export const apiService = new CryptoApiService();

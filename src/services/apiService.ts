import { CryptoAsset, CandleData, Timeframe } from '../types/crypto';
import { INITIAL_ASSETS, generateCandlesForAsset } from './mockData';
import { calculateAllIndicators } from './indicators';

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

export interface KlineFetchResult {
  candles: CandleData[];
  isLive: boolean;
  source: 'BINANCE_LIVE' | 'DEMO_SYNTHETIC';
  symbol: string;
  timeframe: Timeframe;
  errorMessage?: string;
}

export interface MarketDataProvider {
  fetchTickers(): Promise<CryptoAsset[]>;
  fetchTickerBySymbol(symbol: string): Promise<CryptoAsset | null>;
  fetchHistoricalKlines(symbol: string, timeframe: Timeframe, assetFallback?: CryptoAsset, limit?: number): Promise<KlineFetchResult>;
  checkExchangeHealth(): Promise<{ binance: ExchangeHealth; bybit: ExchangeHealth }>;
}

/**
 * Formata o timestamp de abertura de um candle em formato amigável para exibição.
 */
export function formatBinanceKlineTime(timestamp: number, timeframe: Timeframe): string {
  const d = new Date(timestamp);
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');

  if (timeframe === '1D' || timeframe === '1W') {
    return `${day}/${month}`;
  }
  return `${day}/${month} ${hours}:${minutes}`;
}

/**
 * Converte o timeframe do CryptoRadar para o intervalo oficial da Binance.
 */
export function timeframeToBinanceInterval(tf: Timeframe): string {
  switch (tf) {
    case '15m': return '15m';
    case '1h': return '1h';
    case '4h': return '4h';
    case '1D': return '1d';
    case '1W': return '1w';
    default: return '4h';
  }
}

/**
 * Converte um elemento bruto da API de Klines da Binance para o tipo CandleData.
 */
export function parseBinanceKline(raw: any[], timeframe: Timeframe, decimals: number = 2): CandleData | null {
  if (!Array.isArray(raw) || raw.length < 6) return null;
  const timestamp = Number(raw[0]);
  const open = parseFloat(raw[1]);
  const high = parseFloat(raw[2]);
  const low = parseFloat(raw[3]);
  const close = parseFloat(raw[4]);
  const volume = parseFloat(raw[5]);

  if (
    !Number.isFinite(timestamp) ||
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close) ||
    open <= 0
  ) {
    return null;
  }

  return {
    time: formatBinanceKlineTime(timestamp, timeframe),
    timestamp,
    open: Number(open.toFixed(decimals)),
    high: Number(high.toFixed(decimals)),
    low: Number(low.toFixed(decimals)),
    close: Number(close.toFixed(decimals)),
    volume: Number(volume.toFixed(2))
  };
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

  /**
   * Cotações 24h de símbolos arbitrários (ex: moedas de sinais e de posições simuladas fora da lista fixa).
   * Falhas retornam lista vazia; nunca inventa preço.
   */
  async fetchAssetsBySymbols(symbols: string[]): Promise<CryptoAsset[]> {
    const unique = Array.from(new Set(symbols.filter((x) => /^[A-Z0-9]{3,20}USDT$/.test(x))));
    const out: CryptoAsset[] = [];
    for (let i = 0; i < unique.length; i += 50) {
      const chunk = encodeURIComponent(JSON.stringify(unique.slice(i, i + 50)));
      for (const host of ['https://api.binance.com', 'https://data-api.binance.vision']) {
        try {
          const r = await fetch(`${host}/api/v3/ticker/24hr?symbols=${chunk}`, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(5000)
          });
          if (!r.ok) continue;
          const raw = await r.json();
          if (!Array.isArray(raw)) continue;
          for (const t of raw) {
            const price = parseFloat(t.lastPrice);
            if (!t?.symbol || !Number.isFinite(price) || price <= 0) continue;
            const base = String(t.symbol).replace(/USDT$/, '');
            out.push({
              id: String(t.symbol).toLowerCase(),
              symbol: t.symbol,
              baseAsset: base,
              quoteAsset: 'USDT',
              name: base,
              price,
              change24h: parseFloat(t.priceChangePercent) || 0,
              high24h: parseFloat(t.highPrice) || price,
              low24h: parseFloat(t.lowPrice) || price,
              volume24h: parseFloat(t.quoteVolume) || 0,
              exchanges: ['binance'],
              sparkline: [price],
              lastUpdated: new Date().toLocaleTimeString('pt-BR'),
              isDemoData: false
            });
          }
          break;
        } catch { /* tenta o espelho */ }
      }
    }
    return out;
  }

  async fetchTickerBySymbol(symbol: string): Promise<CryptoAsset | null> {
    const list = await this.fetchTickers();
    return list.find((a) => a.symbol === symbol) || null;
  }

  /**
   * Consulta candles históricos reais na API pública oficial da Binance.
   * Suporta timeframes 15m, 1h, 4h, 1D, 1W.
   * Não mistura candles sintéticos com reais. Se a API falhar, reporta explicitamente
   * o estado offline/demonstração.
   */
  async fetchHistoricalKlines(
    symbol: string,
    timeframe: Timeframe,
    assetFallback?: CryptoAsset,
    limit: number = 60
  ): Promise<KlineFetchResult> {
    const interval = timeframeToBinanceInterval(timeframe);
    const decimals = assetFallback && assetFallback.price < 10 ? 4 : 2;

    // Tentativas ordenadas: endpoint principal da Binance e mirror público oficial Binance Vision
    const endpoints = [
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
      `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
    ];

    let lastError: string | undefined;

    for (const url of endpoints) {
      try {
        const response = await fetch(url, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(5000)
        });

        if (!response.ok) {
          lastError = `Status HTTP ${response.status}`;
          continue;
        }

        const rawKlines = await response.json();
        if (!Array.isArray(rawKlines) || rawKlines.length === 0) {
          lastError = 'Resposta de klines vazia ou formato inválido';
          continue;
        }

        const parsedCandles: CandleData[] = [];
        for (const item of rawKlines) {
          const c = parseBinanceKline(item, timeframe, decimals);
          if (c) {
            parsedCandles.push(c);
          }
        }

        if (parsedCandles.length < 5) {
          lastError = 'Quantidade de velas válidas insuficiente retornada pela API';
          continue;
        }

        // Sucesso real: calcula todos os indicadores nas velas reais obtidas
        const candlesWithIndicators = calculateAllIndicators(parsedCandles, decimals);

        return {
          candles: candlesWithIndicators,
          isLive: true,
          source: 'BINANCE_LIVE',
          symbol,
          timeframe
        };
      } catch (err: any) {
        lastError = err?.message || 'Erro de rede ou timeout';
      }
    }

    // Se nenhum endpoint público respondeu, gera velas sintéticas devidamente sinalizadas
    const fallbackAsset = assetFallback || this.fallbackAssets.find((a) => a.symbol === symbol) || {
      id: symbol.toLowerCase(),
      symbol,
      baseAsset: symbol.replace('USDT', ''),
      quoteAsset: 'USDT',
      name: symbol,
      price: 100,
      change24h: 0,
      high24h: 105,
      low24h: 95,
      volume24h: 1000000,
      marketCap: 10000000,
      exchanges: ['binance'],
      sparkline: [100, 101, 102],
      lastUpdated: new Date().toLocaleTimeString('pt-BR'),
      isDemoData: true
    };

    const syntheticCandles = generateCandlesForAsset(fallbackAsset, limit);

    return {
      candles: syntheticCandles,
      isLive: false,
      source: 'DEMO_SYNTHETIC',
      symbol,
      timeframe,
      errorMessage: `Falha ao consultar API da Binance (${lastError || 'indisponível'}). Exibindo simulação sintética.`
    };
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

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

/** Casas decimais para guardar o preço sem zerar moedas de valor muito baixo (ex: PEPE). */
export function priceDecimals(price: number): number {
  return price >= 1000 ? 2 : price >= 1 ? 4 : price >= 0.01 ? 6 : 10;
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

/**
 * Resultado da validação de integridade dos dados de mercado da Binance.
 */
export interface MarketDataValidationResult {
  isValid: boolean;
  isDemoDataForced: boolean;
  reason?: string;
  volatility: number;
  timestampAgeMs: number;
  isStaleTimestamp: boolean;
  isStaticPrices: boolean;
  consecutiveStaticCycles: number;
  lastCheckedAt: number;
}

/**
 * Parâmetros de tolerância do validador de dados.
 */
export interface MarketDataValidatorConfig {
  /** Idade máxima do timestamp da Binance em ms (padrão: 180.000 ms = 3 min) */
  maxTimestampAgeMs?: number;
  /** Tolerância para detectar congelamento de timestamp entre consultas (padrão: 30.000 ms) */
  timestampFreezeToleranceMs?: number;
  /** Variação mínima aceitável para considerar volatilidade saudável (padrão: 0.00001) */
  minVolatilityThreshold?: number;
  /** Número máximo de ciclos com preços 100% estáticos antes de forçar modo de simulação (padrão: 2) */
  maxStaticCycles?: number;
  /** Duração máxima de preços estáticos em ms antes de forçar modo de simulação (padrão: 45.000 ms) */
  maxStaticDurationMs?: number;
}

/**
 * Utilitário puro de validação de dados da Binance.
 * Compara timestamp e volatilidade dos preços recebidos.
 * Se os dados forem estáticos, congelados ou não variarem em um período razoável,
 * força o estado de simulação (isDemoDataForced: true, isValid: false).
 */
export function validateBinanceMarketData(
  tickers: any[],
  previousPricesMap?: Map<string, number> | Record<string, number> | null,
  options?: MarketDataValidatorConfig & {
    now?: number;
    previousTimestamp?: number | null;
    previousCheckedAt?: number | null;
    staticSinceTimestamp?: number | null;
    consecutiveStaticCycles?: number;
  }
): MarketDataValidationResult {
  const now = options?.now ?? Date.now();
  const maxTimestampAgeMs = options?.maxTimestampAgeMs ?? 180_000;
  const timestampFreezeToleranceMs = options?.timestampFreezeToleranceMs ?? 30_000;
  const minVolatilityThreshold = options?.minVolatilityThreshold ?? 0.00001;
  const maxStaticCycles = options?.maxStaticCycles ?? 2;
  const maxStaticDurationMs = options?.maxStaticDurationMs ?? 45_000;
  let consecutiveCycles = options?.consecutiveStaticCycles ?? 0;

  if (!Array.isArray(tickers) || tickers.length === 0) {
    return {
      isValid: false,
      isDemoDataForced: true,
      reason: 'Lista de cotações da Binance vazia ou corrompida',
      volatility: 0,
      timestampAgeMs: 0,
      isStaleTimestamp: true,
      isStaticPrices: true,
      consecutiveStaticCycles: consecutiveCycles + 1,
      lastCheckedAt: now
    };
  }

  // 1. Validação de Timestamps
  let latestCloseTime = 0;
  for (const t of tickers) {
    const rawTime = Number(t.closeTime ?? t.openTime ?? t.timestamp ?? 0);
    if (Number.isFinite(rawTime) && rawTime > latestCloseTime) {
      latestCloseTime = rawTime;
    }
  }

  const timestampAgeMs = latestCloseTime > 0 ? Math.max(0, now - latestCloseTime) : 0;
  const isStaleTimestamp = latestCloseTime > 0 && timestampAgeMs > maxTimestampAgeMs;

  let isFrozenTimestamp = false;
  if (
    options?.previousTimestamp &&
    options?.previousCheckedAt &&
    latestCloseTime > 0
  ) {
    const elapsed = now - options.previousCheckedAt;
    if (elapsed >= timestampFreezeToleranceMs && latestCloseTime === options.previousTimestamp) {
      isFrozenTimestamp = true;
    }
  }

  // 2. Validação de Volatilidade
  let totalSpread = 0;
  let countSpread = 0;
  const currentPrices = new Map<string, number>();

  for (const t of tickers) {
    const sym = String(t.symbol || t.id || '');
    const price = parseFloat(t.lastPrice ?? t.price ?? 0);
    const high = parseFloat(t.highPrice ?? t.high24h ?? price);
    const low = parseFloat(t.lowPrice ?? t.low24h ?? price);

    if (sym && Number.isFinite(price) && price > 0) {
      currentPrices.set(sym, price);
      if (Number.isFinite(high) && Number.isFinite(low) && high >= low) {
        const spread = (high - low) / price;
        totalSpread += spread;
        countSpread++;
      }
    }
  }

  const avgIntradaySpread = countSpread > 0 ? totalSpread / countSpread : 0;
  const hasZeroIntradayVolatility = countSpread > 0 && avgIntradaySpread < minVolatilityThreshold;

  // Comparação temporal com ciclo anterior
  let isIdenticalToPrevious = false;
  const prevMap =
    previousPricesMap instanceof Map
      ? previousPricesMap
      : previousPricesMap
      ? new Map(Object.entries(previousPricesMap))
      : null;

  if (prevMap && prevMap.size > 0 && currentPrices.size > 0) {
    let checkedCount = 0;
    let matchCount = 0;
    for (const [sym, price] of currentPrices.entries()) {
      const prev = prevMap.get(sym);
      if (prev !== undefined) {
        checkedCount++;
        if (price === prev) {
          matchCount++;
        }
      }
    }
    if (checkedCount > 0 && matchCount === checkedCount) {
      isIdenticalToPrevious = true;
    }
  }

  if (isIdenticalToPrevious) {
    consecutiveCycles++;
  } else {
    consecutiveCycles = 0;
  }

  const staticSince = isIdenticalToPrevious
    ? options?.staticSinceTimestamp ?? options?.previousCheckedAt ?? now
    : null;
  const staticDurationMs = staticSince !== null ? now - staticSince : 0;

  const isStaticDurationExceeded = staticSince !== null && staticDurationMs >= maxStaticDurationMs;
  const isStaticCyclesExceeded = consecutiveCycles >= maxStaticCycles;
  const isStaticPrices = hasZeroIntradayVolatility || (isIdenticalToPrevious && (isStaticDurationExceeded || isStaticCyclesExceeded));

  let reason: string | undefined;
  let isDemoDataForced = false;

  if (isStaleTimestamp) {
    reason = `Timestamp desatualizado da Binance (${Math.round(timestampAgeMs / 1000)}s atrás)`;
    isDemoDataForced = true;
  } else if (isFrozenTimestamp) {
    reason = 'Timestamp da Binance congelado entre consultas sucessivas';
    isDemoDataForced = true;
  } else if (hasZeroIntradayVolatility) {
    reason = 'Volatilidade nula detectada nos preços da Binance (high = low)';
    isDemoDataForced = true;
  } else if (isStaticPrices) {
    reason = `Preços estáticos e sem variação detectada da Binance no período (${consecutiveCycles} ciclo(s))`;
    isDemoDataForced = true;
  }

  return {
    isValid: !isDemoDataForced,
    isDemoDataForced,
    reason,
    volatility: avgIntradaySpread,
    timestampAgeMs,
    isStaleTimestamp,
    isStaticPrices,
    consecutiveStaticCycles: consecutiveCycles,
    lastCheckedAt: now
  };
}

/**
 * Utilitário com estado para validação contínua da saúde e volatilidade da Binance.
 */
export class MarketDataValidator {
  private config: Required<MarketDataValidatorConfig>;
  private previousSnapshot: Map<string, number> | null = null;
  private previousTimestamp: number | null = null;
  private previousCheckedAt: number | null = null;
  private staticSinceTimestamp: number | null = null;
  private consecutiveStaticCycles = 0;
  private lastResult: MarketDataValidationResult = {
    isValid: true,
    isDemoDataForced: false,
    volatility: 1,
    timestampAgeMs: 0,
    isStaleTimestamp: false,
    isStaticPrices: false,
    consecutiveStaticCycles: 0,
    lastCheckedAt: Date.now()
  };

  constructor(config?: MarketDataValidatorConfig) {
    this.config = {
      maxTimestampAgeMs: config?.maxTimestampAgeMs ?? 180_000,
      timestampFreezeToleranceMs: config?.timestampFreezeToleranceMs ?? 30_000,
      minVolatilityThreshold: config?.minVolatilityThreshold ?? 0.00001,
      maxStaticCycles: config?.maxStaticCycles ?? 2,
      maxStaticDurationMs: config?.maxStaticDurationMs ?? 45_000
    };
  }

  validate(tickers: any[], now = Date.now()): MarketDataValidationResult {
    const result = validateBinanceMarketData(tickers, this.previousSnapshot, {
      ...this.config,
      now,
      previousTimestamp: this.previousTimestamp,
      previousCheckedAt: this.previousCheckedAt,
      staticSinceTimestamp: this.staticSinceTimestamp,
      consecutiveStaticCycles: this.consecutiveStaticCycles
    });

    // Atualiza contadores internos
    this.consecutiveStaticCycles = result.consecutiveStaticCycles;
    if (this.consecutiveStaticCycles > 0) {
      if (this.staticSinceTimestamp === null) {
        this.staticSinceTimestamp = this.previousCheckedAt || now;
      }
    } else {
      this.staticSinceTimestamp = null;
    }

    // Salva novo snapshot de preços
    const nextSnapshot = new Map<string, number>();
    let latestClose = 0;
    for (const t of tickers) {
      const sym = String(t.symbol || t.id || '');
      const price = parseFloat(t.lastPrice ?? t.price ?? 0);
      const ct = Number(t.closeTime ?? t.openTime ?? t.timestamp ?? 0);
      if (sym && Number.isFinite(price) && price > 0) {
        nextSnapshot.set(sym, price);
      }
      if (Number.isFinite(ct) && ct > latestClose) {
        latestClose = ct;
      }
    }

    this.previousSnapshot = nextSnapshot;
    if (latestClose > 0) this.previousTimestamp = latestClose;
    this.previousCheckedAt = now;
    this.lastResult = result;

    return result;
  }

  forceDemoMode(reason = 'Modo de simulação forçado pela validação de integridade'): void {
    this.lastResult = {
      isValid: false,
      isDemoDataForced: true,
      reason,
      volatility: 0,
      timestampAgeMs: 0,
      isStaleTimestamp: false,
      isStaticPrices: true,
      consecutiveStaticCycles: this.config.maxStaticCycles,
      lastCheckedAt: Date.now()
    };
  }

  reset(): void {
    this.previousSnapshot = null;
    this.previousTimestamp = null;
    this.previousCheckedAt = null;
    this.staticSinceTimestamp = null;
    this.consecutiveStaticCycles = 0;
    this.lastResult = {
      isValid: true,
      isDemoDataForced: false,
      volatility: 1,
      timestampAgeMs: 0,
      isStaleTimestamp: false,
      isStaticPrices: false,
      consecutiveStaticCycles: 0,
      lastCheckedAt: Date.now()
    };
  }

  isDemoDataForced(): boolean {
    return this.lastResult.isDemoDataForced;
  }

  getLastResult(): MarketDataValidationResult {
    return this.lastResult;
  }
}

export const marketDataValidator = new MarketDataValidator();

export class CryptoApiService implements MarketDataProvider {
  private fallbackAssets: CryptoAsset[] = INITIAL_ASSETS;
  private marketValidator: MarketDataValidator = marketDataValidator;
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

      let rawData: any = null;

      // 1. Tenta proxy local /api/market/tickers do servidor Fullstack
      try {
        const localRes = await fetch('/api/market/tickers', { signal: AbortSignal.timeout(3000) });
        if (localRes.ok) {
          const list = await localRes.json();
          if (Array.isArray(list) && list.length > 0) {
            rawData = list;
          }
        }
      } catch {
        // Fallback para espelhos públicos oficiais
      }

      // 2. Se o proxy local não respondeu, consulta os espelhos oficiais da Binance (Vision primeiro, sem bloqueio regional)
      if (!rawData) {
        const endpoints = [
          `https://data-api.binance.vision/api/v3/ticker/24hr?symbols=${symbolsParam}`,
          `https://api.binance.com/api/v3/ticker/24hr?symbols=${symbolsParam}`
        ];

        for (const url of endpoints) {
          try {
            const response = await fetch(url, {
              headers: { Accept: 'application/json' },
              signal: AbortSignal.timeout(4000)
            });
            if (response.ok) {
              const parsed = await response.json();
              if (Array.isArray(parsed) && parsed.length > 0) {
                rawData = parsed;
                break;
              }
            }
          } catch {
            // tenta o próximo espelho
          }
        }
      }

      if (!Array.isArray(rawData)) {
        throw new Error('Falha ao obter cotações da Binance nos espelhos públicos');
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

      // 3. Validação de integridade dos dados da Binance: compara timestamp e volatilidade
      const validation = this.marketValidator.validate(rawData);
      const isForcedDemo = !validation.isValid || validation.isDemoDataForced;

      if (isForcedDemo) {
        // Se os dados forem estáticos, congelados ou sem volatilidade, força isDemoData para true em toda a aplicação
        for (const asset of updated) {
          asset.isDemoData = true;
        }
        this.fallbackAssets = updated;
        this.binanceHealth = {
          exchange: 'binance',
          status: 'OFFLINE_DEMO',
          statusLabel: 'Dados em modo de simulação',
          isImplemented: true,
          isLive: false,
          lastChecked: new Date().toLocaleTimeString('pt-BR'),
          errorMessage: validation.reason || 'Dados estáticos ou sem variação detectada da Binance'
        };
      } else {
        this.fallbackAssets = updated;
        this.binanceHealth = {
          exchange: 'binance',
          status: 'CONNECTED',
          statusLabel: 'Conectada (Ao Vivo)',
          isImplemented: true,
          isLive: true,
          lastChecked: new Date().toLocaleTimeString('pt-BR')
        };
      }

      return updated;
    } catch (err: any) {
      this.marketValidator.forceDemoMode(err?.message || 'Falha de conexão com a API pública da Binance');
      this.binanceHealth = {
        exchange: 'binance',
        status: 'OFFLINE_DEMO',
        statusLabel: 'Dados em modo de simulação',
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
    const forceDemo = this.marketValidator.isDemoDataForced();

    for (let i = 0; i < unique.length; i += 50) {
      const chunk = encodeURIComponent(JSON.stringify(unique.slice(i, i + 50)));
      for (const host of ['https://data-api.binance.vision', 'https://api.binance.com']) {
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
              isDemoData: forceDemo
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
    const decimals = assetFallback ? priceDecimals(assetFallback.price) : 4;

    // Tentativas ordenadas: mirror público oficial Binance Vision (sem bloqueio) e endpoint principal
    const endpoints = [
      `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
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
    const binance = { ...this.binanceHealth };
    if (this.marketValidator.isDemoDataForced()) {
      binance.status = 'OFFLINE_DEMO';
      binance.statusLabel = 'Dados em modo de simulação';
      binance.isLive = false;
    }
    return {
      binance,
      bybit: { ...this.bybitHealth }
    };
  }

  /**
   * Retorna o status detalhado da última validação de dados da Binance.
   */
  getDataValidationStatus(): MarketDataValidationResult {
    return this.marketValidator.getLastResult();
  }

  /**
   * Indica se a aplicação foi forçada para o modo de simulação devido a dados estáticos ou erro.
   */
  isSimulationMode(): boolean {
    return this.marketValidator.isDemoDataForced();
  }

  /**
   * Permite redefinir ou injetar uma instância customizada do validador (útil para auditoria e testes).
   */
  setValidator(validator: MarketDataValidator): void {
    this.marketValidator = validator;
  }
}

export const apiService = new CryptoApiService();

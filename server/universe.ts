/**
 * Universo de moedas: as 100 maiores por valor de mercado.
 * Fonte principal: CoinMarketCap (exige CMC_API_KEY). Sem chave, usa o CoinGecko público (mesmo ranking por market cap).
 * Cada moeda é cruzada com os pares USDT existentes na Binance; as que não existem lá são listadas em `skipped`.
 */

export const STABLECOINS = new Set([
  'USDT', 'USDC', 'DAI', 'FDUSD', 'TUSD', 'USDE', 'USDS', 'PYUSD', 'BUSD', 'USDD', 'USD1', 'USDG', 'RLUSD'
]);

export interface UniverseCoin {
  rank: number;
  baseAsset: string;
  name: string;
  symbol: string; // par Binance, ex: BTCUSDT
  marketCap: number;
}

export type ExchangeName = 'binance' | 'bybit';

export interface Universe {
  source: 'COINMARKETCAP' | 'COINGECKO';
  fetchedAt: number;
  exchanges: ExchangeName[]; // corretoras que precisam listar o par (interseção)
  coins: UniverseCoin[];
  skipped: string[]; // top 100 sem par USDT em alguma das corretoras exigidas, ex: "KAS [sem Bybit]"
}

/** Corretoras exigidas, via EXCHANGES (padrão: binance,bybit). O par precisa existir em TODAS. */
export function requiredExchanges(): ExchangeName[] {
  const list = (process.env.EXCHANGES || 'binance,bybit')
    .split(',').map((x) => x.trim().toLowerCase())
    .filter((x): x is ExchangeName => x === 'binance' || x === 'bybit');
  return list.length > 0 ? Array.from(new Set(list)) : ['binance', 'bybit'];
}

/** Pares spot negociáveis na Bybit (API pública v5). */
export async function fetchBybitSpotSymbols(): Promise<Set<string>> {
  const r = await fetch('https://api.bybit.com/v5/market/tickers?category=spot', {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000)
  });
  if (!r.ok) throw new Error(`Bybit HTTP ${r.status}`);
  const j: any = await r.json();
  if (j?.retCode !== 0 || !Array.isArray(j?.result?.list)) {
    throw new Error(`Bybit retornou resposta inválida (retCode ${j?.retCode ?? '?'})`);
  }
  return new Set<string>(j.result.list.map((t: any) => String(t.symbol)));
}

const BINANCE_HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];

export async function binanceGet(path: string, timeoutMs = 8000): Promise<any> {
  let lastErr: unknown;
  for (const host of BINANCE_HOSTS) {
    try {
      const r = await fetch(`${host}${path}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
      if (r.ok) return await r.json();
      lastErr = new Error(`HTTP ${r.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Binance indisponível');
}

async function fetchTop100(): Promise<{ source: Universe['source']; items: { rank: number; sym: string; name: string; mcap: number }[] }> {
  const cmcKey = process.env.CMC_API_KEY?.trim();
  if (cmcKey) {
    const r = await fetch('https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?limit=100&sort=market_cap', {
      headers: { 'X-CMC_PRO_API_KEY': cmcKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) throw new Error(`CoinMarketCap HTTP ${r.status}`);
    const j: any = await r.json();
    return {
      source: 'COINMARKETCAP',
      items: (j.data || []).map((d: any, i: number) => ({
        rank: d.cmc_rank ?? i + 1,
        sym: String(d.symbol).toUpperCase(),
        name: d.name,
        mcap: d.quote?.USD?.market_cap ?? 0
      }))
    };
  }
  const r = await fetch(
    'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1',
    { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) }
  );
  if (!r.ok) throw new Error(`CoinGecko HTTP ${r.status}`);
  const j: any = await r.json();
  return {
    source: 'COINGECKO',
    items: (j || []).map((d: any, i: number) => ({
      rank: d.market_cap_rank ?? i + 1,
      sym: String(d.symbol).toUpperCase(),
      name: d.name,
      mcap: d.market_cap ?? 0
    }))
  };
}

export async function buildUniverse(): Promise<Universe> {
  const exchanges = requiredExchanges();
  const [top, binancePrices, bybitPairs] = await Promise.all([
    fetchTop100(),
    binanceGet('/api/v3/ticker/price'), // sempre necessário: fonte dos candles
    exchanges.includes('bybit') ? fetchBybitSpotSymbols() : Promise.resolve(null)
  ]);
  const binancePairs = new Set<string>((binancePrices as any[]).map((p) => p.symbol));

  const coins: UniverseCoin[] = [];
  const skipped: string[] = [];
  for (const it of top.items) {
    if (STABLECOINS.has(it.sym)) continue;
    const symbol = `${it.sym}USDT`;
    const missing: string[] = [];
    // A Binance é sempre consultada (candles); só exige o par se estiver entre as corretoras exigidas.
    if (!binancePairs.has(symbol)) missing.push('Binance'); // candles vêm da Binance, então o par precisa existir nela
    if (bybitPairs && !bybitPairs.has(symbol)) missing.push('Bybit');
    if (missing.length === 0) coins.push({ rank: it.rank, baseAsset: it.sym, name: it.name, symbol, marketCap: it.mcap });
    else skipped.push(`${it.sym} [sem ${missing.join(' e ')}]`);
  }
  return { source: top.source, fetchedAt: Date.now(), exchanges, coins, skipped };
}

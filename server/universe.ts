/**
 * Universo de moedas: as 100 maiores por valor de mercado.
 * Fonte principal: CoinMarketCap (exige CMC_API_KEY). Sem chave, usa o CoinGecko público (mesmo ranking por market cap).
 * Cada moeda é cruzada com os pares USDT existentes na Binance; as que não existem lá são listadas em `skipped`.
 */

import { getStateSafe, setStateSafe } from './stateStore';
import { MarketType } from '../src/types/crypto';
import { futuresSymbolsFrom } from './futuresData';

export const STABLECOINS = new Set([
  'USDT', 'USDC', 'DAI', 'FDUSD', 'TUSD', 'USDE', 'USDS', 'PYUSD', 'BUSD', 'USDD', 'USD1', 'USDG', 'RLUSD',
  'BFUSD', 'USDY', 'USDF', 'USDGO', 'USTB', 'OUSD', 'GHO', 'U',
  // Ouro tokenizado e versões "embrulhadas" de outras moedas: não se comportam como cripto independente
  'PAXG', 'XAUT', 'WBTC', 'WETH', 'STETH', 'WSTETH', 'WEETH', 'CBBTC', 'BTCB', 'WBETH'
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
  source: 'COINMARKETCAP' | 'COINGECKO' | 'COINPAPRIKA';
  stale?: boolean; // ranking vindo do cache (as fontes online falharam)
  unverified?: ExchangeName[]; // corretoras que não puderam ser consultadas (ex: Binance de futuros bloqueada na região do servidor)
  fetchedAt: number;
  exchanges: ExchangeName[]; // corretoras que precisam listar o par (interseção)
  coins: UniverseCoin[];
  skipped: string[]; // top 100 sem par USDT em alguma das corretoras exigidas, ex: "KAS [sem Bybit]"
}

/** Corretoras exigidas, via EXCHANGES (padrão: binance; a Bybit fica para depois). O par precisa existir em TODAS. */
export function requiredExchanges(): ExchangeName[] {
  const list = (process.env.EXCHANGES || 'binance')
    .split(',').map((x) => x.trim().toLowerCase())
    .filter((x): x is ExchangeName => x === 'binance' || x === 'bybit');
  return list.length > 0 ? Array.from(new Set(list)) : ['binance'];
}

/** Pares negociáveis na Bybit (API pública v5): spot ou perpétuos lineares (USDT). */
export async function fetchBybitSymbols(category: 'spot' | 'linear' = 'spot'): Promise<Set<string>> {
  const r = await fetch(`https://api.bybit.com/v5/market/tickers?category=${category}`, {
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

const BINANCE_HOSTS: Record<MarketType, string[]> = {
  spot: ['https://data-api.binance.vision', 'https://api.binance.com'],
  futures: ['https://fapi.binance.com']
};

/** GET público na Binance. `market` escolhe a API: spot (/api/v3) ou futuros USDT-M (/fapi/v1). */
export async function binanceGet(path: string, timeoutMs = 8000, market: MarketType = 'spot'): Promise<any> {
  let lastErr: unknown;
  for (const host of BINANCE_HOSTS[market]) {
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

interface TopItem { rank: number; sym: string; name: string; mcap: number }
interface Top100 { source: Universe['source']; items: TopItem[]; fetchedAt: number; stale?: boolean }

const TOP_TTL_MS = 6 * 3600e3;          // reutiliza o ranking por 6h (evita estourar o limite das APIs gratuitas)
const TOP_STALE_MAX_MS = 7 * 24 * 3600e3; // se tudo falhar, aceita um ranking de até 7 dias
let top100Cache: Top100 | null = null;
let top100InFlight: Promise<Top100> | null = null;

export function resetTop100Cache() {
  top100Cache = null;
  top100InFlight = null;
}

function cacheOff(): boolean {
  return process.env.UNIVERSE_CACHE === 'off';
}

async function readDiskCache(): Promise<Top100 | null> {
  if (cacheOff()) return null;
  const rec = await getStateSafe('top100');
  const c = rec?.value;
  return Array.isArray(c?.items) && c.items.length > 0 ? c : null;
}

function writeDiskCache(c: Top100) {
  if (cacheOff()) return;
  void setStateSafe('top100', c);
}

/** GET com novas tentativas em 429 (limite) e 5xx, respeitando Retry-After. */
async function getJsonWithRetry(url: string, init: RequestInit, attempts = 3): Promise<any> {
  const baseMs = Number(process.env.RETRY_BASE_MS ?? 1500);
  let lastStatus = 0;
  for (let i = 0; i < attempts; i++) {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
    if (r.ok) return r.json();
    lastStatus = r.status;
    if (r.status !== 429 && r.status < 500) break;
    const retryAfter = Number(r.headers.get('retry-after'));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 10000) : baseMs * 2 ** i;
    if (i < attempts - 1) await new Promise((res) => setTimeout(res, wait));
  }
  throw new Error(`HTTP ${lastStatus}`);
}

const providers: { name: string; enabled: () => boolean; run: () => Promise<Omit<Top100, 'fetchedAt'>> }[] = [
  {
    name: 'CoinMarketCap',
    enabled: () => Boolean(process.env.CMC_API_KEY?.trim()),
    run: async () => {
      const j = await getJsonWithRetry('https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?limit=100&sort=market_cap', {
        headers: { 'X-CMC_PRO_API_KEY': process.env.CMC_API_KEY!.trim(), Accept: 'application/json' }
      });
      return {
        source: 'COINMARKETCAP',
        items: (j.data || []).map((d: any, i: number) => ({
          rank: d.cmc_rank ?? i + 1, sym: String(d.symbol).toUpperCase(), name: d.name, mcap: d.quote?.USD?.market_cap ?? 0
        }))
      };
    }
  },
  {
    name: 'CoinGecko',
    enabled: () => true,
    run: async () => {
      const j = await getJsonWithRetry(
        'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1',
        { headers: { Accept: 'application/json' } }
      );
      return {
        source: 'COINGECKO',
        items: (j || []).map((d: any, i: number) => ({
          rank: d.market_cap_rank ?? i + 1, sym: String(d.symbol).toUpperCase(), name: d.name, mcap: d.market_cap ?? 0
        }))
      };
    }
  },
  {
    name: 'CoinPaprika',
    enabled: () => true,
    run: async () => {
      // Lista ordenada por ranking; pegamos as primeiras e removemos símbolos repetidos (mantém o de melhor ranking)
      const j = await getJsonWithRetry('https://api.coinpaprika.com/v1/tickers?quotes=USD', { headers: { Accept: 'application/json' } });
      const seen = new Set<string>();
      const items: TopItem[] = [];
      for (const d of (j || []).slice(0, 200)) {
        const sym = String(d.symbol).toUpperCase();
        if (seen.has(sym)) continue;
        seen.add(sym);
        items.push({ rank: d.rank ?? items.length + 1, sym, name: d.name, mcap: d.quotes?.USD?.market_cap ?? 0 });
        if (items.length >= 100) break;
      }
      return { source: 'COINPAPRIKA', items };
    }
  }
];

/**
 * Top 100 por valor de mercado. Ordem: CoinMarketCap (se houver chave) → CoinGecko → CoinPaprika.
 * O resultado fica em cache (memória e disco) e as chamadas simultâneas dos dois scanners compartilham a mesma busca.
 * Se todas as fontes falharem, usa o último ranking salvo (até 7 dias) em vez de parar o scanner.
 */
async function fetchTop100(): Promise<Top100> {
  const now = Date.now();
  if (top100Cache && now - top100Cache.fetchedAt < TOP_TTL_MS && !top100Cache.stale) return top100Cache;
  if (top100InFlight) return top100InFlight;

  top100InFlight = (async () => {
    const disk = top100Cache ?? (await readDiskCache());
    // Cache em disco ainda fresco (ex: reinício do servidor): nem consulta a rede
    if (disk && Date.now() - disk.fetchedAt < TOP_TTL_MS) {
      top100Cache = { ...disk, stale: false };
      return top100Cache;
    }
    const errors: string[] = [];
    for (const p of providers) {
      if (!p.enabled()) continue;
      try {
        const res = await p.run();
        if (res.items.length === 0) throw new Error('lista vazia');
        top100Cache = { ...res, fetchedAt: Date.now() };
        writeDiskCache(top100Cache);
        return top100Cache;
      } catch (e: any) {
        errors.push(`${p.name}: ${e?.message ?? 'falha'}`);
      }
    }
    if (disk && Date.now() - disk.fetchedAt < TOP_STALE_MAX_MS) {
      console.warn(`Ranking top 100 indisponível (${errors.join('; ')}). Usando o último salvo.`);
      top100Cache = { ...disk, stale: true, fetchedAt: disk.fetchedAt };
      return top100Cache;
    }
    throw new Error(`Não foi possível obter o ranking das 100 maiores (${errors.join('; ')})`);
  })();
  try {
    return await top100InFlight;
  } finally {
    top100InFlight = null;
  }
}

/** Nos perpétuos, moedas de preço muito baixo usam múltiplos (ex: 1000PEPEUSDT). */
const FUTURES_PREFIXES = ['', '1000', '10000', '1000000'];

export function resolveFuturesSymbol(sym: string, available: Set<string>): string | null {
  for (const prefix of FUTURES_PREFIXES) {
    const candidate = `${prefix}${sym}USDT`;
    if (available.has(candidate)) return candidate;
  }
  return null;
}

export async function buildUniverse(market: MarketType = 'spot'): Promise<Universe> {
  const exchanges = requiredExchanges();
  const futures = market === 'futures';
  const top = await fetchTop100();
  const unverified: ExchangeName[] = [];
  let binancePairs: Set<string> | null = null;
  let bybitPairs: Set<string> | null = null;

  if (futures) {
    // Binance e Bybit de futuros podem estar bloqueadas na região do servidor: usa as que responderem.
    // A Bybit é sempre consultada em futuros (serve de lista de reserva), mas só entra na interseção se estiver exigida.
    [binancePairs, bybitPairs] = await Promise.all([
      futuresSymbolsFrom('binance').catch(() => null),
      fetchBybitSymbols('linear').catch(() => null)
    ]);
    if (!binancePairs) unverified.push('binance');
    if (exchanges.includes('bybit') && !bybitPairs) unverified.push('bybit');
    if (!binancePairs && !bybitPairs) {
      const okxPairs = await futuresSymbolsFrom('okx').catch(() => null);
      if (!okxPairs) throw new Error('Não foi possível listar os perpétuos: Binance, Bybit e OKX indisponíveis a partir deste servidor');
      binancePairs = okxPairs; // lista de referência; nenhuma das corretoras pôde ser verificada
      if (!unverified.includes('bybit')) unverified.push('bybit');
    }
  } else {
    const [bn, by] = await Promise.all([
      binanceGet('/api/v3/ticker/price', 8000, 'spot'),
      exchanges.includes('bybit') ? fetchBybitSymbols('spot') : Promise.resolve(null)
    ]);
    binancePairs = new Set<string>((bn as any[]).map((p) => String(p.symbol)));
    bybitPairs = by;
  }

  const coins: UniverseCoin[] = [];
  const skipped: string[] = [];
  for (const it of top.items) {
    if (STABLECOINS.has(it.sym)) continue;
    const missing: string[] = [];
    let symbol = `${it.sym}USDT`;

    if (futures) {
      const ref = binancePairs ?? bybitPairs!;
      const resolved = resolveFuturesSymbol(it.sym, ref);
      if (!resolved) missing.push(binancePairs ? 'Binance' : 'Bybit');
      else symbol = resolved;
      // quando as duas listas existem, o mesmo contrato precisa estar nas duas
      if (exchanges.includes('bybit') && binancePairs && bybitPairs && !(resolved ? bybitPairs.has(symbol) : resolveFuturesSymbol(it.sym, bybitPairs))) missing.push('Bybit');
    } else {
      if (!binancePairs!.has(symbol)) missing.push('Binance'); // candles vêm da Binance, então o par precisa existir nela
      if (bybitPairs && !bybitPairs.has(symbol)) missing.push('Bybit');
    }

    if (missing.length === 0) coins.push({ rank: it.rank, baseAsset: it.sym, name: it.name, symbol, marketCap: it.mcap });
    else skipped.push(`${it.sym} [sem ${missing.join(' e ')}]`);
  }
  return { source: top.source, stale: top.stale, unverified: unverified.length ? unverified : undefined, fetchedAt: Date.now(), exchanges, coins, skipped };
}

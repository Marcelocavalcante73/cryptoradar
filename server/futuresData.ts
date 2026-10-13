/**
 * Dados de futuros perpétuos USDT com fontes alternativas: Binance → Bybit → OKX.
 *
 * Servidores em regiões bloqueadas (ex: EUA) recebem HTTP 451/403 de algumas corretoras. Aqui cada pedido tenta as
 * fontes em ordem e lembra por alguns minutos a que funcionou, para não esperar as que falham a cada chamada.
 * Os candles saem sempre no formato da Binance (parseBinanceKline continua valendo). Os preços de perpétuos de grandes
 * moedas são quase idênticos entre corretoras; a execução, o stop e a liquidação valem os da corretora onde você opera.
 */

export type FuturesProvider = 'binance' | 'bybit' | 'okx';

const ORDER: FuturesProvider[] = ['binance', 'bybit', 'okx'];
const STICKY_MS = 10 * 60e3;
const BAR_MS: Record<string, number> = { '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000, '1w': 604800000 };

let preferred: { p: FuturesProvider; until: number } | null = null;
let lastUsed: FuturesProvider | null = null;

export function resetFuturesProvider() {
  preferred = null;
  lastUsed = null;
}

/** Fonte que respondeu por último com sucesso (para mostrar no app). */
export function getFuturesProvider(): FuturesProvider | null {
  return lastUsed;
}

async function getJson(name: string, url: string, timeoutMs = 8000): Promise<any> {
  const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`${name} HTTP ${r.status}`);
  return r.json();
}

/** Nos perpétuos de preço baixo, o contrato usa múltiplos (1000PEPEUSDT); na OKX o contrato é só PEPE. */
export function toOkxInstrument(symbol: string): { instId: string; factor: number } {
  const base = symbol.replace(/USDT$/, '');
  const m = base.match(/^(1000000|10000|1000)(.+)$/);
  return { instId: `${m ? m[2] : base}-USDT-SWAP`, factor: m ? Number(m[1]) : 1 };
}

interface Impl {
  klines(symbol: string, interval: string, limit: number, endTime?: number): Promise<any[][]>;
  prices(symbols: string[]): Promise<Map<string, number>>;
}

const binance: Impl = {
  async klines(symbol, interval, limit, endTime) {
    return getJson('Binance', `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}${endTime ? `&endTime=${endTime}` : ''}`);
  },
  async prices() {
    const raw = await getJson('Binance', 'https://fapi.binance.com/fapi/v1/ticker/price');
    return new Map<string, number>((raw as any[]).map((t) => [String(t.symbol), parseFloat(t.price)]));
  }
};

const BYBIT_INTERVAL: Record<string, string> = { '15m': '15', '1h': '60', '4h': '240', '1d': 'D', '1w': 'W' };

const bybit: Impl = {
  async klines(symbol, interval, limit, endTime) {
    const iv = BYBIT_INTERVAL[interval];
    if (!iv) throw new Error('Bybit: intervalo não suportado');
    const j = await getJson('Bybit', `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${iv}&limit=${Math.min(limit, 1000)}${endTime ? `&end=${endTime}` : ''}`);
    if (j?.retCode !== 0 || !Array.isArray(j?.result?.list)) throw new Error(`Bybit resposta inválida (retCode ${j?.retCode ?? '?'})`);
    const bar = BAR_MS[interval];
    // A Bybit devolve do mais novo para o mais antigo
    return [...j.result.list].reverse().map((r: any[]) => [Number(r[0]), r[1], r[2], r[3], r[4], r[5], Number(r[0]) + bar - 1]);
  },
  async prices() {
    const j = await getJson('Bybit', 'https://api.bybit.com/v5/market/tickers?category=linear');
    if (j?.retCode !== 0 || !Array.isArray(j?.result?.list)) throw new Error(`Bybit resposta inválida (retCode ${j?.retCode ?? '?'})`);
    return new Map<string, number>(j.result.list.map((t: any) => [String(t.symbol), parseFloat(t.lastPrice)]));
  }
};

const OKX_BAR: Record<string, string> = { '15m': '15m', '1h': '1H', '4h': '4H', '1d': '1Dutc', '1w': '1Wutc' };

const okx: Impl = {
  async klines(symbol, interval, limit, endTime) {
    const bar = OKX_BAR[interval];
    if (!bar) throw new Error('OKX: intervalo não suportado');
    const { instId, factor } = toOkxInstrument(symbol);
    const rows: any[][] = [];
    let after = endTime ? endTime + 1 : undefined; // a OKX devolve candles anteriores a `after`
    while (rows.length < limit) {
      const j = await getJson('OKX', `https://www.okx.com/api/v5/market/history-candles?instId=${instId}&bar=${bar}&limit=${Math.min(100, limit - rows.length)}${after ? `&after=${after}` : ''}`);
      if (j?.code !== '0' || !Array.isArray(j?.data)) throw new Error(`OKX resposta inválida (code ${j?.code ?? '?'})`);
      if (j.data.length === 0) break;
      rows.push(...j.data); // mais novo → mais antigo
      after = Number(j.data[j.data.length - 1][0]);
      if (j.data.length < Math.min(100, limit)) break;
    }
    const barMs = BAR_MS[interval];
    return rows.reverse().map((r) => [
      Number(r[0]), String(Number(r[1]) * factor), String(Number(r[2]) * factor), String(Number(r[3]) * factor), String(Number(r[4]) * factor), r[5], Number(r[0]) + barMs - 1
    ]);
  },
  async prices(symbols) {
    const j = await getJson('OKX', 'https://www.okx.com/api/v5/market/tickers?instType=SWAP');
    if (j?.code !== '0' || !Array.isArray(j?.data)) throw new Error(`OKX resposta inválida (code ${j?.code ?? '?'})`);
    const byInst = new Map<string, number>(j.data.map((t: any) => [String(t.instId), parseFloat(t.last)]));
    const out = new Map<string, number>();
    for (const s of symbols) {
      const { instId, factor } = toOkxInstrument(s);
      const px = byInst.get(instId);
      if (px !== undefined && Number.isFinite(px)) out.set(s, px * factor);
    }
    return out;
  }
};

const IMPL: Record<FuturesProvider, Impl> = { binance, bybit, okx };

/** Executa na primeira fonte que responde, começando pela que funcionou por último. */
async function withFallback<T>(run: (impl: Impl) => Promise<T>): Promise<T> {
  const order = [...ORDER];
  if (preferred && Date.now() < preferred.until) {
    order.splice(order.indexOf(preferred.p), 1);
    order.unshift(preferred.p);
  }
  const errors: string[] = [];
  for (const p of order) {
    try {
      const res = await run(IMPL[p]);
      lastUsed = p;
      preferred = { p, until: Date.now() + STICKY_MS };
      return res;
    } catch (e: any) {
      errors.push(e?.message || p);
      if (preferred?.p === p) preferred = null;
    }
  }
  throw new Error(`Dados de futuros indisponíveis (${errors.join('; ')})`);
}

/** Candles no formato da Binance, do mais antigo para o mais novo. */
export function futuresKlines(symbol: string, interval: string, limit: number, endTime?: number): Promise<any[][]> {
  return withFallback((impl) => impl.klines(symbol, interval, limit, endTime));
}

/** Preços dos perpétuos pedidos (símbolos no padrão Binance, ex: 1000PEPEUSDT). */
export async function futuresPrices(symbols: string[]): Promise<Map<string, number>> {
  return withFallback(async (impl) => {
    const all = await impl.prices(symbols);
    if (all.size === 0) throw new Error('nenhum preço retornado');
    return all;
  });
}

/**
 * Símbolos de perpétuos USDT listados em uma corretora específica, no padrão Binance (ex: 1000PEPEUSDT).
 * Na OKX o contrato é "PEPE"; moedas de preço muito baixo (< 0,01) aparecem com o nome com 1000 na frente,
 * que é como Binance e Bybit as listam (o preço é multiplicado por 1000 em toOkxInstrument).
 */
export async function futuresSymbolsFrom(provider: FuturesProvider): Promise<Set<string>> {
  if (provider === 'okx') {
    const j = await getJson('OKX', 'https://www.okx.com/api/v5/market/tickers?instType=SWAP');
    if (j?.code !== '0' || !Array.isArray(j?.data)) throw new Error(`OKX resposta inválida (code ${j?.code ?? '?'})`);
    const out = new Set<string>();
    for (const t of j.data) {
      const m = String(t.instId).match(/^([A-Z0-9]+)-USDT-SWAP$/);
      if (!m) continue;
      // Preço muito baixo: o nome padrão (Binance/Bybit) é o do contrato de 1000 unidades
      out.add(parseFloat(t.last) < 0.01 ? `1000${m[1]}USDT` : `${m[1]}USDT`);
    }
    return out;
  }
  const prices = await IMPL[provider].prices([]);
  return new Set([...prices.keys()].filter((s) => /^[A-Z0-9]+USDT$/.test(s)));
}

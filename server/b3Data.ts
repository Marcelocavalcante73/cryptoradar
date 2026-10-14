/**
 * Dados da B3 pelo Yahoo Finance (velas diárias, tickers com sufixo ".SA"; índice Ibovespa = ^BVSP).
 * Não é fonte oficial e pode ter atraso, mas serve para sinais e testes diários.
 */

import { CandleData } from '../src/types/crypto';

/**
 * Lista FIXA de ações líquidas da B3 (grandes empresas, inclusive algumas que foram mal nos últimos anos),
 * definida antes de ver resultados da estratégia, para não escolher só as vencedoras.
 */
export const B3_TICKERS = [
  'PETR4', 'VALE3', 'ITUB4', 'BBDC4', 'BBAS3', 'ABEV3', 'WEGE3', 'B3SA3', 'RENT3', 'SUZB3',
  'GGBR4', 'CSNA3', 'USIM5', 'JBSS3', 'ELET3', 'EQTL3', 'RADL3', 'LREN3', 'MGLU3', 'VIVT3',
  'SBSP3', 'CMIG4', 'CPLE6', 'PRIO3', 'HAPV3', 'RDOR3', 'BBSE3', 'KLBN11', 'CCRO3', 'RAIL3',
  'UGPA3', 'CSAN3', 'BRFS3', 'MRFG3', 'CYRE3', 'MRVE3', 'EMBR3', 'GOAU4', 'TIMS3', 'AZUL4'
];

export const IBOV_SYMBOL = '^BVSP';

const DAY_MS = 86400000;

export const yahooSymbol = (ticker: string) => (ticker.startsWith('^') ? ticker : `${ticker}.SA`);

/**
 * Converte a resposta do Yahoo em velas diárias. Os preços são ajustados por proventos (fechamento ajustado),
 * proporcionalmente, para o retorno refletir dividendos e desdobramentos. Dias sem negociação são descartados.
 */
export function parseYahooChart(json: any): CandleData[] {
  const r = json?.chart?.result?.[0];
  const ts: number[] | undefined = r?.timestamp;
  const q = r?.indicators?.quote?.[0];
  if (!r || !Array.isArray(ts) || !q) return [];
  const adj: (number | null)[] | undefined = r.indicators?.adjclose?.[0]?.adjclose;
  const out: CandleData[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i], v = q.volume?.[i];
    if (![o, h, l, c].every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0)) continue;
    const a = adj?.[i];
    const f = typeof a === 'number' && Number.isFinite(a) && a > 0 ? a / c : 1;
    const timestamp = Math.floor(ts[i] * 1000 / DAY_MS) * DAY_MS;
    out.push({
      time: new Date(timestamp).toISOString().slice(0, 10),
      timestamp,
      open: o * f, high: h * f, low: l * f, close: c * f,
      volume: Number.isFinite(v) ? v : 0
    });
  }
  // remove datas repetidas (o Yahoo às vezes repete o último pregão)
  return out.filter((c, i) => i === 0 || c.timestamp > out[i - 1].timestamp);
}

/** Baixa até ~`years` anos de velas diárias; o último pregão (ainda em andamento) fica de fora. */
export async function fetchB3History(ticker: string, years = 8, timeoutMs = 10000): Promise<CandleData[]> {
  const range = years > 5 ? '10y' : years > 2 ? '5y' : '2y';
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(ticker))}?range=${range}&interval=1d&events=div%2Csplit`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (CryptoRadar)' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status}`);
  const candles = parseYahooChart(await res.json());
  if (candles.length < 300) throw new Error(`histórico curto para ${ticker}`);
  candles.pop();
  return candles;
}

/** Converte a série diária do CDI do Banco Central (SGS 12, % ao dia) em mapa dia → taxa diária (fração). */
export function parseCdiSeries(json: any): Map<number, number> {
  const map = new Map<number, number>();
  if (!Array.isArray(json)) return map;
  for (const row of json) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(row?.data ?? ''));
    const v = parseFloat(String(row?.valor ?? ''));
    if (!m || !Number.isFinite(v) || v < 0) continue;
    map.set(Math.floor(Date.UTC(+m[3], +m[2] - 1, +m[1]) / DAY_MS), v / 100);
  }
  return map;
}

/** CDI diário dos últimos ~10 anos (Banco Central, gratuito e sem cadastro). */
export async function fetchCdi(timeoutMs = 10000): Promise<Map<number, number>> {
  const from = new Date(Date.now() - 3650 * DAY_MS + 5 * DAY_MS);
  const fmt = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=${fmt(from)}&dataFinal=${fmt(new Date())}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Banco Central HTTP ${res.status}`);
  const map = parseCdiSeries(await res.json());
  if (map.size < 250) throw new Error('série do CDI incompleta');
  return map;
}

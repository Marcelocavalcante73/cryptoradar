/**
 * Laboratório da B3: compara estratégias de CARTEIRA (várias ações ao mesmo tempo, com caixa rendendo CDI)
 * com as referências que importam: CDI e Ibovespa comprado e segurado.
 *
 * REGRAS FIXAS (definidas antes de ver qualquer resultado; só 4 candidatas, para não "garimpar" até dar certo):
 *  - Sinais usam só dados até o fechamento do dia; a ordem é executada na ABERTURA do dia seguinte.
 *  - Até 5 posições, de tamanho igual (1/5 do patrimônio na entrada). Caixa rende o CDI.
 *  - Custo por lado: taxa + derrapagem. Filtro de mercado: Ibovespa acima da média de 200 dias (sem ele, nada de compras).
 *  - Aprovação: ver LAB_CRITERIA. Os critérios olham a 1ª e a 2ª metade do período separadamente.
 */

import { CandleData } from '../types/crypto';
import { DEFAULT_BACKTEST_OPTIONS } from './backtest';
import { atrSeries, dayKey, donchianHigh, donchianLow } from './trendBacktest';
import { calculateAllIndicators, calculateATR } from './indicators';
import { scoreCandles, MIN_SCORE, MIN_TREND_STRENGTH_ATR, ATR_STOP_MULT, ATR_TARGET_MULT } from './signalEngine';

export const LAB_SLOTS = 5;
export const LAB_WARMUP = 210;
export const TRADING_DAYS = 252;
export const LAB_COST = DEFAULT_BACKTEST_OPTIONS.feeRate + DEFAULT_BACKTEST_OPTIONS.slippageRate;

export interface TickerData {
  c: CandleData[];            // alinhado ao calendário do Ibovespa (dias sem negociação repetem o último preço)
  traded: boolean[];          // houve negociação de fato nesse dia
  sma200: number[]; sma5: number[]; rsi2: number[]; atr20: (number | undefined)[]; ret126: number[];
  ind: CandleData[];          // velas com EMA/MACD/RSI (só a partir da 1ª negociação)
  indOffset: number;
}

export interface Pos { shares: number; entryIdx: number; entryPx: number; stop: number; target?: number }
export interface Ctx { i: number; regime: boolean; held: Map<string, Pos>; data: Map<string, TickerData> }
export interface Signals { exits: string[]; entries: string[] }
export interface LabStrategy {
  id: string; name: string; desc: string;
  signals(ctx: Ctx): Signals;
  stopFor?(t: TickerData, i: number): number;
  targetFor?(t: TickerData, i: number): number;
}

const sma = (v: number[], n: number): number[] => {
  const out = new Array(v.length).fill(NaN);
  let s = 0;
  for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= n) s -= v[i - n]; if (i >= n - 1) out[i] = s / n; }
  return out;
};

/** RSI de Wilder (período 2). */
const rsi = (v: number[], n: number): number[] => {
  const out = new Array(v.length).fill(NaN);
  if (v.length <= n) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = v[i] - v[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
};

/** Alinha as velas de um ativo ao calendário do Ibovespa e calcula os indicadores. */
export function prepareTicker(raw: CandleData[], calendar: CandleData[]): TickerData {
  const byDay = new Map<number, CandleData>();
  for (const k of raw) byDay.set(dayKey(k.timestamp), k);
  const c: CandleData[] = [];
  const traded: boolean[] = [];
  let last: CandleData | undefined;
  for (const cal of calendar) {
    const k = byDay.get(dayKey(cal.timestamp));
    if (k) { last = k; c.push(k); traded.push(true); }
    else if (last) { c.push({ ...last, timestamp: cal.timestamp, open: last.close, high: last.close, low: last.close, volume: 0 }); traded.push(false); }
    else { c.push({ ...cal, open: NaN, high: NaN, low: NaN, close: NaN, volume: 0 }); traded.push(false); }
  }
  const closes = c.map((x) => x.close);
  const ret126 = closes.map((x, i) => (i >= 126 ? x / closes[i - 126] - 1 : NaN));
  const indOffset = Math.max(0, c.findIndex((x) => Number.isFinite(x.close)));
  const ind = calculateAllIndicators(c.slice(indOffset), 10);
  return { c, traded, sma200: sma(closes, 200), sma5: sma(closes, 5), rsi2: rsi(closes, 2), atr20: atrSeries(c, 20), ret126, ind, indOffset };
}

const ok = (x: number | undefined): x is number => typeof x === 'number' && Number.isFinite(x);

export const LAB_STRATEGIES: LabStrategy[] = [
  {
    id: 'trend55', name: 'Rompimento de 55 dias',
    desc: 'Compra o fechamento acima da máxima de 55 dias; stop de 2 ATR; sai abaixo da mínima de 20 dias. Prioriza o de maior momentum.',
    stopFor: (t, i) => (ok(t.atr20[i]) ? t.c[i].close - 2 * (t.atr20[i] as number) : 0),
    signals({ i, regime, held, data }) {
      const exits: string[] = [];
      for (const [sym, p] of held) {
        const t = data.get(sym)!;
        if (t.c[i].close <= p.stop || t.c[i].close < donchianLow(t.c, i, 20)) exits.push(sym);
      }
      const entries: { s: string; m: number }[] = [];
      if (regime) for (const [sym, t] of data) {
        if (held.has(sym) || !t.traded[i] || !ok(t.atr20[i])) continue;
        if (t.c[i].close > donchianHigh(t.c, i, 55) && ok(t.ret126[i])) entries.push({ s: sym, m: t.ret126[i] });
      }
      return { exits, entries: entries.sort((a, b) => b.m - a.m).map((e) => e.s) };
    }
  },
  {
    id: 'momentum', name: 'Rotação por momentum',
    desc: 'A cada 21 pregões fica com as 5 ações de maior alta em 6 meses (só as positivas). Se o Ibovespa cair abaixo da média de 200 dias, vai para o caixa (CDI).',
    signals({ i, regime, held, data }) {
      if (!regime) return { exits: [...held.keys()], entries: [] };
      if ((i - LAB_WARMUP) % 21 !== 0) return { exits: [], entries: [] };
      const ranked = [...data.entries()]
        .filter(([, t]) => t.traded[i] && ok(t.ret126[i]) && t.ret126[i] > 0)
        .sort((a, b) => b[1].ret126[i] - a[1].ret126[i]).slice(0, LAB_SLOTS).map(([s]) => s);
      return { exits: [...held.keys()].filter((s) => !ranked.includes(s)), entries: ranked.filter((s) => !held.has(s)) };
    }
  },
  {
    id: 'pullback', name: 'Recuo em tendência de alta',
    desc: 'Em ação acima da média de 200 dias e com o Ibovespa em alta, compra quando o RSI(2) cai abaixo de 10; sai quando o fechamento passa da média de 5 dias ou após 10 pregões.',
    signals({ i, regime, held, data }) {
      const exits: string[] = [];
      for (const [sym, p] of held) {
        const t = data.get(sym)!;
        if (t.c[i].close > t.sma5[i] || i - p.entryIdx >= 10) exits.push(sym);
      }
      const entries: { s: string; r: number }[] = [];
      if (regime) for (const [sym, t] of data) {
        if (held.has(sym) || !t.traded[i] || !ok(t.sma200[i]) || !ok(t.rsi2[i])) continue;
        if (t.c[i].close > t.sma200[i] && t.rsi2[i] < 10) entries.push({ s: sym, r: t.rsi2[i] });
      }
      return { exits, entries: entries.sort((a, b) => a.r - b.r).map((e) => e.s) };
    }
  }
  ,
  {
    id: 'indicators', name: 'Confluência de indicadores',
    desc: 'O mesmo motor das criptos (médias EMA 20/50, MACD, RSI e volume; pontuação ≥ 60 só para compra), em velas diárias. Stop 1,5 ATR, alvo 3 ATR e saída após 20 pregões. Só com o Ibovespa em alta.',
    stopFor: (t, i) => { const a = atrAt(t, i); return a ? t.c[i].close - ATR_STOP_MULT * a : 0; },
    targetFor: (t, i) => { const a = atrAt(t, i); return a ? t.c[i].close + ATR_TARGET_MULT * a : Infinity; },
    signals({ i, regime, held, data }) {
      const exits: string[] = [];
      for (const [sym, p] of held) {
        const c = data.get(sym)!.c[i].close;
        if (c <= p.stop || c >= (p.target ?? Infinity) || i - p.entryIdx >= 20) exits.push(sym);
      }
      const entries: { s: string; sc: number }[] = [];
      if (regime) for (const [sym, t] of data) {
        if (held.has(sym) || !t.traded[i]) continue;
        const sc = indicatorScore(t, i);
        if (sc !== null) entries.push({ s: sym, sc });
      }
      return { exits, entries: entries.sort((a, b) => b.sc - a.sc).map((e) => e.s) };
    }
  }
];

/** Janela de velas com indicadores até o dia i (80 velas bastam para o motor de sinais). */
const indWindow = (t: TickerData, i: number): CandleData[] | null => {
  const k = i - t.indOffset;
  return k < 80 ? null : t.ind.slice(k - 79, k + 1);
};

const atrAt = (t: TickerData, i: number): number | undefined => {
  const w = indWindow(t, i);
  return w ? calculateATR(w) : undefined;
};

/** Pontuação de COMPRA do motor de indicadores (null = sem sinal), com as mesmas travas do motor das criptos. */
function indicatorScore(t: TickerData, i: number): number | null {
  const w = indWindow(t, i);
  if (!w) return null;
  const b = scoreCandles(w);
  if (!b || b.total < MIN_SCORE) return null;
  const atr = calculateATR(w);
  const last = w[w.length - 1];
  if (!atr || atr <= 0 || last.ema20 === undefined || last.ema50 === undefined) return null;
  if (Math.abs(last.ema20 - last.ema50) < atr * MIN_TREND_STRENGTH_ATR) return null;
  return b.total;
}

export interface LabTrade { symbol: string; entryIdx: number; exitIdx: number; netPct: number }
export interface Segment { cagr: number; cdi: number; ibov: number; maxDd: number }
export interface LabResult {
  id: string; name: string; desc: string;
  entries: number;
  whole: Segment; first: Segment; second: Segment;
  profitFactor: number | null; pfWithoutTop5: number | null; avgNetPct: number; winRate: number;
  equity: number[];      // patrimônio (1 = início), um ponto por pregão a partir do fim do aquecimento
  checks: { label: string; ok: boolean; detail: string }[];
  passed: boolean;
}

export const LAB_CRITERIA = [
  'Pelo menos 100 entradas',
  'Ganha do CDI por 2 pontos ao ano ou mais (período todo)',
  'Ganha do CDI na 1ª metade E na 2ª metade',
  'Queda máxima menor que a do Ibovespa comprado e segurado',
  'Sem os 5 melhores trades, o fator de lucro continua em 1,0 ou mais'
];

export interface LabOptions { cdiDaily?: (day: number) => number; cost?: number }

export function simulate(strategy: LabStrategy, data: Map<string, TickerData>, ibov: CandleData[], options: LabOptions = {}) {
  const cost = options.cost ?? LAB_COST;
  const n = ibov.length;
  const closes = ibov.map((x) => x.close);
  const ibovSma = sma(closes, 200);
  const cdi = options.cdiDaily ?? (() => Math.pow(1.1, 1 / TRADING_DAYS) - 1);

  let cash = 1;
  const held = new Map<string, Pos>();
  const trades: LabTrade[] = [];
  const equity: number[] = [];
  const cdiEq: number[] = [];
  let cdiV = 1;
  let pending: Signals = { exits: [], entries: [] };

  const px = (sym: string, i: number, f: 'open' | 'close') => data.get(sym)!.c[i][f];

  for (let i = LAB_WARMUP; i < n; i++) {
    const r = cdi(dayKey(ibov[i].timestamp));
    cash *= 1 + r; cdiV *= 1 + r;

    // 1) ordens do dia anterior, na abertura
    const stillExit: string[] = [];
    for (const sym of pending.exits) {
      const p = held.get(sym); if (!p) continue;
      if (!data.get(sym)!.traded[i]) { stillExit.push(sym); continue; }
      const sell = px(sym, i, 'open') * (1 - cost);
      cash += p.shares * sell;
      trades.push({ symbol: sym, entryIdx: p.entryIdx, exitIdx: i, netPct: (sell / p.entryPx - 1) * 100 });
      held.delete(sym);
    }
    const eqOpen = () => { let e = cash; for (const [s, p] of held) e += p.shares * px(s, i, 'open'); return e; };
    for (const sym of pending.entries) {
      if (held.size >= LAB_SLOTS || held.has(sym) || !data.get(sym)!.traded[i]) continue;
      const open = px(sym, i, 'open');
      const size = Math.min(cash, eqOpen() / LAB_SLOTS);
      if (!(size > 0.01) || !(open > 0)) continue;
      const buy = open * (1 + cost);
      const t = data.get(sym)!;
      held.set(sym, {
        shares: size / buy, entryIdx: i, entryPx: buy,
        stop: strategy.stopFor ? strategy.stopFor(t, i - 1) : 0,
        target: strategy.targetFor ? strategy.targetFor(t, i - 1) : undefined
      });
      cash -= size;
    }

    // 2) patrimônio no fechamento
    let eq = cash;
    for (const [s, p] of held) eq += p.shares * px(s, i, 'close');
    equity.push(eq); cdiEq.push(cdiV);

    // 3) sinais com dados até hoje, para amanhã
    const regime = ok(ibovSma[i]) && closes[i] > ibovSma[i];
    const sig = strategy.signals({ i, regime, held, data });
    const exits = [...new Set([...stillExit, ...sig.exits.filter((s) => held.has(s))])];
    pending = { exits, entries: sig.entries.slice(0, Math.max(0, LAB_SLOTS - (held.size - exits.length))) };
  }

  // posições abertas no fim: marca a mercado, sem custo de saída (não são trades fechados)
  const ibovEq = ibov.slice(LAB_WARMUP).map((x) => x.close / ibov[LAB_WARMUP].close);
  return { equity, cdiEq, ibovEq, trades, entries: trades.length + held.size };
}

const cagr = (eq: number[], a: number, b: number) =>
  b > a && eq[a] > 0 ? Math.pow(eq[b] / eq[a], TRADING_DAYS / (b - a)) - 1 : 0;
const maxDd = (eq: number[], a: number, b: number) => {
  let peak = -Infinity, dd = 0;
  for (let i = a; i <= b; i++) { peak = Math.max(peak, eq[i]); dd = Math.max(dd, (peak - eq[i]) / peak); }
  return dd;
};
const profitFactor = (pcts: number[]) => {
  const w = pcts.filter((x) => x > 0).reduce((s, x) => s + x, 0);
  const l = -pcts.filter((x) => x < 0).reduce((s, x) => s + x, 0);
  return l === 0 ? (w > 0 ? null : 0) : w / l;
};

export function evaluate(strategy: LabStrategy, data: Map<string, TickerData>, ibov: CandleData[], options: LabOptions = {}): LabResult {
  const s = simulate(strategy, data, ibov, options);
  const eq = s.equity;
  const last = eq.length - 1, mid = Math.floor(last / 2);
  const seg = (a: number, b: number): Segment => ({
    cagr: cagr(eq, a, b) * 100, cdi: cagr(s.cdiEq, a, b) * 100, ibov: cagr(s.ibovEq, a, b) * 100, maxDd: maxDd(eq, a, b) * 100
  });
  const whole = seg(0, last), first = seg(0, mid), second = seg(mid, last);
  const ibovDd = maxDd(s.ibovEq, 0, last) * 100;
  const pcts = s.trades.map((t) => t.netPct);
  const pf = profitFactor(pcts);
  const pf5 = profitFactor([...pcts].sort((a, b) => b - a).slice(5));
  const checks = [
    { label: LAB_CRITERIA[0], ok: s.entries >= 100, detail: String(s.entries) },
    { label: LAB_CRITERIA[1], ok: whole.cagr - whole.cdi >= 2, detail: `${whole.cagr.toFixed(1)}% vs CDI ${whole.cdi.toFixed(1)}%` },
    { label: LAB_CRITERIA[2], ok: first.cagr > first.cdi && second.cagr > second.cdi, detail: `${first.cagr.toFixed(1)}% / ${second.cagr.toFixed(1)}% (CDI ${first.cdi.toFixed(1)}% / ${second.cdi.toFixed(1)}%)` },
    { label: LAB_CRITERIA[3], ok: whole.maxDd < ibovDd, detail: `${whole.maxDd.toFixed(1)}% vs ${ibovDd.toFixed(1)}%` },
    { label: LAB_CRITERIA[4], ok: pf5 === null || pf5 >= 1, detail: pf5 === null ? '∞' : pf5.toFixed(2) }
  ];
  return {
    id: strategy.id, name: strategy.name, desc: strategy.desc, entries: s.entries, whole, first, second,
    profitFactor: pf, pfWithoutTop5: pf5, avgNetPct: pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : 0,
    winRate: pcts.length ? (pcts.filter((x) => x > 0).length / pcts.length) * 100 : 0,
    equity: eq, checks, passed: checks.every((c) => c.ok)
  };
}

/** Roda as candidatas e as referências (CDI e Ibovespa) sobre os mesmos dados. */
export function runLab(raw: Map<string, CandleData[]>, ibov: CandleData[], options: LabOptions = {}) {
  const data = new Map<string, TickerData>();
  for (const [sym, c] of raw) if (c.length > LAB_WARMUP) data.set(sym, prepareTicker(c, ibov));
  const results = LAB_STRATEGIES.map((st) => evaluate(st, data, ibov, options));
  const base = simulate(LAB_STRATEGIES[0], data, ibov, options);
  const last = base.ibovEq.length - 1, mid = Math.floor(last / 2);
  const ref = (a: number, b: number) => ({ cdi: cagr(base.cdiEq, a, b) * 100, ibov: cagr(base.ibovEq, a, b) * 100, ibovDd: maxDd(base.ibovEq, a, b) * 100 });
  return { results, tickers: data.size, days: last + 1, benchmarks: { whole: ref(0, last), first: ref(0, mid), second: ref(mid, last) } };
}

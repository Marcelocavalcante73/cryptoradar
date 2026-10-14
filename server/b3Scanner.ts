/**
 * Scanner diário da B3 (swing trade, só compras). Duas estratégias nas mesmas 40 ações da lista fixa:
 * rompimento de 55 dias (Tendência) e confluência de indicadores (Sinais), ambas só com o Ibovespa acima da média de 200 dias.
 * Roda a cada 30 minutos; os sinais só mudam depois que o pregão fecha (a partir das 21h de Brasília) e avisa no Telegram.
 */

import { CandleData } from '../src/types/crypto';
import { btcRegimeByDay, donchianHigh, DAY_MS, TREND_RULES } from '../src/services/trendBacktest';
import { detectTrendEntry, updateTrendSignal, canEnter, splitClosed, TrendSignal } from '../src/services/trendSignals';
import {
  B3Signal, MarketTrend, marketTrend, detectIndicatorEntry, updateIndicatorSignal, indicatorScoreNow, isB3Done
} from '../src/services/b3Signals';
import { B3_TICKERS, IBOV_SYMBOL, fetchB3Daily } from './b3Data';
import { sendTelegram } from './scanner';
import { getStateSafe, setStateSafe } from './stateStore';

const MAX_HISTORY = 300;
const CONCURRENCY = 3;

export interface B3WatchRow { symbol: string; close: number; high55: number; distancePct: number }
export interface B3ScoreRow { symbol: string; score: number; close: number }

export interface B3State {
  running: boolean;
  lastScanAt: number | null;
  lastError: string | null;
  market: MarketTrend | null;
  trend: { signals: TrendSignal[]; watch: B3WatchRow[] };
  indicators: { signals: B3Signal[]; scores: B3ScoreRow[] };
  tickers: string[];
}

const state: B3State = {
  running: false, lastScanAt: null, lastError: null, market: null,
  trend: { signals: [], watch: [] }, indicators: { signals: [], scores: [] }, tickers: B3_TICKERS
};

const brl = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatB3Alert(kind: 'trend-entry' | 'ind-entry' | 'exit', s: TrendSignal | B3Signal): string {
  const sym = s.symbol;
  const entry = s.entryPrice ?? s.refPrice;
  if (kind === 'trend-entry') {
    const t = s as TrendSignal;
    return [
      `📈 *[B3 · TENDÊNCIA] COMPRAR* ${sym} (swing, diário)`,
      'Rompeu a máxima de 55 dias, com o Ibovespa acima da média de 200 dias.',
      `Entrada: R$ ${brl(entry)} (abertura do próximo pregão)`,
      `Stop: R$ ${brl(t.stopPrice)}  (risco ${(((entry - t.stopPrice) / entry) * 100).toFixed(1)}%)`,
      `Saída pela tendência: fechar abaixo de R$ ${brl(t.exitLevel)}`,
      '',
      '_Sem alvo fixo. Em validação: só simulação. Não é recomendação de investimento._'
    ].join('\n');
  }
  if (kind === 'ind-entry') {
    const b = s as B3Signal;
    return [
      `📈 *[B3 · INDICADORES] COMPRAR* ${sym} (swing, diário)`,
      `Pontuação ${b.score}/100, com o Ibovespa acima da média de 200 dias.`,
      `Entrada: R$ ${brl(entry)} (abertura do próximo pregão)`,
      `Stop: R$ ${brl(b.stopPrice)}  ·  Alvo: R$ ${brl(b.targetPrice)}`,
      `Prazo máximo: 20 pregões.`,
      '',
      '_Em validação: só simulação. Não é recomendação de investimento._'
    ].join('\n');
  }
  const status = (s as any).status as string;
  const why = status === 'STOP' || status === 'STOPPED' ? 'stop atingido' : status === 'TARGET' ? 'alvo atingido'
    : status === 'TIMEOUT' || (status === 'EXIT_SIGNAL' && 'score' in s) ? 'prazo de 20 pregões' : 'fechou abaixo da mínima de 20 dias';
  return [`🔔 *[B3] SAIR* ${sym}`, `Motivo: ${why}.`, status === 'EXIT_SIGNAL' ? 'Saia na abertura do próximo pregão.' : `Saída em R$ ${brl(s.exitPrice ?? s.lastPrice ?? 0)}.`, '', '_Não é recomendação de investimento._'].join('\n');
}

export async function loadB3State() {
  if (process.env.B3_PERSIST === 'off') return;
  const snap = await getStateSafe('b3-scan');
  const v = snap?.value;
  if (v && v.trend && v.indicators) {
    state.market = v.market ?? null;
    state.trend = { signals: v.trend.signals ?? [], watch: v.trend.watch ?? [] };
    state.indicators = { signals: v.indicators.signals ?? [], scores: v.indicators.scores ?? [] };
    state.lastScanAt = v.lastScanAt ?? null;
    state.lastError = v.lastError ?? null;
  }
}

function save() {
  if (process.env.B3_PERSIST === 'off') return;
  const { running: _r, ...snapshot } = state;
  void setStateSafe('b3-scan', snapshot);
}

export function resetB3State() {
  state.trend = { signals: [], watch: [] }; state.indicators = { signals: [], scores: [] };
  state.market = null; state.lastScanAt = null; state.lastError = null; state.running = false;
}

export const getB3State = (): B3State => state;

let current: Promise<void> | null = null;

export function runB3Scan(): Promise<void> {
  if (current) return current;
  current = doScan().finally(() => { current = null; });
  return current;
}

export async function ensureB3Scan(maxAgeMs = 30 * 60e3, waitMs = 0): Promise<void> {
  if (process.env.SCANNER_ENABLED === 'false' || process.env.B3_ENABLED === 'false') return;
  if (!current && (state.lastScanAt === null || Date.now() - state.lastScanAt > maxAgeMs)) void runB3Scan();
  if (waitMs > 0 && current) await Promise.race([current, new Promise<void>((r) => setTimeout(r, waitMs))]);
}

async function doScan(): Promise<void> {
  state.running = true;
  try {
    const now = Date.now();
    const ibovAll = await fetchB3Daily(IBOV_SYMBOL);
    const { closed: ibovClosed } = splitClosed(ibovAll, now);
    const mt = marketTrend(ibovClosed);
    if (!mt) throw new Error('histórico do Ibovespa insuficiente');
    state.market = mt;
    const bullish = mt.bullish;
    void btcRegimeByDay; // o filtro é o mesmo (fechamento acima da média de 200 dias), calculado em marketTrend

    const alerts: string[] = [];
    const watch: B3WatchRow[] = [];
    const scores: B3ScoreRow[] = [];
    const data = new Map<string, CandleData[]>();
    let failed = 0, i = 0;
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      while (i < B3_TICKERS.length) {
        const t = B3_TICKERS[i++];
        try { data.set(t, await fetchB3Daily(t)); } catch { failed++; }
      }
    }));

    for (const symbol of B3_TICKERS) {
      const all = data.get(symbol);
      if (!all) continue;
      const { closed } = splitClosed(all, now);
      if (closed.length < TREND_RULES.entryLookback + 2) continue;

      // Tendência (rompimento de 55 dias)
      const tsig = state.trend.signals;
      for (let k = 0; k < tsig.length; k++) {
        const s = tsig[k];
        if (s.symbol !== symbol || s.status === 'STOPPED' || s.status === 'CLOSED') continue;
        const before = s.status;
        const upd = updateTrendSignal(s, all, now);
        if (upd.status !== before && upd.status !== 'OPEN' && !upd.alertedExit) { alerts.push(formatB3Alert('exit', upd)); upd.alertedExit = true; }
        if (upd.status === 'CLOSED') upd.alertedExit = true;
        tsig[k] = upd;
      }
      const tnew = detectTrendEntry(closed, bullish, symbol, symbol, now);
      if (tnew && !tsig.some((s) => s.id === tnew.id) && canEnter(tsig, symbol, tnew.signalDay)) {
        const withEntry = updateTrendSignal(tnew, all, now);
        withEntry.alertedEntry = true;
        alerts.push(formatB3Alert('trend-entry', withEntry));
        tsig.unshift(withEntry);
      }
      const high55 = donchianHigh(closed, closed.length - 1); // máxima dos 55 pregões ANTES do último: o nível a romper
      const close = closed[closed.length - 1].close;
      watch.push({ symbol, close, high55, distancePct: ((high55 - close) / close) * 100 });

      // Indicadores
      const isig = state.indicators.signals;
      for (let k = 0; k < isig.length; k++) {
        const s = isig[k];
        if (s.symbol !== symbol || isB3Done(s)) continue;
        const before = s.status;
        const upd = updateIndicatorSignal(s, all, now);
        if (upd.status !== before && upd.status !== 'OPEN' && !upd.alertedExit) { alerts.push(formatB3Alert('exit', upd)); upd.alertedExit = true; }
        isig[k] = upd;
      }
      const inew = detectIndicatorEntry(closed, bullish, symbol, now);
      const hasOpen = isig.some((s) => s.symbol === symbol && !isB3Done(s));
      if (inew && !isig.some((s) => s.id === inew.id) && !hasOpen) {
        const withEntry = updateIndicatorSignal(inew, all, now);
        alerts.push(formatB3Alert('ind-entry', withEntry));
        isig.unshift(withEntry);
      }
      const sc = indicatorScoreNow(closed);
      if (sc !== null) scores.push({ symbol, score: sc, close });
    }

    state.trend.watch = watch.sort((a, b) => a.distancePct - b.distancePct);
    state.trend.signals = state.trend.signals.slice(0, MAX_HISTORY);
    state.indicators.signals = state.indicators.signals.slice(0, MAX_HISTORY);
    state.indicators.scores = scores.sort((a, b) => b.score - a.score);
    state.lastError = failed === B3_TICKERS.length ? 'Nenhuma ação pôde ser consultada (Yahoo Finance indisponível?)' : null;
    save();
    for (const text of alerts) await sendTelegram(text);
  } catch (e: any) {
    state.lastError = e?.message || 'Erro desconhecido no scanner da B3';
  } finally {
    state.lastScanAt = Date.now();
    state.running = false;
  }
}

export function startB3Scanner(intervalMinutes = 30) {
  if (process.env.B3_ENABLED === 'false') return;
  setTimeout(() => { void ensureB3Scan(intervalMinutes * 60e3); setInterval(runB3Scan, intervalMinutes * 60e3); }, 50000);
}

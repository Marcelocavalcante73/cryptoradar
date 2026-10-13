/**
 * Scanner diário da estratégia de rompimento de 55 dias (spot, só compras) nas "Grandes de 2022" (lista fixa validada no backtest).
 * Roda a cada 30 minutos: as velas diárias só mudam à 00:00 UTC (21:00 em Brasília), mas assim o preço e o stop ficam atualizados
 * e um reinício do servidor se recupera rápido. Avisa no Telegram em cada entrada nova e em cada saída.
 */

import fs from 'fs';
import path from 'path';
import { CandleData } from '../src/types/crypto';
import { parseBinanceKline } from '../src/services/apiService';
import { btcRegimeByDay, donchianHigh, DAY_MS, TREND_RULES } from '../src/services/trendBacktest';
import { detectTrendEntry, updateTrendSignal, canEnter, splitClosed, TrendSignal } from '../src/services/trendSignals';
import { binanceGet } from './universe';
import { CLASSIC_2022 } from './backtestJob';
import { sendTelegram } from './scanner';

const DATA_FILE = path.resolve(process.cwd(), 'data', 'trend-signals.json');
const MAX_HISTORY = 300;

export interface TrendWatchRow {
  symbol: string;
  baseAsset: string;
  close: number;
  high55: number;
  distancePct: number; // quanto falta subir para romper a máxima de 55 dias (<= 0: já acima)
}

export interface TrendState {
  running: boolean;
  lastScanAt: number | null;
  lastError: string | null;
  regime: { bullish: boolean; btcClose: number; sma200: number } | null;
  watch: TrendWatchRow[];
  signals: TrendSignal[];
  coins: string[];
}

const state: TrendState = {
  running: false, lastScanAt: null, lastError: null, regime: null, watch: [], signals: [], coins: CLASSIC_2022
};

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 2 : 6 });

export function formatTrendAlert(s: TrendSignal, kind: 'entry' | 'exit'): string {
  if (kind === 'entry') {
    const entry = s.entryPrice ?? s.refPrice;
    const riskPct = ((entry - s.stopPrice) / entry) * 100;
    return [
      `📈 *[TENDÊNCIA] COMPRAR* ${s.symbol} (diário)`,
      `Rompeu a máxima de 55 dias, com o Bitcoin acima da média de 200 dias.`,
      `Entrada: ${fmt(entry)} (abertura do dia)`,
      `Stop: ${fmt(s.stopPrice)}  (risco ${riskPct.toFixed(1)}%)`,
      `Saída pela tendência: fechar abaixo de ${fmt(s.exitLevel)}`,
      '',
      '_Sem alvo fixo: deixe o ganho correr e saia pelo stop ou pela tendência. Não é recomendação de investimento._'
    ].join('\n');
  }
  const why = s.status === 'STOPPED' ? 'stop atingido' : 'fechou abaixo da mínima de 20 dias';
  return [
    `🔔 *[TENDÊNCIA] SAIR* ${s.symbol}`,
    `Motivo: ${why}.`,
    s.status === 'EXIT_SIGNAL' ? 'Saia na abertura de hoje (novo dia).' : `Saída em ${fmt(s.exitPrice ?? s.lastPrice ?? 0)}.`,
    '',
    '_Não é recomendação de investimento._'
  ].join('\n');
}

function load() {
  if (process.env.TREND_PERSIST === 'off') return;
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (Array.isArray(parsed)) state.signals = parsed;
  } catch { /* primeira execução */ }
}

function save() {
  if (process.env.TREND_PERSIST === 'off') return;
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(state.signals));
  } catch (e) {
    console.warn('Não foi possível salvar sinais de tendência:', e);
  }
}

async function fetchDaily(symbol: string, limit: number): Promise<CandleData[]> {
  const raw = await binanceGet(`/api/v3/klines?symbol=${symbol}&interval=1d&limit=${limit}`, 8000, 'spot');
  const out: CandleData[] = [];
  for (const k of raw as any[]) {
    const c = parseBinanceKline(k, '1D', 10);
    if (c) out.push(c);
  }
  return out;
}

/** Só para testes: volta ao estado inicial. */
export function resetTrendState() {
  state.signals = []; state.watch = []; state.regime = null; state.lastScanAt = null; state.lastError = null; state.running = false;
}

export function getTrendState(): TrendState {
  return state;
}

export async function runTrendScan(): Promise<void> {
  if (state.running) return;
  state.running = true;
  try {
    const now = Date.now();
    const btcAll = await fetchDaily('BTCUSDT', 400);
    const { closed: btcClosed } = splitClosed(btcAll, now);
    const regimeMap = btcRegimeByDay(btcClosed);
    const lastBtc = btcClosed[btcClosed.length - 1];
    const bullish = regimeMap.get(Math.floor(lastBtc.timestamp / DAY_MS)) === true;
    const sma200 = btcClosed.slice(-TREND_RULES.btcSmaPeriod).reduce((a, c) => a + c.close, 0) / Math.min(TREND_RULES.btcSmaPeriod, btcClosed.length);
    state.regime = { bullish, btcClose: lastBtc.close, sma200 };

    const watch: TrendWatchRow[] = [];
    const alerts: string[] = [];
    let failed = 0;

    for (const base of CLASSIC_2022) {
      const symbol = `${base}USDT`;
      try {
        const all = base === 'BTC' ? btcAll : await fetchDaily(symbol, 300);
        const { closed } = splitClosed(all, now);
        if (closed.length < TREND_RULES.entryLookback + 2) continue;

        // 1) atualiza o sinal aberto desta moeda
        for (let k = 0; k < state.signals.length; k++) {
          const s = state.signals[k];
          if (s.symbol !== symbol || s.status === 'STOPPED' || s.status === 'CLOSED') continue;
          const before = s.status;
          const upd = updateTrendSignal(s, all, now);
          if (upd.status !== before && upd.status !== 'OPEN' && !upd.alertedExit) {
            alerts.push(formatTrendAlert(upd, 'exit'));
            upd.alertedExit = true;
          }
          if (upd.status === 'CLOSED' && !upd.alertedExit) upd.alertedExit = true;
          state.signals[k] = upd;
        }

        // 2) procura rompimento novo na última vela fechada (uma posição por moeda)
        const sig = detectTrendEntry(closed, bullish, symbol, base, now);
        if (sig && !state.signals.some((s) => s.id === sig.id) && canEnter(state.signals, symbol, sig.signalDay)) {
          const withEntry = updateTrendSignal(sig, all, now); // preenche a abertura do dia atual, se já existir
          withEntry.alertedEntry = true;
          alerts.push(formatTrendAlert(withEntry, 'entry'));
          state.signals.unshift(withEntry);
        }

        const i = closed.length;
        const high55 = donchianHigh(closed, i);
        const close = closed[i - 1].close;
        watch.push({ symbol, baseAsset: base, close, high55, distancePct: ((high55 - close) / close) * 100 });
      } catch {
        failed++;
      }
    }

    state.watch = watch.sort((a, b) => a.distancePct - b.distancePct);
    state.signals = state.signals.slice(0, MAX_HISTORY);
    state.lastError = failed === CLASSIC_2022.length ? 'Nenhuma moeda pôde ser consultada (Binance indisponível?)' : null;
    save();
    for (const text of alerts) await sendTelegram(text);
  } catch (e: any) {
    state.lastError = e?.message || 'Erro desconhecido no scanner de tendência';
  } finally {
    state.lastScanAt = Date.now();
    state.running = false;
  }
}

/** Inicia o scanner diário. Desligue com TREND_ENABLED=false. */
export function startTrendScanner(intervalMinutes = 30) {
  if (process.env.TREND_ENABLED === 'false') return;
  load();
  setTimeout(() => { runTrendScan(); setInterval(runTrendScan, intervalMinutes * 60e3); }, 40000); // depois dos outros scanners
}

/**
 * Scanner periódico: varre o universo (top 100), gera sinais nos timeframes configurados,
 * acompanha o resultado dos sinais abertos e dispara alertas no Telegram.
 */

import fs from 'fs';
import path from 'path';
import { CandleData } from '../src/types/crypto';
import { calculateAllIndicators } from '../src/services/indicators';
import { evaluateSignal, EngineSignal } from '../src/services/signalEngine';
import { parseBinanceKline } from '../src/services/apiService';
import { binanceGet, buildUniverse, Universe } from './universe';

const TIMEFRAMES = ['1h', '4h'] as const;
const EXPIRE_AFTER_MS: Record<string, number> = { '1h': 48 * 3600e3, '4h': 8 * 24 * 3600e3 };
const MAX_HISTORY = 500;
const MAX_ALERTS_PER_SCAN = 10;
const CONCURRENCY = 8;
const DATA_FILE = path.resolve(process.cwd(), 'data', 'signals.json');

export const MARKET_MODE: 'spot' | 'futures' = process.env.MARKET_MODE === 'futures' ? 'futures' : 'spot';

export interface StoredSignal extends EngineSignal {
  spotExit?: boolean; // spot: VENDA = sair de posição que você já possui (não é operação a descoberto)
  createdAt: number;
  closedAt?: number;
  closePrice?: number;
  alerted?: boolean;
}

export interface ScanState {
  running: boolean;
  lastScanAt: number | null;
  lastScanDurationMs: number | null;
  marketMode: 'spot' | 'futures';
  lastError: string | null;
  scannedPairs: number;
  failedPairs: number;
  universe: Pick<Universe, 'source' | 'fetchedAt' | 'skipped' | 'exchanges'> & {
    count: number;
    coins: { rank: number; baseAsset: string; name: string; symbol: string }[];
  } | null;
  signals: StoredSignal[];
}

const state: ScanState = {
  running: false,
  lastScanAt: null,
  lastScanDurationMs: null,
  marketMode: MARKET_MODE,
  lastError: null,
  scannedPairs: 0,
  failedPairs: 0,
  universe: null,
  signals: []
};

let universe: Universe | null = null;
const UNIVERSE_TTL_MS = 6 * 3600e3;

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (Array.isArray(parsed)) state.signals = parsed;
  } catch { /* primeira execução */ }
}

function save() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(state.signals));
  } catch (e) {
    console.warn('Não foi possível salvar histórico de sinais:', e);
  }
}

export function getScanState(): ScanState {
  return state;
}

async function fetchClosedCandles(symbol: string, tf: string, price: number): Promise<CandleData[]> {
  const raw = await binanceGet(`/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=250`);
  const decimals = price < 10 ? 4 : 2;
  const parsed: CandleData[] = [];
  for (const k of raw as any[]) {
    const c = parseBinanceKline(k, tf as any, decimals);
    if (c) parsed.push(c);
  }
  parsed.pop(); // descarta a vela ainda aberta: sinal só com candle fechado
  return calculateAllIndicators(parsed, decimals);
}

async function pool<T>(items: T[], worker: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (i < items.length) await worker(items[i++]);
    })
  );
}

function updateOutcomes(prices: Map<string, number>) {
  const now = Date.now();
  for (const s of state.signals) {
    if (s.status !== 'OPEN') continue;
    const p = prices.get(s.symbol);
    const hit = (cond: boolean, status: 'TARGET_HIT' | 'STOP_HIT' | 'EXPIRED', px?: number) => {
      if (cond) { s.status = status; s.closedAt = now; s.closePrice = px; }
    };
    if (p !== undefined) {
      const long = s.direction === 'LONG';
      hit(long ? p >= s.targetPrice : p <= s.targetPrice, 'TARGET_HIT', p);
      if (s.status === 'OPEN') hit(long ? p <= s.stopLossPrice : p >= s.stopLossPrice, 'STOP_HIT', p);
    }
    if (s.status === 'OPEN') hit(now - s.createdAt > (EXPIRE_AFTER_MS[s.timeframe] ?? 48 * 3600e3), 'EXPIRED', p);
  }
}

export function formatTelegramAlert(s: EngineSignal, mode: 'spot' | 'futures' = MARKET_MODE): string {
  const buy = s.direction === 'LONG';
  const spotExit = mode === 'spot' && !buy;
  const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 8 });
  return [
    `${buy ? '🟢 *COMPRA*' : spotExit ? '🔴 *VENDA — sair da posição*' : '🔴 *VENDA (short)*'} ${s.symbol} (${s.timeframe})`,
    `Pontuação: ${s.score > 0 ? '+' : ''}${s.score}/100 — ${s.strategyName}`,
    spotExit ? `Preço de referência: ${fmt(s.entryPrice)}` : `Entrada: ${fmt(s.entryPrice)}`,
    ...(spotExit
      ? ['Spot: use só se você já possui a moeda. Não é operação a descoberto.']
      : [`Alvo: ${fmt(s.targetPrice)}`, `Stop: ${fmt(s.stopLossPrice)}  (R:R ${s.riskRewardRatio})`]),
    '',
    '_Sinal técnico automático, não é recomendação de investimento._'
  ].join('\n');
}

async function sendTelegram(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || token.length < 10 || !chatId) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
      signal: AbortSignal.timeout(6000)
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function runScan(): Promise<void> {
  if (state.running) return;
  state.running = true;
  const started = Date.now();
  try {
    if (!universe || Date.now() - universe.fetchedAt > UNIVERSE_TTL_MS) {
      universe = await buildUniverse();
    }
    state.universe = {
      source: universe.source,
      fetchedAt: universe.fetchedAt,
      skipped: universe.skipped,
      exchanges: universe.exchanges,
      coins: universe.coins.map(({ rank, baseAsset, name, symbol }) => ({ rank, baseAsset, name, symbol })),
      count: universe.coins.length
    };

    const priceList: any[] = await binanceGet('/api/v3/ticker/price');
    const prices = new Map<string, number>(priceList.map((p) => [p.symbol, parseFloat(p.price)]));

    const jobs = universe.coins.flatMap((coin) => TIMEFRAMES.map((tf) => ({ coin, tf })));
    const fresh: StoredSignal[] = [];
    let failed = 0;

    await pool(jobs, async ({ coin, tf }) => {
      try {
        const candles = await fetchClosedCandles(coin.symbol, tf, prices.get(coin.symbol) ?? 1);
        const sig = evaluateSignal(candles, { symbol: coin.symbol, baseAsset: coin.baseAsset, timeframe: tf });
        if (sig && !state.signals.some((s) => s.id === sig.id)) {
          fresh.push({ ...sig, createdAt: Date.now(), spotExit: MARKET_MODE === 'spot' && sig.direction === 'SHORT' });
        }
      } catch {
        failed++;
      }
    });

    updateOutcomes(prices);

    fresh.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
    for (const s of fresh.slice(0, MAX_ALERTS_PER_SCAN)) {
      s.alerted = await sendTelegram(formatTelegramAlert(s));
    }
    state.signals = [...fresh, ...state.signals].slice(0, MAX_HISTORY);

    state.scannedPairs = jobs.length - failed;
    state.failedPairs = failed;
    state.lastError = failed === jobs.length ? 'Nenhum par pôde ser analisado (Binance indisponível?)' : null;
    save();
  } catch (e: any) {
    state.lastError = e?.message || 'Erro desconhecido no scanner';
  } finally {
    state.lastScanAt = Date.now();
    state.lastScanDurationMs = Date.now() - started;
    state.running = false;
  }
}

export function startScanner(intervalMinutes = 5) {
  load();
  runScan();
  setInterval(runScan, Math.max(1, intervalMinutes) * 60e3);
}

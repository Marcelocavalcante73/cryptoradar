/**
 * Scanner periódico, um por mercado (spot e futuros): varre o universo (top 100 ∩ corretoras),
 * gera sinais nos timeframes configurados, acompanha o resultado dos sinais abertos e dispara alertas no Telegram.
 */

import fs from 'fs';
import path from 'path';
import { CandleData, MarketType } from '../src/types/crypto';
import { calculateAllIndicators } from '../src/services/indicators';
import { evaluateSignal, EngineSignal } from '../src/services/signalEngine';
import { maxSafeLeverage } from '../src/services/futures';
import { parseBinanceKline, priceDecimals } from '../src/services/apiService';
import { binanceGet, buildUniverse, Universe } from './universe';
import { futuresKlines, futuresPrices, getFuturesProvider } from './futuresData';

const TIMEFRAMES = ['1h', '4h'] as const;
const EXPIRE_AFTER_MS: Record<string, number> = { '1h': 48 * 3600e3, '4h': 8 * 24 * 3600e3 };
const MAX_HISTORY = 500;
const MAX_ALERTS_PER_SCAN = 10;
const CONCURRENCY = 8;
const UNIVERSE_TTL_MS = 6 * 3600e3;

export interface StoredSignal extends EngineSignal {
  spotExit?: boolean; // spot: VENDA = sair de posição que você já possui (não é operação a descoberto)
  createdAt: number;
  closedAt?: number;
  closePrice?: number;
  alerted?: boolean;
}

export interface ScanState {
  market: MarketType;
  running: boolean;
  lastScanAt: number | null;
  lastScanDurationMs: number | null;
  lastError: string | null;
  scannedPairs: number;
  failedPairs: number;
  dataSource?: string; // futuros: de qual corretora vieram os dados (binance, bybit, okx)
  universe: Pick<Universe, 'source' | 'fetchedAt' | 'skipped' | 'exchanges' | 'unverified'> & {
    count: number;
    coins: { rank: number; baseAsset: string; name: string; symbol: string }[];
  } | null;
  signals: StoredSignal[];
}

export function formatTelegramAlert(s: EngineSignal, market: MarketType = 'spot'): string {
  const buy = s.direction === 'LONG';
  const spotExit = market === 'spot' && !buy;
  const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 8 });
  const tag = market === 'futures' ? '[FUTUROS]' : '[SPOT]';
  const title = buy
    ? market === 'futures' ? '🟢 *COMPRAR (long)*' : '🟢 *COMPRA*'
    : spotExit ? '🔴 *VENDA — sair da posição*' : '🔴 *VENDER (short)*';
  return [
    `${tag} ${title} ${s.symbol} (${s.timeframe})`,
    `Pontuação: ${s.score > 0 ? '+' : ''}${s.score}/100 — ${s.strategyName}`,
    spotExit ? `Preço de referência: ${fmt(s.entryPrice)}` : `Entrada: ${fmt(s.entryPrice)}`,
    ...(spotExit
      ? ['Spot: use só se você já possui a moeda. Não é operação a descoberto.']
      : [
          `Alvo: ${fmt(s.targetPrice)}`,
          `Stop: ${fmt(s.stopLossPrice)}  (R:R ${s.riskRewardRatio})`,
          ...(market === 'futures'
            ? [`Alavancagem máx. segura: ${maxSafeLeverage(s.entryPrice, s.stopLossPrice)}x (use menos; sempre com stop)`]
            : [])
        ]),
    '',
    '_Sinal técnico automático, não é recomendação de investimento._'
  ].join('\n');
}

export async function sendTelegram(text: string): Promise<boolean> {
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

async function pool<T>(items: T[], worker: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (i < items.length) await worker(items[i++]);
    })
  );
}

function updateOutcomes(signals: StoredSignal[], prices: Map<string, number>) {
  const now = Date.now();
  for (const s of signals) {
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

export function createScanner(market: MarketType) {
  // O histórico do spot mantém o nome antigo para não perder sinais já gravados
  const dataFile = path.resolve(process.cwd(), 'data', market === 'spot' ? 'signals.json' : `signals-${market}.json`);
  const klinesPath = market === 'futures' ? '/fapi/v1/klines' : '/api/v3/klines';
  const pricePath = market === 'futures' ? '/fapi/v1/ticker/price' : '/api/v3/ticker/price';

  const state: ScanState = {
    market,
    running: false,
    lastScanAt: null,
    lastScanDurationMs: null,
    lastError: null,
    scannedPairs: 0,
    failedPairs: 0,
    universe: null,
    signals: []
  };
  let universe: Universe | null = null;

  const load = () => {
    try {
      const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      if (Array.isArray(parsed)) state.signals = parsed;
    } catch { /* primeira execução */ }
  };

  const save = () => {
    try {
      fs.mkdirSync(path.dirname(dataFile), { recursive: true });
      fs.writeFileSync(dataFile, JSON.stringify(state.signals));
    } catch (e) {
      console.warn(`Não foi possível salvar histórico de sinais (${market}):`, e);
    }
  };

  async function fetchClosedCandles(symbol: string, tf: string, price: number): Promise<CandleData[]> {
    const raw = market === 'futures'
      ? await futuresKlines(symbol, tf, 250)
      : await binanceGet(`${klinesPath}?symbol=${symbol}&interval=${tf}&limit=250`, 8000, market);
    const decimals = priceDecimals(price);
    const parsed: CandleData[] = [];
    for (const k of raw as any[]) {
      const c = parseBinanceKline(k, tf as any, decimals);
      if (c) parsed.push(c);
    }
    parsed.pop(); // descarta a vela ainda aberta: sinal só com candle fechado
    return calculateAllIndicators(parsed, decimals);
  }

  async function run(): Promise<void> {
    if (state.running) return;
    state.running = true;
    const started = Date.now();
    try {
      if (!universe || Date.now() - universe.fetchedAt > UNIVERSE_TTL_MS) {
        universe = await buildUniverse(market);
      }
      state.universe = {
        source: universe.source,
        fetchedAt: universe.fetchedAt,
        skipped: universe.skipped,
        exchanges: universe.exchanges,
        unverified: universe.unverified,
        coins: universe.coins.map(({ rank, baseAsset, name, symbol }) => ({ rank, baseAsset, name, symbol })),
        count: universe.coins.length
      };

      const prices = market === 'futures'
        ? await futuresPrices(universe.coins.map((c) => c.symbol))
        : new Map<string, number>(((await binanceGet(pricePath, 8000, market)) as any[]).map((p) => [p.symbol, parseFloat(p.price)]));

      const jobs = universe.coins.flatMap((coin) => TIMEFRAMES.map((tf) => ({ coin, tf })));
      const fresh: StoredSignal[] = [];
      let failed = 0;

      await pool(jobs, async ({ coin, tf }) => {
        try {
          const candles = await fetchClosedCandles(coin.symbol, tf, prices.get(coin.symbol) ?? 1);
          const sig = evaluateSignal(candles, { symbol: coin.symbol, baseAsset: coin.baseAsset, timeframe: tf });
          if (sig && !state.signals.some((s) => s.id === sig.id)) {
            fresh.push({
              ...sig,
              market,
              createdAt: Date.now(),
              spotExit: market === 'spot' && sig.direction === 'SHORT'
            });
          }
        } catch {
          failed++;
        }
      });

      updateOutcomes(state.signals, prices);

      fresh.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
      for (const s of fresh.slice(0, MAX_ALERTS_PER_SCAN)) {
        s.alerted = await sendTelegram(formatTelegramAlert(s, market));
      }
      state.signals = [...fresh, ...state.signals].slice(0, MAX_HISTORY);

      state.scannedPairs = jobs.length - failed;
      state.failedPairs = failed;
      state.lastError = failed === jobs.length ? 'Nenhum par pôde ser analisado (corretora indisponível?)' : null;
      if (market === 'futures') state.dataSource = getFuturesProvider() ?? undefined;
      save();
    } catch (e: any) {
      state.lastError = e?.message || 'Erro desconhecido no scanner';
    } finally {
      state.lastScanAt = Date.now();
      state.lastScanDurationMs = Date.now() - started;
      state.running = false;
    }
  }

  return { market, state, load, run };
}

export const scanners = {
  spot: createScanner('spot'),
  futures: createScanner('futures')
};

export function parseMarket(v: unknown): MarketType {
  return v === 'futures' ? 'futures' : 'spot';
}

export function getScanState(market: MarketType = 'spot'): ScanState {
  return scanners[market].state;
}

export function runScan(market: MarketType = 'spot'): Promise<void> {
  return scanners[market].run();
}

/** Inicia os scanners. Futuros pode ser desligado com FUTURES_ENABLED=false. */
export function startScanner(intervalMinutes = 5) {
  const every = Math.max(1, intervalMinutes) * 60e3;
  const active: MarketType[] = process.env.FUTURES_ENABLED === 'false' ? ['spot'] : ['spot', 'futures'];
  active.forEach((m, i) => {
    scanners[m].load();
    // Escalona o início para os dois scanners não dispararem as mesmas requisições ao mesmo tempo
    setTimeout(() => {
      scanners[m].run();
      setInterval(() => scanners[m].run(), every);
    }, i * 20000);
  });
}

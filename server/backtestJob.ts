/**
 * Backtest em lote (várias moedas) rodando em segundo plano no servidor.
 * Um trabalho por vez; o app consulta o andamento e o resultado por /api/backtest/batch.
 */

import { MarketType } from '../src/types/crypto';
import { runBacktest } from '../src/services/backtest';
import { runTrendBacktest } from '../src/services/trendBacktest';
import { summarizeBatch, BatchSummary } from '../src/services/backtestBatch';
import { buildUniverse } from './universe';
import { fetchHistory } from './history';
import { B3_TICKERS, IBOV_SYMBOL, fetchB3History } from './b3Data';

/**
 * Lista FIXA das grandes moedas de 2022, definida antes de ver resultados da estratégia de tendência.
 * Reduz o viés de sobrevivência do universo atual (top 100 de hoje): inclui moedas que ficaram para trás.
 */
export const CLASSIC_2022 = ['BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'DOGE', 'SOL', 'TRX', 'DOT', 'LTC', 'AVAX', 'LINK', 'ATOM', 'XLM', 'ETC', 'BCH', 'UNI'];

export interface BatchParams {
  list?: 'top' | 'classic2022' | 'b3';
  strategy: 'signals' | 'trend'; // signals: confluência de indicadores; trend: rompimento de 55 dias (diário, só spot)
  market: MarketType;
  tf: '1h' | '4h' | '1d';
  top: number;
  bars: number;
}

export interface BatchJob {
  id: number;
  params: BatchParams;
  status: 'running' | 'done' | 'error';
  done: number;
  total: number;
  startedAt: number;
  finishedAt?: number;
  failedSymbols: string[];
  error?: string;
  summary?: BatchSummary;
}

let current: BatchJob | null = null;
let counter = 0;
const CONCURRENCY = 3;
const FUNDING_PER_8H = 0.0001; // futuros: 0,01% por 8h, cobrado nos dois lados (conservador)

export function getBatchJob(): BatchJob | null {
  return current;
}

export function startBatchJob(requested: BatchParams): BatchJob {
  if (current && current.status === 'running') return current;
  // A estratégia de tendência é sempre diária e só spot (compras), qualquer que seja o pedido
  const base: BatchParams = requested.strategy === 'trend' ? { ...requested, market: 'spot', tf: '1d' } : requested;
  // B3 só existe com a estratégia de tendência; a lista fixa de 2022 existe só para spot
  const b3 = requested.list === 'b3';
  const params: BatchParams = b3
    ? { ...base, list: 'b3', strategy: 'trend', market: 'spot', tf: '1d' }
    : base.list === 'classic2022' ? { ...base, market: 'spot' } : base;

  const job: BatchJob = {
    id: ++counter, params, status: 'running', done: 0, total: 0, startedAt: Date.now(), failedSymbols: []
  };
  current = job;

  (async () => {
    try {
      const coins = params.list === 'b3'
        ? B3_TICKERS.map((t, i) => ({ rank: i + 1, baseAsset: t, name: t, symbol: t, marketCap: 0 }))
        : params.list === 'classic2022'
        ? CLASSIC_2022.map((b, i) => ({ rank: i + 1, baseAsset: b, name: b, symbol: `${b}USDT`, marketCap: 0 }))
        : (await buildUniverse(params.market)).coins.slice(0, params.top);
      const trend = params.strategy === 'trend';
      // Filtro de mercado da estratégia de tendência: histórico diário do Bitcoin
      // Na B3 o filtro de mercado é o Ibovespa acima da média de 200 dias
      const btc = params.list === 'b3'
        ? await fetchB3History(IBOV_SYMBOL)
        : trend ? await fetchHistory('BTCUSDT', '1d', params.bars, 1, 'spot') : [];
      job.total = coins.length;
      const results: ReturnType<typeof runBacktest>[] = [];

      let i = 0;
      await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
        while (i < coins.length) {
          const coin = coins[i++];
          try {
            const candles = params.list === 'b3'
              ? await fetchB3History(coin.symbol)
              : await fetchHistory(coin.symbol, trend ? '1d' : params.tf, params.bars, 1, params.market);
            results.push(
              trend
                ? runTrendBacktest(candles, btc, coin.symbol)
                : runBacktest(candles, coin.symbol, coin.baseAsset, params.tf, {
                    longOnly: params.market === 'spot',
                    fundingPer8h: params.market === 'futures' ? FUNDING_PER_8H : 0
                  })
            );
          } catch {
            job.failedSymbols.push(coin.symbol);
          }
          job.done++;
          // cede o processador entre moedas para o servidor continuar respondendo
          await new Promise((r) => setImmediate(r));
        }
      }));

      if (results.length === 0) throw new Error('Nenhuma moeda pôde ser testada (corretora indisponível?)');
      job.summary = summarizeBatch(results.sort((a, b) => b.stats.trades - a.stats.trades));
      job.status = 'done';
    } catch (e: any) {
      job.status = 'error';
      job.error = e?.message || 'Erro desconhecido';
    } finally {
      job.finishedAt = Date.now();
    }
  })();

  return job;
}

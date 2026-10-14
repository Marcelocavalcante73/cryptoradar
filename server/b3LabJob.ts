/**
 * Laboratório da B3 em segundo plano: baixa ações, Ibovespa e CDI, e compara as 3 estratégias candidatas.
 */

import { runLab, LAB_CRITERIA } from '../src/services/b3Lab';
import { B3_TICKERS, IBOV_SYMBOL, fetchB3History, fetchCdi } from './b3Data';
import { CandleData } from '../src/types/crypto';

export interface LabJob {
  id: number;
  status: 'running' | 'done' | 'error';
  done: number;
  total: number;
  startedAt: number;
  finishedAt?: number;
  failedSymbols: string[];
  cdiSource?: 'bcb' | 'fixo';
  error?: string;
  result?: ReturnType<typeof runLab> & { criteria: string[] };
}

let current: LabJob | null = null;
let counter = 0;
const CONCURRENCY = 3;
const FALLBACK_CDI_YEAR = 0.105; // usado só se o Banco Central estiver fora do ar (avisado no resultado)

export const getLabJob = () => current;

export function startLabJob(): LabJob {
  if (current && current.status === 'running') return current;
  const job: LabJob = { id: ++counter, status: 'running', done: 0, total: B3_TICKERS.length, startedAt: Date.now(), failedSymbols: [] };
  current = job;
  (async () => {
    try {
      const ibov = await fetchB3History(IBOV_SYMBOL);
      let cdiMap: Map<number, number> | null = null;
      try { cdiMap = await fetchCdi(); job.cdiSource = 'bcb'; } catch { job.cdiSource = 'fixo'; }
      const flat = Math.pow(1 + FALLBACK_CDI_YEAR, 1 / 252) - 1;
      const cdiDaily = (day: number) => (cdiMap ? cdiMap.get(day) ?? 0 : flat);

      const raw = new Map<string, CandleData[]>();
      let i = 0;
      await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
        while (i < B3_TICKERS.length) {
          const t = B3_TICKERS[i++];
          try { raw.set(t, await fetchB3History(t)); } catch { job.failedSymbols.push(t); }
          job.done++;
          await new Promise((r) => setImmediate(r));
        }
      }));
      if (raw.size < 10) throw new Error('Poucas ações puderam ser baixadas (Yahoo Finance indisponível?)');
      job.result = { ...runLab(raw, ibov, { cdiDaily }), criteria: LAB_CRITERIA };
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

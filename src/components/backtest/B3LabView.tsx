import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { LabResult } from '../../services/b3Lab';

interface LabJobDto {
  id: number;
  status: 'running' | 'done' | 'error';
  done: number;
  total: number;
  failedSymbols: string[];
  cdiSource?: 'bcb' | 'fixo';
  error?: string;
  result?: {
    results: LabResult[];
    tickers: number;
    days: number;
    benchmarks: Record<'whole' | 'first' | 'second', { cdi: number; ibov: number; ibovDd: number }>;
  };
}

const card = 'bg-[#161920] border border-[#23272f] rounded-xl p-4';
const p1 = (n: number) => `${n.toFixed(1)}%`;

export const B3LabView: React.FC = () => {
  const [job, setJob] = useState<LabJobDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };

  const poll = useCallback(async () => {
    try {
      const r = await fetch('/api/b3lab', { signal: AbortSignal.timeout(8000) });
      const j: LabJobDto | null = await r.json();
      setJob(j);
      if (!j || j.status !== 'running') stop();
      return j;
    } catch { return null; }
  }, []);

  const startPolling = useCallback(() => { stop(); timer.current = setInterval(poll, 2000); }, [poll]);

  useEffect(() => {
    poll().then((j) => { if (j?.status === 'running') startPolling(); });
    return stop;
  }, [poll, startPolling]);

  const run = async () => {
    setError(null);
    try {
      const r = await fetch('/api/b3lab', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `Erro ${r.status}`);
      setJob(j); startPolling();
    } catch (e: any) { setError(e?.message || 'Não foi possível iniciar.'); }
  };

  const running = job?.status === 'running';
  const res = job?.status === 'done' ? job.result : undefined;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400 leading-relaxed">
        Compara 3 estratégias de carteira (até 5 ações, caixa rendendo CDI) com o CDI e o Ibovespa. Só 3 candidatas, com regras fixas e metade do período
        testada separada, para não ajustar até dar certo. Só passa se ganhar do CDI nas duas metades.
      </p>
      <button onClick={run} disabled={running} className="w-full bg-slate-100 text-slate-900 font-semibold py-3.5 rounded-lg text-base disabled:opacity-40">
        {running ? `Rodando… ${job?.done ?? 0} de ${job?.total ?? 40}` : 'Rodar laboratório'}
      </button>
      {error && <p className="text-sm text-rose-400">{error}</p>}
      {job?.status === 'error' && <p className="text-sm text-rose-400 bg-[#161920] border border-[#23272f] rounded-xl p-3">Falhou: {job.error}</p>}

      {res && job && (
        <>
          {job.cdiSource === 'fixo' && (
            <p className="text-xs text-amber-300">O Banco Central não respondeu: o CDI foi estimado em 10,5% ao ano.</p>
          )}
          <section className={card}>
            <div className="text-sm text-slate-300 mb-2">Referências ({res.tickers} ações, {(res.days / 252).toFixed(1)} anos)</div>
            <div className="text-sm text-slate-400 tabular-nums space-y-1">
              <div>CDI: {p1(res.benchmarks.whole.cdi)} ao ano (1ª metade {p1(res.benchmarks.first.cdi)} · 2ª {p1(res.benchmarks.second.cdi)})</div>
              <div>Ibovespa (sem dividendos): {p1(res.benchmarks.whole.ibov)} ao ano · queda máx. {p1(res.benchmarks.whole.ibovDd)}</div>
            </div>
          </section>
          {res.results.map((r) => (
            <section key={r.id} className={card}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2.5 h-2.5 rounded-full ${r.passed ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                <span className="text-base font-semibold text-slate-100">{r.name}</span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed mb-3">{r.desc}</p>
              <div className="grid grid-cols-3 gap-2 mb-3 text-center">
                <div><div className="text-xs text-slate-500">Retorno/ano</div><div className="text-base font-semibold tabular-nums text-slate-100">{p1(r.whole.cagr)}</div></div>
                <div><div className="text-xs text-slate-500">Queda máx.</div><div className="text-base font-semibold tabular-nums text-slate-100">{p1(r.whole.maxDd)}</div></div>
                <div><div className="text-xs text-slate-500">Entradas</div><div className="text-base font-semibold tabular-nums text-slate-100">{r.entries}</div></div>
              </div>
              <ul className="space-y-1.5">
                {r.checks.map((c) => (
                  <li key={c.label} className="flex items-start justify-between gap-3 text-sm">
                    <span className={c.ok ? 'text-slate-300' : 'text-slate-500'}>{c.ok ? '✓' : '○'} {c.label}</span>
                    <span className="text-slate-400 tabular-nums shrink-0 text-right">{c.detail}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p className="text-xs text-slate-500 leading-relaxed">
            Não inclui imposto (15% sobre o lucro em swing trade). Passar aqui não garante lucro futuro: o próximo passo seria a simulação ao vivo.
          </p>
        </>
      )}
    </div>
  );
};

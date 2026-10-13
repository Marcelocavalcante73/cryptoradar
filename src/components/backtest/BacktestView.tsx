import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MarketType } from '../../types/crypto';
import { BatchSummary, BACKTEST_CRITERIA } from '../../services/backtestBatch';
import { BacktestStats } from '../../services/backtest';
import { pnlColor } from '../common/format';

interface Job {
  id: number;
  params: { list?: 'top' | 'classic2022'; strategy?: 'signals' | 'trend'; market: MarketType; tf: '1h' | '4h' | '1d'; top: number; bars: number };
  status: 'running' | 'done' | 'error';
  done: number;
  total: number;
  startedAt: number;
  finishedAt?: number;
  failedSymbols: string[];
  error?: string;
  summary?: BatchSummary;
}

const card = 'bg-[#161920] border border-[#23272f] rounded-xl p-4';
const pct = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}%`;
const pf = (n: number | null) => (n === null ? '∞' : n.toFixed(2));

const Seg: React.FC<{ value: string; options: [string, string][]; onChange: (v: string) => void }> = ({ value, options, onChange }) => (
  <div className="inline-flex bg-[#0f1115] border border-[#23272f] rounded-lg p-0.5">
    {options.map(([id, label]) => (
      <button key={id} onClick={() => onChange(id)} className={`px-3.5 py-2 text-sm rounded-md ${value === id ? 'bg-[#2a2f3a] text-slate-100' : 'text-slate-400'}`}>
        {label}
      </button>
    ))}
  </div>
);

const Stat: React.FC<{ label: string; value: string; color?: string }> = ({ label, value, color = 'text-slate-100' }) => (
  <div>
    <div className="text-xs text-slate-500">{label}</div>
    <div className={`text-base font-semibold tabular-nums ${color}`}>{value}</div>
  </div>
);

const HalfRow: React.FC<{ label: string; s: BacktestStats }> = ({ label, s }) => (
  <div className="flex items-center justify-between py-2 border-t border-[#23272f] text-sm">
    <span className="text-slate-300">{label}</span>
    <span className="text-slate-400 tabular-nums">
      {s.trades} op. · fator {pf(s.profitFactor)} · <span className={pnlColor(s.avgNetPct)}>{pct(s.avgNetPct)}</span>
    </span>
  </div>
);

export const BacktestView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [strategy, setStrategy] = useState<'signals' | 'trend'>('signals');
  const [market, setMarket] = useState<MarketType>('spot');
  const [tf, setTf] = useState<'1h' | '4h'>('1h');
  const [top, setTop] = useState(30);
  const [list, setList] = useState<'top' | 'classic2022'>('top');
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };

  const poll = useCallback(async () => {
    try {
      const r = await fetch('/api/backtest/batch', { signal: AbortSignal.timeout(8000) });
      const j: Job | null = await r.json();
      setJob(j);
      if (!j || j.status !== 'running') stop();
      return j;
    } catch {
      return null; // tenta de novo no próximo ciclo
    }
  }, []);

  const startPolling = useCallback(() => {
    stop();
    timer.current = setInterval(poll, 2000);
  }, [poll]);

  // Ao abrir: mostra o último resultado e, se ainda estiver rodando, continua acompanhando
  useEffect(() => {
    poll().then((j) => { if (j?.status === 'running') startPolling(); });
    return stop;
  }, [poll, startPolling]);

  const run = async () => {
    setError(null);
    try {
      const r = await fetch('/api/backtest/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy, market, tf, top, list, bars: strategy === 'trend' ? 1500 : 3000 })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `Erro ${r.status}`);
      setJob(j);
      startPolling();
    } catch (e: any) {
      setError(e?.message || 'Não foi possível iniciar.');
    }
  };

  const trend = strategy === 'trend';
  const running = job?.status === 'running';
  const sum = job?.status === 'done' ? job.summary : undefined;
  const a = sum?.aggregate;

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-100">Backtest</h2>
        <button onClick={onBack} className="text-sm text-slate-300 underline underline-offset-4">Voltar</button>
      </div>

      <p className="text-sm text-slate-400 leading-relaxed">
        Aplica a estratégia ao histórico real das maiores moedas, já com taxas e derrapagem
        {!trend && market === 'futures' ? ' e funding' : ''}. Leva alguns minutos.
      </p>

      <section className={`${card} space-y-3`}>
        <div>
          <div className="text-sm text-slate-400 mb-1.5">Estratégia</div>
          <Seg value={strategy} onChange={(v) => setStrategy(v as 'signals' | 'trend')} options={[['signals', 'Sinais por indicadores'], ['trend', 'Rompimento de 55 dias']]} />
          {trend && (
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              Velas diárias, só compras. Entra quando o fechamento passa da máxima dos 55 dias anteriores e o Bitcoin está acima da média de 200 dias.
              Stop de 2 ATR; sai quando o fechamento perde a mínima dos 20 dias. Sem alvo fixo. Regras fixas, sem ajuste.
            </p>
          )}
        </div>
        {!trend && (
          <>
            <div>
              <div className="text-sm text-slate-400 mb-1.5">Mercado</div>
              <Seg value={market} onChange={(v) => setMarket(v as MarketType)} options={[['spot', 'Spot (só compras)'], ['futures', 'Futuros (long e short)']]} />
            </div>
            <div>
              <div className="text-sm text-slate-400 mb-1.5">Tempo de cada vela</div>
              <Seg value={tf as '1h' | '4h'} onChange={(v) => setTf(v as '1h' | '4h')} options={[['1h', '1 hora'], ['4h', '4 horas']]} />
            </div>
          </>
        )}
        <div>
          <div className="text-sm text-slate-400 mb-1.5">Moedas testadas</div>
          <Seg value={list === 'classic2022' ? 'c22' : String(top)} onChange={(v) => { if (v === 'c22') setList('classic2022'); else { setList('top'); setTop(Number(v)); } }}
            options={[['10', '10'], ['30', '30'], ['50', '50'], ['c22', 'Grandes de 2022']]} />
          {list === 'classic2022' && (
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              Lista fixa das 17 maiores moedas de 2022 (BTC, ETH, BNB, XRP, ADA, DOGE, SOL, TRX, DOT, LTC, AVAX, LINK, ATOM, XLM, ETC, BCH, UNI), definida antes dos resultados. Evita escolher só as moedas que subiram até hoje. Só spot.
            </p>
          )}
        </div>
        <button onClick={run} disabled={running} className="w-full bg-slate-100 text-slate-900 font-semibold py-3.5 rounded-lg text-base disabled:opacity-40">
          {running ? 'Rodando…' : 'Rodar backtest'}
        </button>
        {error && <p className="text-sm text-rose-400">{error}</p>}
      </section>

      {running && job && (
        <section className={card}>
          <div className="flex justify-between text-sm text-slate-300 mb-2">
            <span>{job.params.strategy === 'trend' ? 'Rompimento de 55 dias' : `${job.params.market === 'futures' ? 'Futuros' : 'Spot'} · ${job.params.tf}`}</span>
            <span className="tabular-nums">{job.done} de {job.total || job.params.top} moedas</span>
          </div>
          <div className="h-2 rounded-full bg-[#0f1115] overflow-hidden">
            <div className="h-full bg-slate-300" style={{ width: `${job.total ? (job.done / job.total) * 100 : 3}%` }} />
          </div>
        </section>
      )}

      {job?.status === 'error' && (
        <p className="text-sm text-rose-400 bg-[#161920] border border-[#23272f] rounded-xl p-3 leading-relaxed">
          Falhou: {job.error}. Se for erro 451 ou 403, o servidor está numa região bloqueada pela corretora.
        </p>
      )}

      {sum && a && job && (
        <>
          <p className="text-xs text-slate-500">
            Resultado de {job.params.strategy === 'trend' ? 'Rompimento de 55 dias (spot, diário)' : `${job.params.market === 'futures' ? 'Futuros' : 'Spot'} · ${job.params.tf}`} · {job.params.list === 'classic2022' ? '17 moedas (Grandes de 2022)' : `${job.params.top} moedas`}
          </p>

          <section className={card}>
            <div className="flex items-center gap-2 mb-1">
              <span className={`w-2.5 h-2.5 rounded-full ${sum.passed ? 'bg-emerald-400' : 'bg-rose-400'}`} />
              <span className="text-base font-semibold text-slate-100">
                {sum.passed ? 'Passou nos critérios' : 'Não passou nos critérios'}
              </span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed mb-3">
              {sum.passed
                ? 'O próximo passo é a simulação ao vivo (veja o plano de validação). Passar aqui não garante lucro futuro.'
                : 'Não opere com dinheiro real com esta estratégia. Ela precisa ser ajustada e testada de novo em outro período.'}
            </p>
            <ul className="space-y-1.5">
              {sum.checks.map((c) => (
                <li key={c.label} className="flex items-start justify-between gap-3 text-sm">
                  <span className={c.ok ? 'text-slate-300' : 'text-slate-500'}>{c.ok ? '✓' : '○'} {c.label}</span>
                  <span className="text-slate-400 tabular-nums shrink-0">{c.detail}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className={card}>
            <div className="grid grid-cols-2 gap-4">
              <Stat label="Operações" value={String(a.trades)} />
              <Stat label="Acerto" value={`${a.winRate.toFixed(0)}%`} />
              <Stat label="Fator de lucro" value={pf(a.profitFactor)} color={a.profitFactor === null || a.profitFactor >= BACKTEST_CRITERIA.minProfitFactor ? 'text-emerald-400' : 'text-rose-400'} />
              <Stat label="Média por operação" value={pct(a.avgNetPct)} color={pnlColor(a.avgNetPct)} />
              <Stat label="Capital (1% de risco)" value={pct(sum.risk1.returnPct)} color={pnlColor(sum.risk1.returnPct)} />
              <Stat label="Maior queda do capital" value={`${sum.risk1.maxDrawdownPct.toFixed(1)}%`} />
              <Stat label="Sem os 5 melhores trades" value={`fator ${pf(sum.withoutTop5.profitFactor)}`} color={sum.withoutTop5.profitFactor === null || sum.withoutTop5.profitFactor >= 1 ? 'text-emerald-400' : 'text-rose-400'} />
              <Stat label="Lucro dos 5 melhores" value={`${sum.top5SharePct.toFixed(0)}% do total`} />
            </div>
            <div className="mt-3">
              <HalfRow label="Primeira metade do período" s={sum.firstHalf} />
              <HalfRow label="Segunda metade do período" s={sum.secondHalf} />
            </div>
            <p className="text-xs text-slate-500 mt-3">
              Saídas: {job.params.strategy === 'trend' ? `tendência ${a.trailExits}` : `alvo ${a.targetExits}`} · stop {a.stopExits} · tempo {a.timeoutExits}
              {job.failedSymbols.length > 0 && ` · não testadas: ${job.failedSymbols.length}`}
            </p>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Capital e queda: arriscando 1% do capital por operação, no máximo 5 posições abertas ao mesmo tempo (as demais são puladas: {sum.risk1.skipped} de {sum.risk1.taken + sum.risk1.skipped}), com ganhos e perdas compostos. O resultado real depende de você conseguir executar todas.
            </p>
          </section>

          <section>
            <h3 className="text-sm font-medium text-slate-300 mb-2">Por moeda</h3>
            <div className={`${card} !p-0 divide-y divide-[#23272f]`}>
              <div className="grid grid-cols-4 px-4 py-2 text-xs text-slate-500">
                <span>Moeda</span><span className="text-right">Op.</span><span className="text-right">Fator</span><span className="text-right">Média</span>
              </div>
              {sum.rows.map((r) => (
                <div key={r.symbol} className="grid grid-cols-4 px-4 py-2.5 text-sm tabular-nums">
                  <span className="text-slate-200">{r.symbol.replace('USDT', '')}</span>
                  <span className="text-right text-slate-400">{r.trades}</span>
                  <span className="text-right text-slate-300">{r.trades ? pf(r.profitFactor) : '—'}</span>
                  <span className={`text-right ${r.trades ? pnlColor(r.avgNetPct) : 'text-slate-500'}`}>{r.trades ? pct(r.avgNetPct) : '—'}</span>
                </div>
              ))}
            </div>
          </section>

          <p className="text-xs text-slate-500 leading-relaxed">
            Resultado passado não garante resultado futuro.
            {a.trades < BACKTEST_CRITERIA.minTrades && ` Com menos de ${BACKTEST_CRITERIA.minTrades} operações a estatística é pouco confiável.`}
          </p>
        </>
      )}
    </div>
  );
};

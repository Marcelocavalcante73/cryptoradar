import React, { useMemo } from 'react';
import { BarChart3, AlertTriangle } from 'lucide-react';
import { computeSignalPerformance, PerfGroup, PerfSignal, MIN_RELIABLE_SAMPLE } from '../../services/signalPerformance';

const fmtR = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}R`;

const GroupRow: React.FC<{ g: PerfGroup }> = ({ g }) => (
  <div className="grid grid-cols-5 gap-1 py-1.5 border-t border-slate-800/70 text-[11px] font-mono">
    <span className="font-sans text-slate-300">{g.label}</span>
    <span className="text-slate-400">{g.resolved}</span>
    <span className={g.resolved === 0 ? 'text-slate-600' : g.winRate >= 50 ? 'text-emerald-400' : 'text-slate-300'}>
      {g.resolved === 0 ? '—' : `${g.winRate.toFixed(0)}%`}
    </span>
    <span className={g.resolved === 0 ? 'text-slate-600' : g.avgR > 0 ? 'text-emerald-400' : 'text-rose-400'}>
      {g.resolved === 0 ? '—' : fmtR(g.avgR)}
    </span>
    <span className="text-slate-400">{g.resolved === 0 ? '—' : g.profitFactor === null ? '∞' : g.profitFactor.toFixed(2)}</span>
  </div>
);

const Table: React.FC<{ title: string; groups: PerfGroup[] }> = ({ title, groups }) => (
  <div>
    <div className="grid grid-cols-5 gap-1 pb-1 text-[9px] text-slate-500 uppercase">
      <span>{title}</span><span>Encerr.</span><span>Acerto</span><span>R médio</span><span>F. lucro</span>
    </div>
    {groups.map((g) => <GroupRow key={g.label} g={g} />)}
  </div>
);

export const PerformancePanel: React.FC<{ signals: PerfSignal[] }> = ({ signals }) => {
  const perf = useMemo(() => computeSignalPerformance(signals), [signals]);
  if (perf.total === 0) return null;

  return (
    <details className="bg-[#121722] border border-slate-800 rounded-2xl p-3">
      <summary className="cursor-pointer flex items-center justify-between text-xs font-semibold text-slate-300">
        <span className="flex items-center gap-1.5">
          <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
          Desempenho dos sinais
        </span>
        <span className="text-[10px] text-slate-500 font-mono">
          {perf.closed} encerrados · {perf.open} abertos
        </span>
      </summary>

      <div className="mt-3 space-y-3">
        {!perf.reliable && (
          <div className="flex gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl p-2 text-[10px] text-amber-200 leading-relaxed">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              Só {perf.overall.resolved} sinais com resultado. Com menos de {MIN_RELIABLE_SAMPLE}, taxa de acerto e R médio
              são pouco confiáveis: não tire conclusões ainda.
            </span>
          </div>
        )}

        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            { l: 'Alvo', v: perf.targetHits, c: 'text-emerald-400' },
            { l: 'Stop', v: perf.stopHits, c: 'text-rose-400' },
            { l: 'Expirados', v: perf.expired, c: 'text-slate-300' },
            { l: 'Acerto', v: perf.overall.resolved ? `${perf.overall.winRate.toFixed(0)}%` : '—', c: 'text-cyan-400' }
          ].map((k) => (
            <div key={k.l} className="bg-slate-900/70 border border-slate-800 rounded-xl py-2">
              <div className={`text-sm font-bold font-mono ${k.c}`}>{k.v}</div>
              <div className="text-[9px] text-slate-500">{k.l}</div>
            </div>
          ))}
        </div>

        <div className="text-[10px] text-slate-500 leading-relaxed">
          Resultado em R (1R = distância até o stop), já descontando taxa e derrapagem (0,3% ida e volta).
          Média geral: <span className={perf.overall.avgR > 0 ? 'text-emerald-400' : 'text-rose-400'}>{perf.overall.resolved ? fmtR(perf.overall.avgR) : '—'}</span>{' '}
          por sinal. Fator de lucro acima de 1 = ganhos maiores que perdas.
        </div>

        <Table title="Direção" groups={perf.byDirection} />
        <Table title="Timeframe" groups={perf.byTimeframe} />
        <Table title="Pontuação" groups={perf.byScore} />
      </div>
    </details>
  );
};

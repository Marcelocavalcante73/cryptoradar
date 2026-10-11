import React, { useMemo } from 'react';
import { computeSignalPerformance, PerfGroup, PerfSignal, MIN_RELIABLE_SAMPLE } from '../../services/signalPerformance';
import { pnlColor } from '../common/format';

const fmtR = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}R`;

const Row: React.FC<{ g: PerfGroup }> = ({ g }) => (
  <tr className="border-t border-[#23272f]">
    <td className="py-2 text-slate-300">{g.label}</td>
    <td className="py-2 text-right text-slate-400">{g.resolved}</td>
    <td className="py-2 text-right text-slate-300">{g.resolved ? `${g.winRate.toFixed(0)}%` : '—'}</td>
    <td className={`py-2 text-right ${g.resolved ? pnlColor(g.avgR) : 'text-slate-500'}`}>{g.resolved ? fmtR(g.avgR) : '—'}</td>
  </tr>
);

export const PerformancePanel: React.FC<{ signals: PerfSignal[] }> = ({ signals }) => {
  const perf = useMemo(() => computeSignalPerformance(signals), [signals]);
  if (perf.total === 0) return null;

  const groups = [...perf.byDirection, ...perf.byTimeframe, ...perf.byScore];

  return (
    <details className="bg-[#161920] border border-[#23272f] rounded-xl">
      <summary className="cursor-pointer px-4 py-3 flex items-center justify-between text-sm">
        <span className="text-slate-200 font-medium">Desempenho dos sinais</span>
        <span className="text-xs text-slate-400">
          {perf.overall.resolved
            ? `${perf.overall.winRate.toFixed(0)}% de acerto · ${fmtR(perf.overall.avgR)} por sinal`
            : `${perf.closed} encerrados`}
        </span>
      </summary>
      <div className="px-4 pb-4 text-sm">
        {!perf.reliable && (
          <p className="text-xs text-amber-300 mb-3 leading-relaxed">
            Apenas {perf.overall.resolved} sinais encerrados. Abaixo de {MIN_RELIABLE_SAMPLE}, estes números ainda não são confiáveis.
          </p>
        )}
        <p className="text-xs text-slate-400 mb-2 leading-relaxed">
          {perf.targetHits} no alvo · {perf.stopHits} no stop · {perf.expired} expirados · {perf.open} abertos.
          1R = distância até o stop; taxas e derrapagem já descontadas.
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-500">
              <th className="text-left font-normal pb-1"> </th>
              <th className="text-right font-normal pb-1">Sinais</th>
              <th className="text-right font-normal pb-1">Acerto</th>
              <th className="text-right font-normal pb-1">Média</th>
            </tr>
          </thead>
          <tbody>
            <Row g={perf.overall} />
            {groups.map((g) => <Row key={g.label} g={g} />)}
          </tbody>
        </table>
      </div>
    </details>
  );
};

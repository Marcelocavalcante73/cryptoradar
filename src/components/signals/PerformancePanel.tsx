import React, { useMemo } from 'react';
import { computeSignalPerformance, evaluateReadiness, PerfGroup, PerfSignal, MIN_RELIABLE_SAMPLE } from '../../services/signalPerformance';
import { pnlColor } from '../common/format';

const fmtR = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}R`;

const Row: React.FC<{ g: PerfGroup }> = ({ g }) => (
  <tr className="border-t border-[#1E293B]/70">
    <td className="py-2 text-[#F1F5F9]">{g.label}</td>
    <td className="py-2 text-right text-[#94A3B8] font-mono">{g.resolved}</td>
    <td className="py-2 text-right text-[#F1F5F9] font-mono">{g.resolved ? `${g.winRate.toFixed(0)}%` : '—'}</td>
    <td className={`py-2 text-right font-mono ${g.resolved ? (g.avgR > 0 ? 'text-[#10B981]' : g.avgR < 0 ? 'text-[#F43F5E]' : 'text-[#94A3B8]') : 'text-[#94A3B8]'}`}>
      {g.resolved ? fmtR(g.avgR) : '—'}
    </td>
  </tr>
);

export const PerformancePanel: React.FC<{ signals: PerfSignal[] }> = ({ signals }) => {
  const perf = useMemo(() => computeSignalPerformance(signals), [signals]);
  const readiness = useMemo(() => evaluateReadiness(signals), [signals]);
  if (perf.total === 0) return null;

  const groups = [...perf.byDirection, ...perf.byTimeframe, ...perf.byScore];

  return (
    <details className="bg-[#10192A] border border-[#1E293B] rounded-xl overflow-hidden transition-all shadow-sm">
      <summary className="cursor-pointer px-4 py-3 flex items-center justify-between text-xs hover:bg-[#141F36]/50 transition-colors">
        <span className="text-[#F1F5F9] font-semibold">Auditoria de Desempenho dos Sinais</span>
        <span className="text-xs text-[#94A3B8] font-mono">
          {perf.overall.resolved
            ? `${perf.overall.winRate.toFixed(0)}% de acerto · ${fmtR(perf.overall.avgR)} por sinal`
            : `${perf.closed} encerrados`}
        </span>
      </summary>
      <div className="px-4 pb-4 text-xs">
        <div className="mb-3 rounded-lg border border-[#1E293B] bg-[#0A0F1D] p-3">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                readiness.status === 'ready' ? 'bg-[#10B981]' : readiness.status === 'failed' ? 'bg-[#F43F5E]' : 'bg-[#F5AC37]'
              }`}
            />
            <span className="text-[#F1F5F9] font-semibold">Validação para Capital Real</span>
          </div>
          <p className="text-xs text-[#94A3B8] mt-1 leading-relaxed">{readiness.headline}</p>
          <ul className="mt-2 space-y-1">
            {readiness.checks.map((c) => (
              <li key={c.label} className="flex items-start justify-between gap-3 text-xs">
                <span className={c.ok ? 'text-[#F1F5F9]' : 'text-[#94A3B8]'}>{c.ok ? '✓' : '○'} {c.label}</span>
                <span className="text-[#94A3B8] font-mono shrink-0">{c.detail}</span>
              </li>
            ))}
          </ul>
        </div>

        {!perf.reliable && (
          <p className="text-xs text-[#F5AC37] mb-2 leading-relaxed">
            Apenas {perf.overall.resolved} sinais encerrados. Abaixo de {MIN_RELIABLE_SAMPLE}, a amostragem ainda está em maturação.
          </p>
        )}
        <p className="text-xs text-[#94A3B8] mb-2 leading-relaxed">
          {perf.targetHits} no alvo · {perf.stopHits} no stop · {perf.expired} expirados · {perf.open} abertos.
          1R = distância até o stop com taxas descontadas.
        </p>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[#94A3B8] border-b border-[#1E293B]">
              <th className="text-left font-normal pb-1">Segmento</th>
              <th className="text-right font-normal pb-1">Sinais</th>
              <th className="text-right font-normal pb-1">Taxa Acerto</th>
              <th className="text-right font-normal pb-1">Média R:R</th>
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

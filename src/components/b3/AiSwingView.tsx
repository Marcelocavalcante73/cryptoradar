import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { B3Signal, MarketTrend, isB3Done, indicatorSignalResult, evaluateB3Readiness, b3Sizing } from '../../services/b3Signals';
import { AI_RULES } from '../../services/aiSwing';
import { accessKey } from '../../services/remoteState';
import { fetchJson } from '../../services/http';
import { fmtBrl, fmtPct, timeAgo, pnlColor } from '../common/format';
import { MarketCard, B3Info } from './B3Views';

interface SwingState {
  enabled: boolean;
  provider: string | null;
  running: boolean;
  lastRunAt: number | null;
  lastDecisionDay: number | null;
  lastError: string | null;
  market: MarketTrend | null;
  signals: B3Signal[];
  log: {
    at: number;
    items: { symbol: string; action: 'BUY' | 'WAIT'; confidence: number; reason: string }[];
    blocked: { symbol: string; why: string }[];
    created: string[];
  } | null;
}

const card = 'bg-[#161920] border border-[#23272f] rounded-xl p-4';
const fmtN = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const who = (p: string | null) => (p === 'openai' ? 'ChatGPT' : p === 'gemini' ? 'Gemini' : 'IA');

export const AiSwingView: React.FC<{ capital: number; riskPercent: number; info: B3Info | null }> = ({ capital, riskPercent, info }) => {
  const [st, setSt] = useState<SwingState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { json } = await fetchJson<SwingState>('/api/ai/swing', { signal: AbortSignal.timeout(8000) });
      setSt(json);
      setError(null);
    } catch (e: any) { setError(e?.message || 'Não foi possível carregar o motor de IA.'); }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  const run = async () => {
    setBusy(true); setMsg(null); setError(null);
    try {
      const k = accessKey.get();
      const { ok, status, json } = await fetchJson<any>('/api/ai/swing/run', {
        method: 'POST', headers: k ? { 'X-Access-Key': k } : {}, signal: AbortSignal.timeout(90000)
      });
      if (json?.state) setSt(json.state);
      if (!ok) throw new Error(json?.error || json?.message || `Erro ${status}`);
      setMsg(json.message);
    } catch (e: any) { setError(e?.message || 'Não foi possível rodar agora.'); }
    setBusy(false);
  };

  const readiness = useMemo(() => evaluateB3Readiness(st?.signals ?? []), [st?.signals]);
  const rulesReadiness = useMemo(() => evaluateB3Readiness(info?.indicators.signals ?? []), [info?.indicators.signals]);

  if (!st) {
    return (
      <div className="space-y-4 pb-24">
        <h2 className="text-lg font-semibold text-slate-100">Motor de IA</h2>
        <p className={`${card} text-sm ${error ? 'text-amber-300' : 'text-slate-400'}`}>{error ?? 'Carregando…'}</p>
      </div>
    );
  }

  const active = st.signals.filter((s) => !isB3Done(s));
  const closed = st.signals.filter(isB3Done);
  const buys = st.log?.items.filter((i) => i.action === 'BUY') ?? [];

  return (
    <div className="space-y-5 pb-24">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-100">Motor de IA <span className="text-slate-500 font-normal">· B3, swing</span></h2>
        <span className="text-xs text-slate-400 text-right">{st.lastRunAt ? `atualizado ${timeAgo(st.lastRunAt)}` : 'ainda não rodou'}</span>
      </div>

      {st.market && <MarketCard info={{ market: st.market } as B3Info} />}

      <section className={card}>
        <p className="text-sm text-slate-300 leading-relaxed">
          A IA ({st.enabled ? who(st.provider) : 'desligada'}) recebe o mercado e os indicadores de cada ação e decide o que comprar, com stop, alvo e prazo.
          O código só impõe travas: mercado em alta, stop de {AI_RULES.stopAtr[0]} a {AI_RULES.stopAtr[1]} ATR, alvo de pelo menos {AI_RULES.minRewardRisk}x o stop,
          confiança mínima {AI_RULES.minConfidence} e no máximo {AI_RULES.maxNew} sinais por dia.
        </p>
        <button onClick={run} disabled={busy || !st.enabled || st.running} className="w-full mt-3 bg-slate-100 text-slate-900 font-semibold py-3 rounded-lg disabled:opacity-40">
          {busy || st.running ? 'Analisando o mercado…' : 'Pedir decisão agora'}
        </button>
        {!st.enabled && <p className="text-xs text-amber-300 mt-2">IA desligada: defina GEMINI_API_KEY ou OPENAI_API_KEY no servidor e publique de novo.</p>}
        {msg && <p className="text-sm text-slate-200 mt-2">{msg}</p>}
        {(error || st.lastError) && <p className="text-xs text-rose-400 mt-2">{error ?? st.lastError}</p>}
        <p className="text-xs text-slate-500 mt-2">Decide sozinha uma vez por dia, depois que o pregão fecha (21h, Brasília).</p>
      </section>

      <section>
        <h3 className="text-sm font-medium text-slate-300 mb-2">Compras decididas pela IA ({active.length})</h3>
        {active.length === 0 ? (
          <p className={`${card} text-sm text-slate-400`}>
            Nenhuma posição aberta. É normal: o padrão da IA é esperar e só comprar quando o conjunto justificar.
          </p>
        ) : (
          <div className="space-y-3">
            {active.map((s) => {
              const entry = s.entryPrice ?? s.refPrice;
              const pct = ((((s.lastPrice ?? entry) - entry) / entry) * 100);
              const sz = capital > 0 ? b3Sizing(capital, riskPercent, entry, s.stopPrice) : null;
              return (
                <div key={s.id} className={`${card} ${s.status === 'EXIT_SIGNAL' ? '!border-amber-500/50' : ''}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-base font-semibold text-slate-100">{s.symbol} <span className="text-xs font-normal text-slate-500">confiança {s.confidence}</span></span>
                    <span className={`text-base font-semibold tabular-nums ${pnlColor(pct)}`}>{s.entryPrice ? fmtPct(pct) : 'aguardando'}</span>
                  </div>
                  {s.reason && <p className="text-sm text-slate-300 mt-2 leading-relaxed">{s.reason}</p>}
                  {s.status === 'EXIT_SIGNAL' && <p className="text-sm text-amber-300 mt-2">Prazo vencido: venda na abertura do próximo pregão.</p>}
                  <div className="grid grid-cols-3 gap-2 mt-3 text-sm">
                    <div><div className="text-xs text-slate-500">{s.entryPrice ? 'Entrada' : 'Referência'}</div><div className="tabular-nums text-slate-100">{fmtN(entry)}</div></div>
                    <div><div className="text-xs text-slate-500">Stop ({s.stopMult} ATR)</div><div className="tabular-nums text-rose-400">{fmtN(s.stopPrice)}</div></div>
                    <div><div className="text-xs text-slate-500">Alvo ({s.targetMult} ATR)</div><div className="tabular-nums text-emerald-400">{fmtN(s.targetPrice)}</div></div>
                  </div>
                  {sz && <p className="text-xs text-slate-400 mt-2">Para {fmtBrl(capital)}: <span className="font-medium text-slate-100">{sz.shares} ações</span> ≈ {fmtBrl(sz.cost)}; perde ≈ {fmtBrl(sz.riskBrl)} se bater o stop.</p>}
                  <div className="text-xs text-slate-500 mt-2">sinal {timeAgo(s.createdAt)} · prazo máximo {s.holdDays} pregões</div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {st.log && (
        <section>
          <h3 className="text-sm font-medium text-slate-300 mb-2">Última decisão ({buys.length} compra{buys.length === 1 ? '' : 's'} de {st.log.items.length} ações)</h3>
          <div className={`${card} !p-0 divide-y divide-[#23272f]`}>
            {[...st.log.items].sort((a, b) => (a.action === b.action ? b.confidence - a.confidence : a.action === 'BUY' ? -1 : 1)).slice(0, 12).map((i) => (
              <div key={i.symbol} className="px-4 py-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-100">{i.symbol}</span>
                  <span className={i.action === 'BUY' ? 'text-emerald-400' : 'text-slate-400'}>{i.action === 'BUY' ? 'Comprar' : 'Esperar'} · {i.confidence}</span>
                </div>
                {i.reason && <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{i.reason}</p>}
              </div>
            ))}
          </div>
          {st.log.blocked.length > 0 && (
            <p className="text-xs text-amber-300 mt-2 leading-relaxed">Barrado pelas travas: {st.log.blocked.map((b) => `${b.symbol} (${b.why})`).join('; ')}.</p>
          )}
        </section>
      )}

      {closed.length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-slate-300 mb-2">Encerradas ({closed.length})</h3>
          <div className={`${card} !p-0 divide-y divide-[#23272f]`}>
            {closed.slice(0, 20).map((s) => {
              const res = indicatorSignalResult(s);
              return (
                <div key={s.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm text-slate-100">{s.symbol} <span className="text-slate-500">· {s.status === 'STOP' ? 'Stop' : s.status === 'TARGET' ? 'Alvo' : 'Prazo'}</span></div>
                    <div className="text-xs text-slate-500 tabular-nums">{s.entryPrice ? fmtN(s.entryPrice) : '—'} → {s.exitPrice ? fmtN(s.exitPrice) : '—'}</div>
                  </div>
                  {res && <div className={`text-sm font-medium tabular-nums ${pnlColor(res.netPct)}`}>{fmtPct(res.netPct)}</div>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className={card}>
        <div className="flex items-center justify-between">
          <span className="text-base font-semibold text-slate-100">A IA ganha do motor de regras?</span>
          <span className={`w-2.5 h-2.5 rounded-full ${readiness.status === 'ready' ? 'bg-emerald-400' : readiness.status === 'failed' ? 'bg-rose-400' : 'bg-amber-400'}`} />
        </div>
        <p className="text-xs text-slate-400 leading-relaxed mt-1">
          A IA não pode ser testada no passado (ela já "conhece" o histórico), então a prova é ao vivo, com os mesmos critérios dos outros motores: {readiness.headline}
        </p>
        <ul className="mt-2 space-y-1">
          {readiness.checks.map((c) => (
            <li key={c.label} className="flex items-start justify-between gap-3 text-xs">
              <span className={c.ok ? 'text-slate-300' : 'text-slate-500'}>{c.ok ? '✓' : '○'} {c.label}</span>
              <span className="text-slate-400 tabular-nums shrink-0">{c.detail}</span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-slate-500 mt-3">
          Para comparar: o motor de regras (aba Sinais) tem {info?.indicators.signals.filter(isB3Done).length ?? 0} operações encerradas ao vivo; status: {rulesReadiness.status === 'collecting' ? 'coletando' : rulesReadiness.status === 'ready' ? 'critérios atingidos' : 'reprovado'}.
        </p>
      </section>

      <p className="text-xs text-slate-500 leading-relaxed">
        Em validação: só simulação, sem dinheiro real. A decisão da IA é estatística e pode errar; stop e alvo valem sempre. Imposto e corretagem não incluídos. Não é recomendação de investimento.
      </p>
    </div>
  );
};

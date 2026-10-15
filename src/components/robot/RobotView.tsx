import React, { useCallback, useEffect, useState } from 'react';
import type { RobotState, RobotStats } from '../../services/robot';
import { accessKey } from '../../services/remoteState';
import { fetchJson } from '../../services/http';
import { fmtPrice, fmtPct, fmtUsd, timeAgo, pnlColor } from '../common/format';

interface RobotPayload { state: RobotState; stats: RobotStats; lastError: string | null; running: boolean }

const card = 'bg-[#161920] border border-[#23272f] rounded-xl p-4';
const input = 'w-20 bg-[#0f1115] border border-[#23272f] rounded-lg px-2 py-1.5 text-right text-slate-100 text-sm';

const headers = (): Record<string, string> => {
  const k = accessKey.get();
  return { 'Content-Type': 'application/json', ...(k ? { 'X-Access-Key': k } : {}) };
};

export const RobotView: React.FC = () => {
  const [d, setD] = useState<RobotPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { json } = await fetchJson<RobotPayload>('/api/robot?wait=1', { signal: AbortSignal.timeout(28000) });
      setD(json); setError(null);
    } catch (e: any) { setError(e?.message || 'Não foi possível carregar o robô.'); }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const post = async (path: string, body: unknown) => {
    setBusy(true); setError(null);
    try {
      const { ok, status, json } = await fetchJson<any>(path, { method: 'POST', headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      if (!ok) throw new Error(json?.error || `Erro ${status}`);
      if (json?.state) setD(json as RobotPayload);
    } catch (e: any) { setError(e?.message || 'Não foi possível concluir.'); }
    setBusy(false);
  };

  if (!d) return (
    <div className="space-y-4 pb-24">
      <h2 className="text-lg font-semibold text-slate-100">Robô</h2>
      <p className={`${card} text-sm ${error ? 'text-amber-300' : 'text-slate-400'}`}>{error ?? 'Carregando…'}</p>
    </div>
  );

  const { state: s, stats: st } = d;
  const today = new Date().toISOString().slice(0, 10);
  const status = s.halted ? { t: 'Parado pelo limite de queda', c: 'bg-rose-400' } : s.pausedDay === today ? { t: 'Pausado hoje (perda máxima do dia)', c: 'bg-amber-400' } : s.config.enabled ? { t: 'Ligado', c: 'bg-emerald-400' } : { t: 'Desligado', c: 'bg-slate-500' };
  const cfg = s.config;
  const num = (v: string, fb: number) => { const n = parseFloat(v.replace(',', '.')); return Number.isFinite(n) ? n : fb; };

  return (
    <div className="space-y-5 pb-24">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-100">Robô <span className="text-slate-500 font-normal">· cripto spot, simulação</span></h2>
        <span className="text-xs text-slate-400">{s.lastTickAt ? `atualizado ${timeAgo(s.lastTickAt)}` : ''}</span>
      </div>

      <section className={card}>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm text-slate-300"><span className={`w-2.5 h-2.5 rounded-full ${status.c}`} />{status.t}</span>
          <button
            onClick={() => post('/api/robot/config', { enabled: !cfg.enabled })}
            disabled={busy || Boolean(s.halted)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 ${cfg.enabled ? 'border border-[#2a2f3a] text-slate-200' : 'bg-slate-100 text-slate-900'}`}
          >{cfg.enabled ? 'Desligar' : 'Ligar'}</button>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3">
          <div><div className="text-xs text-slate-500">Patrimônio</div><div className="text-base font-semibold tabular-nums text-slate-100">{fmtUsd(st.equity)}</div></div>
          <div><div className="text-xs text-slate-500">Resultado</div><div className={`text-base font-semibold tabular-nums ${pnlColor(st.pnl)}`}>{fmtPct(st.pnlPct)}</div></div>
          <div><div className="text-xs text-slate-500">Queda do pico</div><div className="text-base font-semibold tabular-nums text-slate-100">{st.drawdownPct.toFixed(1)}%</div></div>
        </div>
        {s.halted && (
          <div className="mt-3 text-sm text-rose-300">
            {s.halted.reason}.
            <button onClick={() => post('/api/robot/config', { resume: true })} disabled={busy} className="ml-2 underline underline-offset-4 text-slate-200">Religar</button>
          </div>
        )}
        {error && <p className="text-xs text-rose-400 mt-2">{error}</p>}
      </section>

      <section>
        <h3 className="text-sm font-medium text-slate-300 mb-2">Posições abertas ({s.positions.length})</h3>
        {s.positions.length === 0 ? (
          <p className={`${card} text-sm text-slate-400`}>{cfg.enabled ? 'Nenhuma posição. O robô espera um sinal.' : 'Robô desligado.'}</p>
        ) : (
          <div className={`${card} !p-0 divide-y divide-[#23272f]`}>
            {s.positions.map((p) => {
              const pct = (p.lastPrice / p.entryPrice - 1) * 100;
              return (
                <div key={p.id} className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-100">{p.baseAsset} <span className="text-xs text-slate-500">{p.source === 'ai' ? 'IA' : 'tendência'}</span></span>
                    <span className={`text-sm font-medium tabular-nums ${pnlColor(pct)}`}>{fmtPct(pct)}</span>
                  </div>
                  <div className="text-xs text-slate-500 tabular-nums mt-0.5">
                    {fmtUsd(p.qty * p.lastPrice)} · entrada {fmtPrice(p.entryPrice)} · stop {fmtPrice(p.stopPrice)} · arrisca {fmtUsd(p.riskUsd)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-sm font-medium text-slate-300 mb-2">Operações encerradas ({st.closed})</h3>
        {s.trades.length === 0 ? <p className={`${card} text-sm text-slate-400`}>Ainda não há operações encerradas.</p> : (
          <div className={`${card} !p-0 divide-y divide-[#23272f]`}>
            {s.trades.slice(0, 10).map((t) => (
              <div key={t.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <div className="text-sm text-slate-100">{t.baseAsset} <span className="text-slate-500">· {t.source === 'ai' ? 'IA' : 'tendência'}</span></div>
                  <div className="text-xs text-slate-500">{timeAgo(t.closedAt)} · {t.reason}</div>
                </div>
                <div className="text-right">
                  <div className={`text-sm font-medium tabular-nums ${pnlColor(t.pnl)}`}>{t.pnl >= 0 ? '+' : '−'}{fmtUsd(Math.abs(t.pnl))}</div>
                  <div className="text-xs text-slate-500 tabular-nums">{fmtPct(t.netPct)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <details className={card}>
        <summary className="cursor-pointer text-sm text-slate-200">Configurações e limites de risco</summary>
        <div className="mt-3 space-y-2 text-sm text-slate-300">
          {([
            ['Risco por operação (%)', 'riskPct', cfg.riskPct],
            ['Posições abertas (máx.)', 'maxOpen', cfg.maxOpen],
            ['Máx. do patrimônio em uma posição (%)', 'maxPositionPct', cfg.maxPositionPct],
            ['Perda máxima no dia (%)', 'maxDailyLossPct', cfg.maxDailyLossPct],
            ['Queda máxima do pico (%): para o robô', 'maxDrawdownPct', cfg.maxDrawdownPct]
          ] as [string, string, number][]).map(([label, key, value]) => (
            <label key={key} className="flex items-center justify-between gap-3">
              <span>{label}</span>
              <input className={input} inputMode="decimal" defaultValue={value} onBlur={(e) => post('/api/robot/config', { [key]: num(e.target.value, value) })} />
            </label>
          ))}
          <label className="flex items-center justify-between"><span>Seguir sinais de tendência</span>
            <input type="checkbox" checked={cfg.useTrend} onChange={(e) => post('/api/robot/config', { useTrend: e.target.checked })} /></label>
          <label className="flex items-center justify-between"><span>Seguir sinais do motor de IA</span>
            <input type="checkbox" checked={cfg.useAi} onChange={(e) => post('/api/robot/config', { useAi: e.target.checked })} /></label>
          <div className="flex items-center justify-between pt-2 border-t border-[#23272f]">
            <span>Capital inicial: {fmtUsd(cfg.startCapital)}</span>
            <button
              onClick={() => { const v = window.prompt('Novo capital inicial (USDT). Isso zera a carteira do robô.', String(cfg.startCapital)); if (v) void post('/api/robot/reset', { startCapital: num(v, cfg.startCapital) }); }}
              className="text-slate-300 underline underline-offset-4"
            >Zerar carteira</button>
          </div>
          <p className="text-xs text-slate-500">Compra sem alavancagem, com taxa e derrapagem, sem dinheiro real. Entra ao preço atual (pula se já subiu mais de 1,5% do sinal).</p>
        </div>
      </details>

      <details className={card}>
        <summary className="cursor-pointer flex items-center justify-between text-sm text-slate-200">
          <span>Pronto para valor real?</span>
          <span className={`w-2.5 h-2.5 rounded-full ${st.readiness.status === 'ready' ? 'bg-emerald-400' : st.readiness.status === 'failed' ? 'bg-rose-400' : 'bg-amber-400'}`} />
        </summary>
        <p className="text-xs text-slate-400 mt-2">{st.readiness.headline}</p>
        <ul className="mt-2 space-y-1">
          {st.readiness.checks.map((c) => (
            <li key={c.label} className="flex items-start justify-between gap-3 text-xs">
              <span className={c.ok ? 'text-slate-300' : 'text-slate-500'}>{c.ok ? '✓' : '○'} {c.label}</span>
              <span className="text-slate-400 tabular-nums shrink-0">{c.detail}</span>
            </li>
          ))}
        </ul>
      </details>

      {s.events.length > 0 && (
        <details className={card}>
          <summary className="cursor-pointer text-sm text-slate-200">Registro ({s.events.length})</summary>
          <ul className="mt-2 space-y-1.5">
            {s.events.slice(0, 20).map((e, i) => (
              <li key={i} className={`text-xs ${e.kind === 'risk' ? 'text-amber-300' : 'text-slate-400'}`}>{timeAgo(e.at)} · {e.text}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};


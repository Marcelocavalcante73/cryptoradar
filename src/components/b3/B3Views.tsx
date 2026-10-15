import React, { useMemo } from 'react';
import {
  B3Signal, MarketTrend, isB3Done, indicatorSignalResult, evaluateB3Readiness, b3Sizing
} from '../../services/b3Signals';
import {
  TrendSignal, trendSignalResult, evaluateTrendReadiness
} from '../../services/trendSignals';
import { TREND_RULES } from '../../services/trendBacktest';
import { fmtBrl, fmtPct, timeAgo, pnlColor } from '../common/format';

export interface B3Info {
  running: boolean;
  lastScanAt: number | null;
  lastError: string | null;
  market: MarketTrend | null;
  trend: { signals: TrendSignal[]; watch: { symbol: string; close: number; high55: number; distancePct: number }[] };
  indicators: { signals: B3Signal[]; scores: { symbol: string; score: number; close: number }[] };
}

const card = 'bg-[#161920] border border-[#23272f] rounded-xl p-4';
const fmtN = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const Waiting: React.FC<{ info: B3Info | null; title: string }> = ({ info, title }) => (
  <div className="space-y-4 pb-24">
    <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
    <p className="text-sm text-amber-300 bg-[#161920] border border-[#23272f] rounded-xl p-3 leading-relaxed">
      {info?.lastError ? `Scanner com erro: ${info.lastError}. ` : ''}
      O scanner da B3 ainda não respondeu. Ele roda no servidor e leva alguns minutos depois de ligar.
    </p>
  </div>
);

const Disclaimer: React.FC = () => (
  <p className="text-xs text-slate-500 leading-relaxed">
    Em validação: só simulação. Sem imposto e corretagem. Dados do Yahoo Finance. Não é recomendação de investimento.
  </p>
);

/** Tendência do mercado (Ibovespa): o filtro que libera ou bloqueia todas as compras. */
export const MarketCard: React.FC<{ info: B3Info }> = ({ info }) => {
  const m = info.market;
  if (!m) return null;
  const color = m.label === 'Alta' ? 'bg-emerald-400' : m.label === 'Baixa' ? 'bg-rose-400' : 'bg-amber-400';
  return (
    <section className={card}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
          <span className="text-base font-semibold text-slate-100">Mercado em {m.label.toLowerCase()}</span>
        </div>
        <span className={`text-sm font-medium tabular-nums ${pnlColor(m.change20dPct)}`}>{fmtPct(m.change20dPct)} <span className="text-xs text-slate-500">em 20 pregões</span></span>
      </div>
      <p className="text-sm text-slate-400 mt-1 leading-relaxed">
        Ibovespa {fmtN(m.close)} pts, {m.bullish ? 'acima' : 'abaixo'} da média de 200 dias ({fmtN(m.sma200)}).
        {m.bullish ? ' Compras liberadas.' : ' Nenhuma compra nova até ele voltar acima.'}
      </p>
    </section>
  );
};

const Header: React.FC<{ title: string; info: B3Info }> = ({ title, info }) => (
  <div className="flex items-center justify-between gap-2">
    <h2 className="text-lg font-semibold text-slate-100">{title} <span className="text-slate-500 font-normal">· Swing, diário</span></h2>
    <span className="text-xs text-slate-400 text-right">{info.lastScanAt ? `atualizado ${timeAgo(info.lastScanAt)}` : 'analisando…'}</span>
  </div>
);

const SizeLine: React.FC<{ capital: number; risk: number; entry: number; stop: number }> = ({ capital, risk, entry, stop }) => {
  const sz = b3Sizing(capital, risk, entry, stop);
  if (!(capital > 0)) return null;
  if (!sz) return <p className="text-xs text-slate-500 mt-2">Com esse capital não cabe nem 1 ação respeitando o risco.</p>;
  return (
    <p className="text-xs text-slate-400 mt-2 leading-relaxed">
      Para {fmtBrl(capital)}: <span className="font-medium text-slate-100">{sz.shares} ações</span> ≈ {fmtBrl(sz.cost)}
      {sz.fractional ? ' (mercado fracionário: ticker com F)' : ''}; se o stop for atingido, perde ≈ {fmtBrl(sz.riskBrl)}.
    </p>
  );
};

// ---------------------------------------------------------------------------
// Sinais (indicadores)
// ---------------------------------------------------------------------------

export const B3SignalsView: React.FC<{ info: B3Info | null; capital: number; riskPercent: number }> = ({ info, capital, riskPercent }) => {
  if (!info || (!info.lastScanAt && !info.running)) return <Waiting info={info} title="Sinais B3" />;
  const active = info.indicators.signals.filter((s) => !isB3Done(s));
  const closedToday = info.indicators.signals.filter(isB3Done).slice(0, 5);
  return (
    <div className="space-y-5 pb-24">
      <Header title="Sinais" info={info} />
      {info.lastError && <p className="text-sm text-amber-300">Erro na última varredura: {info.lastError}</p>}
      <MarketCard info={info} />

      <section>
        <h3 className="text-sm font-medium text-slate-300 mb-2">Compras sugeridas ({active.length})</h3>
        {active.length === 0 ? (
          <p className={`${card} text-sm text-slate-400`}>
            Nenhum sinal agora. É normal passar dias sem sinal.
          </p>
        ) : (
          <div className="space-y-3">
            {active.map((s) => {
              const entry = s.entryPrice ?? s.refPrice;
              const now = s.lastPrice ?? entry;
              const pct = ((now - entry) / entry) * 100;
              const exitNow = s.status === 'EXIT_SIGNAL';
              return (
                <div key={s.id} className={`${card} ${exitNow ? '!border-amber-500/50' : ''}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-base font-semibold text-slate-100">{s.symbol} <span className="text-xs font-normal text-slate-500">pontuação {s.score}</span></span>
                    <span className={`text-base font-semibold tabular-nums ${pnlColor(pct)}`}>{s.entryPrice ? fmtPct(pct) : 'aguardando'}</span>
                  </div>
                  {exitNow && <p className="text-sm text-amber-300 mt-2">Prazo de 20 pregões: venda na abertura do próximo pregão.</p>}
                  <div className="grid grid-cols-3 gap-2 mt-3 text-sm">
                    <div><div className="text-xs text-slate-500">{s.entryPrice ? 'Entrada' : 'Referência'}</div><div className="tabular-nums text-slate-100">{fmtN(entry)}</div></div>
                    <div><div className="text-xs text-slate-500">Stop</div><div className="tabular-nums text-rose-400">{fmtN(s.stopPrice)}</div></div>
                    <div><div className="text-xs text-slate-500">Alvo</div><div className="tabular-nums text-emerald-400">{fmtN(s.targetPrice)}</div></div>
                  </div>
                  {!s.entryPrice && <p className="text-xs text-slate-500 mt-2">A entrada é a abertura do próximo pregão; stop e alvo são ajustados quando ela for conhecida.</p>}
                  <SizeLine capital={capital} risk={riskPercent} entry={entry} stop={s.stopPrice} />
                  <div className="text-xs text-slate-500 mt-2">sinal {timeAgo(s.createdAt)} · prazo máximo 20 pregões</div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-sm font-medium text-slate-300 mb-2">Mais fortes agora</h3>
        <div className={`${card} !p-0 divide-y divide-[#23272f]`}>
          {info.indicators.scores.slice(0, 5).map((r) => (
            <div key={r.symbol} className="flex items-center justify-between px-4 py-3">
              <span className="text-slate-100">{r.symbol}</span>
              <span className="text-sm tabular-nums text-slate-400">
                {fmtN(r.close)} · <span className={r.score >= 60 ? 'text-emerald-400' : 'text-slate-300'}>{r.score} de 100</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      {closedToday.length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-slate-300 mb-2">Encerrados recentes</h3>
          <ClosedList signals={closedToday} />
        </section>
      )}
      <Disclaimer />
    </div>
  );
};

const ClosedList: React.FC<{ signals: B3Signal[] }> = ({ signals }) => (
  <div className={`${card} !p-0 divide-y divide-[#23272f]`}>
    {signals.map((s) => {
      const res = indicatorSignalResult(s);
      const why = s.status === 'STOP' ? 'Stop' : s.status === 'TARGET' ? 'Alvo' : 'Prazo';
      return (
        <div key={s.id} className="px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-sm text-slate-100">{s.symbol} <span className="text-slate-500">· {why}</span></div>
            <div className="text-xs text-slate-500 tabular-nums">{s.entryPrice ? fmtN(s.entryPrice) : '—'} → {s.exitPrice ? fmtN(s.exitPrice) : '—'}</div>
          </div>
          {res && (
            <div className="text-right">
              <div className={`text-sm font-medium tabular-nums ${pnlColor(res.netPct)}`}>{fmtPct(res.netPct)}</div>
              <div className="text-xs text-slate-500">{res.r >= 0 ? '+' : '−'}{Math.abs(res.r).toFixed(1)}R</div>
            </div>
          )}
        </div>
      );
    })}
  </div>
);

// ---------------------------------------------------------------------------
// Tendência (rompimento de 55 dias)
// ---------------------------------------------------------------------------

export const B3TrendView: React.FC<{ info: B3Info | null; capital: number; riskPercent: number }> = ({ info, capital, riskPercent }) => {
  if (!info || (!info.lastScanAt && !info.running)) return <Waiting info={info} title="Tendência B3" />;
  const active = info.trend.signals.filter((s) => s.status === 'OPEN' || s.status === 'EXIT_SIGNAL');
  return (
    <div className="space-y-5 pb-24">
      <Header title="Tendência" info={info} />
      {info.lastError && <p className="text-sm text-amber-300">Erro na última varredura: {info.lastError}</p>}
      <MarketCard info={info} />

      <section>
        <h3 className="text-sm font-medium text-slate-300 mb-2">Posições da estratégia ({active.length})</h3>
        {active.length === 0 ? (
          <p className={`${card} text-sm text-slate-400`}>
            Nenhuma posição aberta. É normal ficar semanas sem sinal.
          </p>
        ) : (
          <div className="space-y-3">
            {active.map((s) => {
              const entry = s.entryPrice ?? s.refPrice;
              const now = s.lastPrice ?? entry;
              const pct = ((now - entry) / entry) * 100;
              const r = (now - entry) / (TREND_RULES.stopAtrMult * s.atr);
              const exitNow = s.status === 'EXIT_SIGNAL';
              return (
                <div key={s.id} className={`${card} ${exitNow ? '!border-amber-500/50' : ''}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-base font-semibold text-slate-100">{s.symbol}</span>
                    <div className="text-right">
                      <div className={`text-base font-semibold tabular-nums ${pnlColor(pct)}`}>{s.entryPrice ? fmtPct(pct) : 'aguardando'}</div>
                      <div className="text-xs text-slate-500">{r >= 0 ? '+' : '−'}{Math.abs(r).toFixed(1)}R</div>
                    </div>
                  </div>
                  {exitNow && <p className="text-sm text-amber-300 mt-2 leading-relaxed">Sair: fechou abaixo da mínima de 20 dias. Venda na abertura do próximo pregão.</p>}
                  <div className="grid grid-cols-3 gap-2 mt-3 text-sm">
                    <div><div className="text-xs text-slate-500">{s.entryPrice ? 'Entrada' : 'Referência'}</div><div className="tabular-nums text-slate-100">{fmtN(entry)}</div></div>
                    <div><div className="text-xs text-slate-500">Stop</div><div className="tabular-nums text-rose-400">{fmtN(s.stopPrice)}</div></div>
                    <div><div className="text-xs text-slate-500">Sair se fechar abaixo de</div><div className="tabular-nums text-amber-300">{fmtN(s.exitLevel)}</div></div>
                  </div>
                  {!s.entryPrice && <p className="text-xs text-slate-500 mt-2">A entrada é a abertura do próximo pregão; o stop é ajustado quando ela for conhecida.</p>}
                  <SizeLine capital={capital} risk={riskPercent} entry={entry} stop={s.stopPrice} />
                  <div className="text-xs text-slate-500 mt-2">sinal {timeAgo(s.createdAt)} · sem alvo fixo</div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-sm font-medium text-slate-300 mb-2">Perto de romper</h3>
        <div className={`${card} !p-0 divide-y divide-[#23272f]`}>
          {info.trend.watch.slice(0, 5).map((w) => (
            <div key={w.symbol} className="flex items-center justify-between px-4 py-3">
              <span className="text-slate-100">{w.symbol}</span>
              <span className="text-sm tabular-nums">
                {w.distancePct <= 0
                  ? <span className="text-emerald-400">acima da máxima de 55 dias</span>
                  : <span className={w.distancePct < 3 ? 'text-amber-300' : 'text-slate-400'}>falta {w.distancePct.toFixed(1)}%</span>}
              </span>
            </div>
          ))}
        </div>
      </section>

      <Disclaimer />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Resultados ao vivo + validação
// ---------------------------------------------------------------------------

export const B3TrackView: React.FC<{ info: B3Info | null; onOpenBacktest: () => void }> = ({ info, onOpenBacktest }) => {
  const tr = useMemo(() => evaluateTrendReadiness(info?.trend.signals ?? []), [info?.trend.signals]);
  const ind = useMemo(() => evaluateB3Readiness(info?.indicators.signals ?? []), [info?.indicators.signals]);
  if (!info) return <Waiting info={info} title="Resultados B3" />;
  const trClosed = info.trend.signals.filter((s) => s.status === 'STOPPED' || s.status === 'CLOSED');
  const indClosed = info.indicators.signals.filter(isB3Done);

  const Ready: React.FC<{ title: string; r: typeof tr }> = ({ title, r }) => (
    <section className={card}>
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold text-slate-100">{title}</span>
        <span className={`w-2.5 h-2.5 rounded-full ${r.status === 'ready' ? 'bg-emerald-400' : r.status === 'failed' ? 'bg-rose-400' : 'bg-amber-400'}`} />
      </div>
      <p className="text-xs text-slate-400 leading-relaxed mt-1">{r.headline}</p>
      <ul className="mt-2 space-y-1">
        {r.checks.map((c) => (
          <li key={c.label} className="flex items-start justify-between gap-3 text-xs">
            <span className={c.ok ? 'text-slate-300' : 'text-slate-500'}>{c.ok ? '✓' : '○'} {c.label}</span>
            <span className="text-slate-400 tabular-nums shrink-0">{c.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="space-y-5 pb-24">
      <Header title="Resultados" info={info} />
      <Ready title="Indicadores" r={ind} />
      <Ready title="Tendência (55 dias)" r={tr} />

      <section>
        <h3 className="text-sm font-medium text-slate-300 mb-2">Indicadores encerrados ({indClosed.length})</h3>
        {indClosed.length === 0 ? <p className={`${card} text-sm text-slate-400`}>Ainda não há operações encerradas.</p> : <ClosedList signals={indClosed} />}
      </section>

      <section>
        <h3 className="text-sm font-medium text-slate-300 mb-2">Tendência encerrados ({trClosed.length})</h3>
        {trClosed.length === 0 ? <p className={`${card} text-sm text-slate-400`}>Ainda não há operações encerradas.</p> : (
          <div className={`${card} !p-0 divide-y divide-[#23272f]`}>
            {trClosed.map((s) => {
              const res = trendSignalResult(s);
              return (
                <div key={s.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm text-slate-100">{s.symbol} <span className="text-slate-500">· {s.status === 'STOPPED' ? 'Stop' : 'Tendência'}</span></div>
                    <div className="text-xs text-slate-500 tabular-nums">{s.entryPrice ? fmtN(s.entryPrice) : '—'} → {s.exitPrice ? fmtN(s.exitPrice) : '—'}</div>
                  </div>
                  {res && (
                    <div className="text-right">
                      <div className={`text-sm font-medium tabular-nums ${pnlColor(res.netPct)}`}>{fmtPct(res.netPct)}</div>
                      <div className="text-xs text-slate-500">{res.r >= 0 ? '+' : '−'}{Math.abs(res.r).toFixed(1)}R</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <button onClick={onOpenBacktest} className="w-full border border-[#2a2f3a] text-slate-200 py-3 rounded-lg text-sm">
        Backtest e Laboratório B3 (comparar com o CDI)
      </button>
    </div>
  );
};

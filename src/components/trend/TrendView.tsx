import React, { useMemo } from 'react';
import { CryptoAsset, PaperAccount } from '../../types/crypto';
import {
  TrendSignal, trendSignalResult, evaluateTrendReadiness, TREND_READINESS
} from '../../services/trendSignals';
import { TREND_RULES } from '../../services/trendBacktest';
import { fmtPrice, fmtPct, timeAgo, pnlColor } from '../common/format';

export interface TrendWatchRow {
  symbol: string;
  baseAsset: string;
  close: number;
  high55: number;
  distancePct: number;
}

export interface TrendInfo {
  running: boolean;
  lastScanAt: number | null;
  lastError: string | null;
  regime: { bullish: boolean; btcClose: number; sma200: number } | null;
  watch: TrendWatchRow[];
  signals: TrendSignal[];
}

interface TrendViewProps {
  trend: TrendInfo | null;
  assets: CryptoAsset[];
  account: PaperAccount;
  onSimulate: (s: TrendSignal) => void;
  onClosePosition: (positionId: string) => void;
  onSelectCoinBySymbol: (symbol: string) => void;
}

const card = 'bg-[#161920] border border-[#23272f] rounded-xl p-4';

export const TrendView: React.FC<TrendViewProps> = ({ trend, assets, account, onSimulate, onClosePosition, onSelectCoinBySymbol }) => {
  const price = useMemo(() => new Map(assets.filter((a) => !a.isDemoData).map((a) => [a.symbol, a.price])), [assets]);
  const readiness = useMemo(() => evaluateTrendReadiness(trend?.signals ?? []), [trend?.signals]);

  const active = (trend?.signals ?? []).filter((s) => s.status === 'OPEN' || s.status === 'EXIT_SIGNAL');
  const closed = (trend?.signals ?? []).filter((s) => s.status === 'STOPPED' || s.status === 'CLOSED');
  const regime = trend?.regime;

  if (!trend || (!trend.lastScanAt && !trend.running)) {
    return (
      <div className="space-y-4 pb-24">
        <h2 className="text-lg font-semibold text-slate-100">Tendência</h2>
        <p className="text-sm text-amber-300 bg-[#161920] border border-[#23272f] rounded-xl p-3 leading-relaxed">
          {trend?.lastError ? `Scanner com erro: ${trend.lastError}. ` : ''}
          O scanner diário ainda não respondeu. Ele roda no servidor e leva alguns minutos depois de ligar.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-24">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-100">Tendência <span className="text-slate-500 font-normal">· Spot, diário</span></h2>
        <span className="text-xs text-slate-400 text-right">
          {trend.lastScanAt ? `atualizado ${timeAgo(trend.lastScanAt)}` : 'analisando…'}
        </span>
      </div>

      {trend.lastError && <p className="text-sm text-amber-300">Erro na última varredura: {trend.lastError}</p>}

      {regime && (
        <section className={card}>
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${regime.bullish ? 'bg-emerald-400' : 'bg-rose-400'}`} />
            <span className="text-base font-semibold text-slate-100">
              {regime.bullish ? 'Entradas liberadas' : 'Entradas bloqueadas'}
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1 leading-relaxed">
            Bitcoin {regime.bullish ? 'acima' : 'abaixo'} da média de {TREND_RULES.btcSmaPeriod} dias
            (${fmtPrice(regime.btcClose)} contra ${fmtPrice(regime.sma200)}).
            {regime.bullish ? '' : ' Nenhuma compra nova até ele voltar acima.'}
          </p>
          <p className="text-xs text-slate-500 mt-2">A vela diária fecha às 21h (horário de Brasília). É quando os sinais aparecem.</p>
        </section>
      )}

      <section>
        <h3 className="text-sm font-medium text-slate-300 mb-2">Posições da estratégia ({active.length})</h3>
        {active.length === 0 ? (
          <p className={`${card} text-sm text-slate-400`}>
            Nenhuma posição aberta. É normal ficar semanas sem sinal: a estratégia dá poucos por mês e só entra em rompimentos fortes.
          </p>
        ) : (
          <div className="space-y-3">
            {active.map((s) => {
              const now = price.get(s.symbol) ?? s.lastPrice ?? s.refPrice;
              const entry = s.entryPrice ?? s.refPrice;
              const pct = ((now - entry) / entry) * 100;
              const r = (now - entry) / (TREND_RULES.stopAtrMult * s.atr);
              const exitNow = s.status === 'EXIT_SIGNAL';
              const pos = account.positions.find((p) => p.symbol === s.symbol && p.status === 'OPEN');
              return (
                <div key={s.id} className={`${card} ${exitNow ? '!border-amber-500/50' : ''}`}>
                  <div className="flex items-center justify-between">
                    <button onClick={() => onSelectCoinBySymbol(s.symbol)} className="text-base font-semibold text-slate-100">{s.baseAsset}</button>
                    <div className="text-right">
                      <div className={`text-base font-semibold tabular-nums ${pnlColor(pct)}`}>{fmtPct(pct)}</div>
                      <div className="text-xs text-slate-500">{r >= 0 ? '+' : '−'}{Math.abs(r).toFixed(1)}R</div>
                    </div>
                  </div>

                  {exitNow && (
                    <p className="text-sm text-amber-300 mt-2 leading-relaxed">
                      Sair: fechou abaixo da mínima de 20 dias. Venda na abertura de hoje.
                    </p>
                  )}

                  <div className="grid grid-cols-3 gap-2 mt-3 text-sm">
                    <div><div className="text-xs text-slate-500">{s.entryPrice ? 'Entrada' : 'Referência'}</div><div className="tabular-nums text-slate-100">{fmtPrice(entry)}</div></div>
                    <div><div className="text-xs text-slate-500">Stop</div><div className="tabular-nums text-rose-400">{fmtPrice(s.stopPrice)}</div></div>
                    <div><div className="text-xs text-slate-500">Sair se fechar abaixo de</div><div className="tabular-nums text-amber-300">{fmtPrice(s.exitLevel)}</div></div>
                  </div>
                  {!s.entryPrice && <p className="text-xs text-slate-500 mt-2">A entrada é a abertura do próximo dia; o stop é ajustado quando ela for conhecida.</p>}

                  <div className="flex items-center justify-between mt-4">
                    <span className="text-xs text-slate-500">sinal {timeAgo(s.createdAt)} · sem alvo fixo</span>
                    {exitNow && pos ? (
                      <button onClick={() => onClosePosition(pos.id)} className="bg-slate-100 text-slate-900 text-sm font-medium px-4 py-2 rounded-lg">Encerrar simulação</button>
                    ) : !pos && !exitNow ? (
                      <button onClick={() => onSimulate(s)} className="bg-slate-100 text-slate-900 text-sm font-medium px-4 py-2 rounded-lg">Simular</button>
                    ) : pos ? (
                      <span className="text-xs text-emerald-400">simulação aberta</span>
                    ) : (
                      <span className="text-xs text-slate-500">sem simulação aberta</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-sm font-medium text-slate-300 mb-2">Perto de romper</h3>
        <div className={`${card} !p-0 divide-y divide-[#23272f]`}>
          {trend.watch.slice(0, 8).map((w) => (
            <button key={w.symbol} onClick={() => onSelectCoinBySymbol(w.symbol)} className="w-full flex items-center justify-between px-4 py-3 text-left">
              <span className="text-slate-100">{w.baseAsset}</span>
              <span className="text-sm tabular-nums">
                {w.distancePct <= 0
                  ? <span className="text-emerald-400">acima da máxima de 55 dias</span>
                  : <span className={w.distancePct < 3 ? 'text-amber-300' : 'text-slate-400'}>falta {w.distancePct.toFixed(1)}%</span>}
              </span>
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-2 leading-relaxed">
          Mostra o quanto cada moeda precisa subir para fechar acima da máxima dos últimos 55 dias. O rompimento só vale se o Bitcoin estiver acima da média de 200 dias.
        </p>
      </section>

      <section>
        <h3 className="text-sm font-medium text-slate-300 mb-2">Encerradas ({closed.length})</h3>
        {closed.length === 0 ? (
          <p className={`${card} text-sm text-slate-400`}>Ainda não há operações encerradas ao vivo.</p>
        ) : (
          <div className={`${card} !p-0 divide-y divide-[#23272f]`}>
            {closed.map((s) => {
              const res = trendSignalResult(s);
              return (
                <div key={s.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm text-slate-100">{s.baseAsset} <span className="text-slate-500">· {s.status === 'STOPPED' ? 'Stop' : 'Tendência'}</span></div>
                    <div className="text-xs text-slate-500 tabular-nums">{s.entryPrice ? fmtPrice(s.entryPrice) : '—'} → {s.exitPrice ? fmtPrice(s.exitPrice) : '—'}</div>
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

      <details className="bg-[#161920] border border-[#23272f] rounded-xl">
        <summary className="cursor-pointer px-4 py-3 flex items-center justify-between text-sm">
          <span className="text-slate-200 font-medium">Pronto para valor real?</span>
          <span className={`w-2.5 h-2.5 rounded-full ${readiness.status === 'ready' ? 'bg-emerald-400' : readiness.status === 'failed' ? 'bg-rose-400' : 'bg-amber-400'}`} />
        </summary>
        <div className="px-4 pb-4 text-sm">
          <p className="text-xs text-slate-400 leading-relaxed">{readiness.headline}</p>
          <ul className="mt-2 space-y-1">
            {readiness.checks.map((c) => (
              <li key={c.label} className="flex items-start justify-between gap-3 text-xs">
                <span className={c.ok ? 'text-slate-300' : 'text-slate-500'}>{c.ok ? '✓' : '○'} {c.label}</span>
                <span className="text-slate-400 tabular-nums shrink-0">{c.detail}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">
            No backtest (17 grandes moedas de 2022, ~4 anos): acerto de cerca de 30%, média de +7,7% por operação e fator de lucro 2,2. Ao vivo,
            espere ao menos {TREND_READINESS.minClosed} operações em 12 semanas antes de comparar. Atingir os critérios não garante lucro futuro.
          </p>
        </div>
      </details>

      <p className="text-xs text-slate-500 leading-relaxed">
        Estratégia de tendência: compra rompimentos de 55 dias com o Bitcoin em alta, stop de 2 ATR, sai quando fecha abaixo da mínima de 20 dias.
        Perde em cerca de 7 de cada 10 operações e ganha nas grandes altas. Não é recomendação de investimento.
      </p>
    </div>
  );
};

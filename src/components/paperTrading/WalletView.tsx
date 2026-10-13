import React, { useState } from 'react';
import { PaperAccount, PaperPosition, CryptoAsset, MarketType } from '../../types/crypto';
import { calculateAccountMetrics, positionUnrealizedPnl } from '../../services/paperTradingService';
import { liquidationPrice } from '../../services/futures';
import { fmtPrice, fmtUsd, fmtPct, pnlColor } from '../common/format';

interface WalletViewProps {
  market: MarketType;
  account: PaperAccount;
  assets: CryptoAsset[];
  onClosePosition: (id: string) => void;
  onResetBalance: () => void;
  onClearHistory: () => void;
  onSelectCoinBySymbol: (symbol: string) => void;
}

const REASON: Record<string, string> = {
  TAKE_PROFIT: 'Alvo',
  STOP_LOSS: 'Stop',
  MANUAL: 'Manual',
  LIQUIDATION: 'Liquidação',
  CANCELLED: 'Cancelada'
};

export function historyToCsv(history: PaperPosition[]): string {
  const head = ['abertura', 'fechamento', 'moeda', 'entrada', 'saida', 'valor_usdt', 'motivo', 'taxas', 'resultado_usdt', 'resultado_pct', 'direcao', 'alavancagem'];
  const rows = history
    .filter((h) => h.closeReason !== 'CANCELLED')
    .map((h) => [
      new Date(h.openTimestamp).toISOString(),
      h.closedTimestamp ? new Date(h.closedTimestamp).toISOString() : '',
      h.symbol, h.entryPrice, h.closePrice ?? '', h.investedUSDT.toFixed(2),
      REASON[h.closeReason || ''] || '', (h.totalFees ?? 0).toFixed(2),
      (h.realizedPnl ?? 0).toFixed(2), (h.realizedPnlPercent ?? 0).toFixed(2),
      h.direction, h.leverage
    ].join(','));
  return [head.join(','), ...rows].join('\n');
}

export const WalletView: React.FC<WalletViewProps> = ({ market, account, assets, onClosePosition, onResetBalance, onClearHistory, onSelectCoinBySymbol }) => {
  const [confirm, setConfirm] = useState<null | 'balance' | 'history'>(null);
  const futures = market === 'futures';
  const metrics = calculateAccountMetrics(account, assets);
  const price = new Map(assets.map((a) => [a.symbol, a.price]));

  const open = account.positions.filter((p) => p.status === 'OPEN');
  const history = (account.closedHistory || []).filter((h) => h.closeReason !== 'CANCELLED');
  const wins = history.filter((h) => (h.realizedPnl || 0) > 0).length;
  const histNet = history.reduce((s, h) => s + (h.realizedPnl || 0), 0);
  const total = metrics.totalEquity - account.initialBalance;

  const exportCsv = () => {
    const blob = new Blob([historyToCsv(account.closedHistory || [])], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cryptoradar-historico-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const card = 'bg-[#161920] border border-[#23272f] rounded-xl';

  return (
    <div className="space-y-5 pb-24">
      <h2 className="text-lg font-semibold text-slate-100">
        Carteira simulada <span className="text-slate-500 font-normal">· {futures ? 'Futuros' : 'Spot'}</span>
      </h2>

      <div className={`${card} p-4`}>
        <div className="text-sm text-slate-400">Patrimônio</div>
        <div className="text-3xl font-semibold text-slate-100 tabular-nums">{fmtUsd(metrics.totalEquity)}</div>
        <div className={`text-sm mt-1 ${pnlColor(total)}`}>
          {fmtUsd(total, true)} ({fmtPct((total / account.initialBalance) * 100)}) desde o início
        </div>
        <div className="text-sm text-slate-400 mt-3">Saldo livre {fmtUsd(metrics.virtualBalance)}</div>
      </div>

      <section>
        <h3 className="text-sm font-medium text-slate-300 mb-2">Posições abertas ({open.length})</h3>
        {open.length === 0 ? (
          <p className={`${card} p-4 text-sm text-slate-400`}>Nenhuma posição aberta. Toque em “Simular” em um sinal para começar.</p>
        ) : (
          <div className="space-y-3">
            {open.map((p) => {
              const now = price.get(p.symbol) || p.currentPrice || p.entryPrice;
              const { pnl, pct } = positionUnrealizedPnl(p, now);
              const isShort = p.direction === 'SHORT';
              return (
                <div key={p.id} className={`${card} p-4`}>
                  <div className="flex items-center justify-between">
                    <button onClick={() => onSelectCoinBySymbol(p.symbol)} className="text-base font-semibold text-slate-100 text-left">
                      {p.symbol.replace('USDT', '')}
                      {futures && (
                        <span className={`ml-2 text-xs font-medium ${isShort ? 'text-rose-400' : 'text-emerald-400'}`}>
                          {isShort ? 'Short' : 'Long'} {p.leverage}x
                        </span>
                      )}
                    </button>
                    <div className="text-right">
                      <div className={`text-base font-semibold tabular-nums ${pnlColor(pnl)}`}>{fmtUsd(pnl, true)}</div>
                      <div className={`text-xs ${pnlColor(pnl)}`}>{fmtPct(pct)}</div>
                    </div>
                  </div>
                  <div className={`grid ${futures ? 'grid-cols-3' : 'grid-cols-4'} gap-2 mt-3 text-sm`}>
                    {[
                      ['Entrada', p.entryPrice, ''],
                      ['Agora', now, ''],
                      ...(futures ? [['Liquidação', liquidationPrice(p.direction, p.entryPrice, p.leverage), 'text-amber-300']] : []),
                      ['Stop', p.stopLossPrice, 'text-rose-400'],
                      ['Alvo', p.targetPrice, 'text-emerald-400']
                    ].map(([l, v, c]) => (
                      <div key={l as string}>
                        <div className="text-xs text-slate-500">{l}</div>
                        <div className={`tabular-nums ${c || 'text-slate-200'}`}>{v ? fmtPrice(v as number) : '—'}</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-xs text-slate-500">{fmtUsd(p.investedUSDT)} {futures ? `de margem · posição ${fmtUsd(p.investedUSDT * p.leverage)}` : 'investidos'}</span>
                    <button onClick={() => onClosePosition(p.id)} className="border border-[#2a2f3a] text-slate-200 text-sm px-4 py-2 rounded-lg">
                      Encerrar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-slate-300">Histórico ({history.length})</h3>
          {history.length > 0 && (
            <button onClick={exportCsv} className="text-sm text-slate-300 underline underline-offset-4">Exportar CSV</button>
          )}
        </div>

        {history.length === 0 ? (
          <p className={`${card} p-4 text-sm text-slate-400`}>As operações encerradas ficam registradas aqui, mesmo se você zerar o saldo.</p>
        ) : (
          <>
            <p className="text-sm text-slate-400 mb-2">
              {wins} de {history.length} no lucro ({((wins / history.length) * 100).toFixed(0)}%) ·{' '}
              <span className={pnlColor(histNet)}>{fmtUsd(histNet, true)}</span> no total
            </p>
            <div className={`${card} divide-y divide-[#23272f]`}>
              {history.map((h) => {
                const pnl = h.realizedPnl || 0;
                return (
                  <div key={h.id} className="px-4 py-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm text-slate-100">
                        {h.symbol.replace('USDT', '')}
                        {futures && <span className={h.direction === 'SHORT' ? 'text-rose-400' : 'text-emerald-400'}> {h.direction === 'SHORT' ? 'Short' : 'Long'} {h.leverage}x</span>}
                        <span className={h.closeReason === 'LIQUIDATION' ? 'text-rose-400' : 'text-slate-500'}> · {REASON[h.closeReason || ''] || ''}</span>
                      </div>
                      <div className="text-xs text-slate-500 tabular-nums">
                        {fmtPrice(h.entryPrice)} → {h.closePrice ? fmtPrice(h.closePrice) : '—'} ·{' '}
                        {new Date(h.closedTimestamp || h.openTimestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-sm font-medium tabular-nums ${pnlColor(pnl)}`}>{fmtUsd(pnl, true)}</div>
                      <div className={`text-xs ${pnlColor(pnl)}`}>{fmtPct(h.realizedPnlPercent || 0)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      <details className="text-sm">
        <summary className="cursor-pointer text-slate-400">Mais opções</summary>
        <div className="mt-3 space-y-3">
          {confirm ? (
            <div className={`${card} p-4`}>
              <p className="text-slate-200 mb-3">
                {confirm === 'balance'
                  ? 'Zerar o saldo para $10.000 e fechar posições abertas? O histórico é mantido.'
                  : 'Apagar todo o histórico de operações? Isso não pode ser desfeito.'}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => { confirm === 'balance' ? onResetBalance() : onClearHistory(); setConfirm(null); }}
                  className="bg-rose-500 text-white px-4 py-2 rounded-lg"
                >
                  Confirmar
                </button>
                <button onClick={() => setConfirm(null)} className="border border-[#2a2f3a] text-slate-200 px-4 py-2 rounded-lg">Cancelar</button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => setConfirm('balance')} className="border border-[#2a2f3a] text-slate-200 px-4 py-2 rounded-lg">Zerar saldo</button>
              {history.length > 0 && (
                <button onClick={() => setConfirm('history')} className="border border-[#2a2f3a] text-rose-400 px-4 py-2 rounded-lg">Apagar histórico</button>
              )}
            </div>
          )}
          <p className="text-xs text-slate-500 leading-relaxed">
            Simulação com taxa de 0,05% por operação{futures ? ', margem isolada e liquidação a 0,5% de manutenção. Não inclui funding' : ''}. O histórico fica salvo neste navegador/aparelho.
          </p>
        </div>
      </details>
    </div>
  );
};

import React, { useState } from 'react';
import { PaperAccount, PaperPosition, CryptoAsset, MarketType } from '../../types/crypto';
import { calculateAccountMetrics, positionUnrealizedPnl } from '../../services/paperTradingService';
import { liquidationPrice } from '../../services/futures';
import { fmtPrice, fmtUsd, fmtPct, pnlColor } from '../common/format';
import { SyncNotice } from '../common/SyncNotice';
import { SyncStatus, StorageInfo } from '../../services/remoteState';

interface WalletViewProps {
  sync?: { status: SyncStatus; info: StorageInfo | null; blocked: boolean; detail?: string | null };
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

export const WalletView: React.FC<WalletViewProps> = ({ sync, market, account, assets, onClosePosition, onResetBalance, onClearHistory, onSelectCoinBySymbol }) => {
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

  const card = 'bg-[#10192A] border border-[#1E293B] rounded-xl shadow-sm';

  return (
    <div className="space-y-5 pb-24 text-[#F1F5F9]">
      <h2 className="text-lg font-semibold text-[#F1F5F9]">
        Carteira simulada <span className="text-[#64748B] font-normal">· {futures ? 'Futuros' : 'Spot'}</span>
      </h2>

      {sync && <SyncNotice status={sync.status} info={sync.info} blocked={sync.blocked} detail={sync.detail} />}

      <div className={`${card} p-4`}>
        <div className="text-sm text-[#94A3B8]">Patrimônio</div>
        <div className="text-3xl font-semibold text-[#F1F5F9] tabular-nums">{fmtUsd(metrics.totalEquity)}</div>
        <div className={`text-sm mt-1 ${pnlColor(total)}`}>
          {fmtUsd(total, true)} ({fmtPct((total / account.initialBalance) * 100)}) desde o início
        </div>
        <div className="text-sm text-[#94A3B8] mt-3">Saldo livre {fmtUsd(metrics.virtualBalance)}</div>
      </div>

      <section>
        <h3 className="text-sm font-medium text-[#94A3B8] mb-2">Posições abertas ({open.length})</h3>
        {open.length === 0 ? (
          <p className={`${card} p-4 text-sm text-[#94A3B8]`}>Nenhuma posição aberta. Toque em “Simular” em um sinal para começar.</p>
        ) : (
          <div className="space-y-3">
            {open.map((p) => {
              const now = price.get(p.symbol) || p.currentPrice || p.entryPrice;
              const { pnl, pct } = positionUnrealizedPnl(p, now);
              const isShort = p.direction === 'SHORT';
              return (
                <div key={p.id} className={`${card} p-4`}>
                  <div className="flex items-center justify-between">
                    <button onClick={() => onSelectCoinBySymbol(p.symbol)} className="text-base font-semibold text-[#F1F5F9] text-left hover:text-[#F5AC37] transition-colors cursor-pointer">
                      {p.symbol.replace('USDT', '')}
                      {futures && (
                        <span className={`ml-2 text-xs font-medium ${isShort ? 'text-[#F43F5E]' : 'text-[#10B981]'}`}>
                          {isShort ? 'Short' : 'Long'} {p.leverage}x
                        </span>
                      )}
                    </button>
                    <div className="text-right">
                      <div className={`text-base font-semibold tabular-nums ${pnlColor(pnl)}`}>{fmtUsd(pnl, true)}</div>
                      <div className={`text-xs ${pnlColor(pnl)}`}>{fmtPct(pct)}</div>
                    </div>
                  </div>
                  <div className={`grid ${futures ? 'grid-cols-3' : 'grid-cols-4'} gap-2 mt-3 text-sm bg-[#0A0F1D] border border-[#1E293B]/70 rounded-lg p-2.5`}>
                    {[
                      ['Entrada', p.entryPrice, ''],
                      ['Agora', now, ''],
                      ...(futures ? [['Liquidação', liquidationPrice(p.direction, p.entryPrice, p.leverage), 'text-[#F5AC37]']] : []),
                      ['Stop', p.stopLossPrice, 'text-[#F43F5E]'],
                      ['Alvo', p.targetPrice, 'text-[#10B981]']
                    ].map(([l, v, c]) => (
                      <div key={l as string}>
                        <div className="text-xs text-[#64748B]">{l}</div>
                        <div className={`tabular-nums ${c || 'text-[#F1F5F9]'}`}>{v ? fmtPrice(v as number) : '—'}</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-xs text-[#64748B]">{fmtUsd(p.investedUSDT)} {futures ? `de margem · posição ${fmtUsd(p.investedUSDT * p.leverage)}` : 'investidos'}</span>
                    <button onClick={() => onClosePosition(p.id)} className="border border-[#1E293B] bg-[#0A0F1D] text-[#F1F5F9] hover:bg-[#1E293B] text-sm px-4 py-2 rounded-lg cursor-pointer transition-colors">
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
          <h3 className="text-sm font-medium text-[#94A3B8]">Histórico ({history.length})</h3>
          {history.length > 0 && (
            <button onClick={exportCsv} className="text-sm text-[#94A3B8] hover:text-[#F1F5F9] underline underline-offset-4 cursor-pointer">Exportar CSV</button>
          )}
        </div>

        {history.length === 0 ? (
          <p className={`${card} p-4 text-sm text-[#94A3B8]`}>As operações encerradas ficam registradas aqui, mesmo se você zerar o saldo.</p>
        ) : (
          <>
            <p className="text-sm text-[#94A3B8] mb-2">
              {wins} de {history.length} no lucro ({((wins / history.length) * 100).toFixed(0)}%) ·{' '}
              <span className={pnlColor(histNet)}>{fmtUsd(histNet, true)}</span> no total
            </p>
            <div className={`${card} divide-y divide-[#1E293B]`}>
              {history.map((h) => {
                const pnl = h.realizedPnl || 0;
                return (
                  <div key={h.id} className="px-4 py-3 flex items-center justify-between hover:bg-[#141F36]/30 transition-colors">
                    <div>
                      <div className="text-sm text-[#F1F5F9]">
                        {h.symbol.replace('USDT', '')}
                        {futures && <span className={h.direction === 'SHORT' ? 'text-[#F43F5E]' : 'text-[#10B981]'}> {h.direction === 'SHORT' ? 'Short' : 'Long'} {h.leverage}x</span>}
                        <span className={h.closeReason === 'LIQUIDATION' ? 'text-[#F43F5E]' : 'text-[#64748B]'}> · {REASON[h.closeReason || ''] || ''}</span>
                      </div>
                      <div className="text-xs text-[#64748B] tabular-nums">
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
        <summary className="cursor-pointer text-[#94A3B8] hover:text-[#F1F5F9]">Mais opções</summary>
        <div className="mt-3 space-y-3">
          {confirm ? (
            <div className={`${card} p-4`}>
              <p className="text-[#F1F5F9] mb-3">
                {confirm === 'balance'
                  ? 'Zerar o saldo para $10.000 e fechar posições abertas? O histórico é mantido.'
                  : 'Apagar todo o histórico de operações? Isso não pode ser desfeito.'}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => { confirm === 'balance' ? onResetBalance() : onClearHistory(); setConfirm(null); }}
                  className="bg-[#F43F5E] hover:bg-[#e11d48] text-white px-4 py-2 rounded-lg cursor-pointer transition-colors"
                >
                  Confirmar
                </button>
                <button onClick={() => setConfirm(null)} className="border border-[#1E293B] bg-[#0A0F1D] text-[#F1F5F9] px-4 py-2 rounded-lg cursor-pointer">Cancelar</button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => setConfirm('balance')} className="border border-[#1E293B] bg-[#0A0F1D] text-[#F1F5F9] hover:bg-[#1E293B] px-4 py-2 rounded-lg cursor-pointer transition-colors">Zerar saldo</button>
              {history.length > 0 && (
                <button onClick={() => setConfirm('history')} className="border border-[#1E293B] bg-[#0A0F1D] text-[#F43F5E] hover:bg-[#1E293B] px-4 py-2 rounded-lg cursor-pointer transition-colors">Apagar histórico</button>
              )}
            </div>
          )}
          <p className="text-xs text-[#64748B] leading-relaxed">
            Simulação com taxa de 0,05% por operação{futures ? ', margem isolada e liquidação a 0,5% de manutenção. Não inclui funding' : ''}. O histórico fica salvo neste navegador/aparelho.
          </p>
        </div>
      </details>
    </div>
  );
};

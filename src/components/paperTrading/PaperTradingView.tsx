import React, { useState } from 'react';
import { Wallet, Plus, RotateCcw, ArrowUpRight, ArrowDownRight, CheckCircle2, XCircle, TrendingUp, Clock, Ban, ShieldCheck } from 'lucide-react';
import { PaperAccount, PaperPosition, CryptoAsset } from '../../types/crypto';
import { Badge } from '../common/Badge';
import { calculateAccountMetrics } from '../../services/paperTradingService';

interface PaperTradingViewProps {
  account: PaperAccount;
  assets: CryptoAsset[];
  onOpenNewTradeModal: () => void;
  onClosePosition: (positionId: string) => void;
  onCancelPendingOrder: (positionId: string) => void;
  onResetAccount: () => void;
  onSelectCoinBySymbol: (symbol: string) => void;
}

export const PaperTradingView: React.FC<PaperTradingViewProps> = ({
  account,
  assets,
  onOpenNewTradeModal,
  onClosePosition,
  onCancelPendingOrder,
  onResetAccount,
  onSelectCoinBySymbol
}) => {
  const [activeTab, setActiveTab] = useState<'positions' | 'pending' | 'history'>('positions');

  // Mapa de preços atuais atualizados
  const priceMap = new Map<string, number>();
  assets.forEach((a) => priceMap.set(a.symbol, a.price));

  // Separa posições abertas ativas de ordens limites pendentes
  const openPositions = account.positions.filter((p) => p.status === 'OPEN');
  const pendingOrders = account.positions.filter((p) => p.status === 'PENDING');

  // Métricas contábeis auditadas
  const metrics = calculateAccountMetrics(account, assets);

  // Posições abertas enriquecidas com preços ao vivo
  const enrichedOpenPositions = openPositions.map((pos) => {
    const livePrice = priceMap.get(pos.symbol) || pos.currentPrice || pos.entryPrice;
    const priceDiff = pos.direction === 'LONG' ? livePrice - pos.entryPrice : pos.entryPrice - livePrice;
    const percentDiff = (priceDiff / pos.entryPrice) * pos.leverage;
    const grossPnl = pos.investedUSDT * percentDiff;
    const openFee = pos.openFee || Number((pos.investedUSDT * pos.leverage * 0.0005).toFixed(4));
    const estimatedCloseFee = Number(((pos.amount * livePrice) * 0.0005).toFixed(4));
    const netPnl = grossPnl - openFee - estimatedCloseFee;

    return {
      ...pos,
      currentPrice: livePrice,
      openFee,
      estimatedCloseFee,
      grossPnl,
      unrealizedPnl: Number(netPnl.toFixed(2)),
      unrealizedPnlPercent: Number(((netPnl / pos.investedUSDT) * 100).toFixed(2))
    };
  });

  const totalEquity = metrics.totalEquity;
  const totalUnrealizedPnl = metrics.unrealizedNetPnl;
  const winRate = metrics.winRatePercent.toFixed(0);

  return (
    <div className="space-y-4 pb-24">
      {/* Header do Portfólio Virtual */}
      <div className="bg-gradient-to-b from-[#131926] to-[#0F141F] border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xl relative overflow-hidden">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Wallet className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">
                Patrimônio Total Simulado
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black font-mono text-white tracking-tight">
                  ${totalEquity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-xs text-slate-400 font-mono">USDT</span>
              </div>
            </div>
          </div>

          <Badge variant="demo" size="sm">PAPER DEMO</Badge>
        </div>

        {/* Detalhes de Saldo, Margem, PnL e Taxas de Corretagem */}
        <div className="grid grid-cols-5 gap-1 mt-4 pt-3 border-t border-slate-800/80 text-[10px] font-mono">
          <div>
            <span className="text-[9px] text-slate-500 uppercase block font-sans">Saldo Livre</span>
            <span className="text-slate-200 font-bold truncate block">
              ${account.virtualBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          <div>
            <span className="text-[9px] text-slate-500 uppercase block font-sans">Margem Reserv.</span>
            <span className="text-cyan-400 font-bold truncate block">
              ${metrics.totalReservedMargin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          <div>
            <span className="text-[9px] text-slate-500 uppercase block font-sans">PnL Líquido</span>
            <span className={`font-bold flex items-center gap-0.5 truncate ${totalUnrealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {totalUnrealizedPnl >= 0 ? '+' : ''}${totalUnrealizedPnl.toFixed(2)}
            </span>
          </div>

          <div>
            <span className="text-[9px] text-slate-500 uppercase block font-sans">Taxas Totais</span>
            <span className="text-amber-400 font-bold truncate block">
              ${(account.totalFeesPaid || 0).toFixed(2)}
            </span>
          </div>

          <div>
            <span className="text-[9px] text-slate-500 uppercase block font-sans">Taxa Acerto</span>
            <span className="text-emerald-400 font-bold truncate block">
              {winRate}%
            </span>
          </div>
        </div>

        {/* Botões de Ação do Header */}
        <div className="grid grid-cols-2 gap-2 mt-4">
          <button
            onClick={onOpenNewTradeModal}
            className="w-full bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] text-slate-950 font-bold py-2.5 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/20 transition"
          >
            <Plus className="w-4 h-4" />
            Nova Operação
          </button>

          <button
            onClick={() => {
              if (window.confirm('Deseja resetar a conta de Paper Trading para $10,000 USDT? As posições atuais serão limpas.')) {
                onResetAccount();
              }
            }}
            className="w-full bg-slate-900 hover:bg-slate-800 active:scale-[0.98] text-slate-300 hover:text-white border border-slate-800 py-2.5 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Resetar Saldo
          </button>
        </div>
      </div>

      {/* Abas: Posições Abertas vs Ordens Limite Pendentes vs Histórico */}
      <div className="flex items-center gap-1 bg-[#121722] border border-slate-800 rounded-2xl p-1">
        <button
          onClick={() => setActiveTab('positions')}
          className={`flex-1 py-2 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1 ${
            activeTab === 'positions'
              ? 'bg-slate-800 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>Abertas</span>
          <span className="text-[10px] bg-slate-900 px-1.5 py-0.5 rounded-full font-mono text-emerald-400">
            {enrichedOpenPositions.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('pending')}
          className={`flex-1 py-2 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1 ${
            activeTab === 'pending'
              ? 'bg-slate-800 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>Pendentes</span>
          <span className="text-[10px] bg-slate-900 px-1.5 py-0.5 rounded-full font-mono text-cyan-400">
            {pendingOrders.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('history')}
          className={`flex-1 py-2 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1 ${
            activeTab === 'history'
              ? 'bg-slate-800 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>Histórico</span>
          <span className="text-[10px] bg-slate-900 px-1.5 py-0.5 rounded-full font-mono text-slate-400">
            {account.closedHistory.length}
          </span>
        </button>
      </div>

      {/* 1. Aba: Posições Abertas (Preenchidas e ativas) */}
      {activeTab === 'positions' && (
        <div className="space-y-2.5">
          {enrichedOpenPositions.length === 0 ? (
            <div className="bg-[#121722] border border-slate-800 rounded-2xl p-8 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 mx-auto flex items-center justify-center text-slate-500">
                <TrendingUp className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Nenhuma posição aberta no momento</h4>
                <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                  Execute uma ordem a mercado ou aguarde a execução de suas ordens a limite pendentes.
                </p>
              </div>
              <button
                onClick={onOpenNewTradeModal}
                className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-4 py-2 rounded-xl text-xs inline-flex items-center gap-1.5 shadow-md shadow-emerald-500/20"
              >
                <Plus className="w-4 h-4" />
                Criar Nova Operação Demo
              </button>
            </div>
          ) : (
            enrichedOpenPositions.map((pos) => {
              const isProfit = (pos.unrealizedPnl || 0) >= 0;
              const isLong = pos.direction === 'LONG';

              return (
                <div
                  key={pos.id}
                  className="bg-[#121722] border border-slate-800/90 rounded-2xl p-3.5 space-y-2.5 transition"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded-lg ${
                          isLong
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                        }`}
                      >
                        {isLong ? 'LONG' : 'SHORT'} {pos.leverage}x
                      </span>
                      <button
                        onClick={() => onSelectCoinBySymbol(pos.symbol)}
                        className="text-sm font-bold text-white hover:text-emerald-400 transition"
                      >
                        {pos.symbol}
                      </button>
                      <span className="text-[10px] bg-slate-900 text-slate-400 border border-slate-800 px-1.5 py-0.5 rounded font-mono">
                        {pos.orderType}
                      </span>
                    </div>

                    {/* PnL Líquido Não Realizado */}
                    <div className="text-right">
                      <span
                        className={`text-sm font-bold font-mono ${
                          isProfit ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {isProfit ? '+' : ''}${pos.unrealizedPnl?.toFixed(2)}
                      </span>
                      <span
                        className={`text-[10px] block font-mono ${
                          isProfit ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        ({isProfit ? '+' : ''}{pos.unrealizedPnlPercent?.toFixed(2)}%)
                      </span>
                    </div>
                  </div>

                  {/* Detalhes da Posição */}
                  <div className="grid grid-cols-3 gap-1 pt-2 border-t border-slate-800/80 text-[11px] font-mono">
                    <div>
                      <span className="text-[9px] text-slate-500 block">Preço Entrada</span>
                      <span className="text-slate-300">${pos.entryPrice.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-500 block">Preço Atual</span>
                      <span className="text-white">${pos.currentPrice.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-500 block">Margem Investida</span>
                      <span className="text-slate-300">${pos.investedUSDT.toFixed(0)}</span>
                    </div>
                  </div>

                  {/* TP, SL & Taxas da Posição */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-slate-400">
                    <div className="flex items-center gap-2">
                      {pos.targetPrice && (
                        <span>TP: <strong className="text-emerald-400">${pos.targetPrice.toLocaleString()}</strong></span>
                      )}
                      {pos.stopLossPrice && (
                        <span>SL: <strong className="text-rose-400">${pos.stopLossPrice.toLocaleString()}</strong></span>
                      )}
                    </div>
                    <span className="text-amber-400">
                      Taxa aber: ${(pos.openFee || 0).toFixed(2)} | est. saída: ${(pos.estimatedCloseFee || 0).toFixed(2)}
                    </span>
                  </div>

                  {/* Ação: Encerrar Posição */}
                  <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                    <span className="text-[10px] text-slate-500 font-mono">
                      Qtd: {pos.amount.toFixed(4)} • Exposição: ${(pos.investedUSDT * pos.leverage).toFixed(0)}
                    </span>
                    <button
                      onClick={() => onClosePosition(pos.id)}
                      className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-rose-500/20 text-slate-300 hover:text-rose-400 border border-slate-800 text-xs font-semibold transition"
                    >
                      Encerrar a Mercado
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* 2. Aba: Ordens Limite Pendentes (Aguardando preço atingir limite) */}
      {activeTab === 'pending' && (
        <div className="space-y-2.5">
          {pendingOrders.length === 0 ? (
            <div className="bg-[#121722] border border-slate-800 rounded-2xl p-8 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 mx-auto flex items-center justify-center text-slate-500">
                <Clock className="w-6 h-6 text-cyan-400" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Nenhuma ordem limite pendente</h4>
                <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                  Ordens a limite só são abertas quando a cotação de mercado atinge exatamente o valor estipulado.
                </p>
              </div>
            </div>
          ) : (
            pendingOrders.map((pos) => {
              const livePrice = priceMap.get(pos.symbol) || pos.currentPrice;
              const targetLimit = pos.limitPrice || pos.entryPrice;
              const isLong = pos.direction === 'LONG';
              const distPercent = Math.abs(((livePrice - targetLimit) / livePrice) * 100);

              return (
                <div
                  key={pos.id}
                  className="bg-[#121722] border border-cyan-500/30 rounded-2xl p-3.5 space-y-2.5 transition"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded-lg ${
                          isLong
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                        }`}
                      >
                        LIMIT {isLong ? 'LONG' : 'SHORT'} {pos.leverage}x
                      </span>
                      <button
                        onClick={() => onSelectCoinBySymbol(pos.symbol)}
                        className="text-sm font-bold text-white hover:text-emerald-400 transition"
                      >
                        {pos.symbol}
                      </button>
                    </div>

                    <span className="text-[11px] font-mono text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-md border border-cyan-500/30 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> AGUARDANDO GATILHO
                    </span>
                  </div>

                  {/* Informações da Ordem Limite */}
                  <div className="grid grid-cols-3 gap-1 pt-2 border-t border-slate-800/80 text-[11px] font-mono">
                    <div>
                      <span className="text-[9px] text-slate-500 block">Preço Limite</span>
                      <span className="text-cyan-300 font-bold">${targetLimit.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-500 block">Preço Atual</span>
                      <span className="text-white">${livePrice.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-500 block">Distância</span>
                      <span className="text-amber-400">{distPercent.toFixed(2)}% restante</span>
                    </div>
                  </div>

                  {/* Condição de Disparo */}
                  <div className="bg-slate-900/90 rounded-xl p-2 text-[10px] text-slate-400 flex items-center justify-between border border-slate-800">
                    <span>
                      Gatilho: Executará quando o preço{' '}
                      <strong className="text-slate-200">
                        {isLong ? `<= $${targetLimit.toLocaleString()}` : `>= $${targetLimit.toLocaleString()}`}
                      </strong>
                    </span>
                    <span className="text-slate-500 font-mono">Margem Reservada: ${pos.investedUSDT.toFixed(0)}</span>
                  </div>

                  {/* Ação: Cancelar Ordem Limite */}
                  <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                    <span className="text-[10px] text-slate-500 font-mono">
                      Taxa reservada: ${(pos.openFee || 0).toFixed(2)}
                    </span>
                    <button
                      onClick={() => onCancelPendingOrder(pos.id)}
                      className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-amber-400 hover:text-amber-300 border border-amber-500/30 text-xs font-semibold flex items-center gap-1 transition"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      Cancelar Ordem Limite
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* 3. Aba: Histórico de Ordens Fechadas e Canceladas */}
      {activeTab === 'history' && (
        <div className="space-y-2">
          {account.closedHistory.length === 0 ? (
            <div className="bg-[#121722] border border-slate-800 rounded-2xl p-8 text-center text-slate-400 text-xs">
              Nenhuma ordem fechada ainda. Quando você encerrar uma posição, o resultado contábil aparecerá aqui.
            </div>
          ) : (
            account.closedHistory.map((closed) => {
              const isProfit = (closed.realizedPnl || 0) > 0;
              const isCancelled = closed.closeReason === 'CANCELLED';

              return (
                <div
                  key={closed.id}
                  className="bg-[#121722] border border-slate-800/80 rounded-2xl p-3 flex items-center justify-between"
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-7 h-7 rounded-xl flex items-center justify-center ${
                        isCancelled
                          ? 'bg-slate-800 text-slate-400 border border-slate-700'
                          : isProfit
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                      }`}
                    >
                      {isCancelled ? (
                        <Ban className="w-4 h-4" />
                      ) : isProfit ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : (
                        <XCircle className="w-4 h-4" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-white">{closed.symbol}</span>
                        <span className="text-[10px] text-slate-400">({closed.direction})</span>
                        {closed.closeReason === 'TAKE_PROFIT' && (
                          <span className="text-[9px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.2 rounded font-semibold">
                            TP ATINGIDO
                          </span>
                        )}
                        {closed.closeReason === 'STOP_LOSS' && (
                          <span className="text-[9px] bg-rose-500/15 text-rose-400 border border-rose-500/30 px-1.5 py-0.2 rounded font-semibold">
                            STOP LOSS
                          </span>
                        )}
                        {closed.closeReason === 'CANCELLED' && (
                          <span className="text-[9px] bg-slate-800 text-slate-300 border border-slate-700 px-1.5 py-0.2 rounded font-semibold">
                            ORDEM CANCELADA
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono block mt-0.5">
                        {isCancelled
                          ? `Limite: $${closed.entryPrice.toLocaleString()} • Margem devolvida integralmente`
                          : `Entrada: $${closed.entryPrice.toLocaleString()} • Saída: $${closed.closePrice?.toLocaleString()} • Taxas: $${(closed.totalFees || 0).toFixed(2)}`}
                      </span>
                    </div>
                  </div>

                  <div className="text-right">
                    {isCancelled ? (
                      <span className="text-xs font-mono text-slate-400 font-semibold">$0.00</span>
                    ) : (
                      <>
                        <span
                          className={`text-xs font-bold font-mono ${
                            isProfit ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {isProfit ? '+' : ''}${closed.realizedPnl?.toFixed(2)}
                        </span>
                        <span
                          className={`text-[10px] block font-mono ${
                            isProfit ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          ({isProfit ? '+' : ''}{closed.realizedPnlPercent?.toFixed(2)}%)
                        </span>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

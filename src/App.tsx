/**
 * CryptoRadar - Plataforma Mobile-First de Análise de Criptomoedas
 * Versão 1.0 (DEMO)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CryptoAsset, TechnicalSignal, PaperAccount, AppSettings, PaperPosition } from './types/crypto';
import { INITIAL_ASSETS, INITIAL_SIGNALS } from './services/mockData';
import { StorageService } from './services/storageService';
import { apiService } from './services/apiService';

// Layout & Navegação
import { Header } from './components/layout/Header';
import { BottomNav, ScreenTab } from './components/layout/BottomNav';
import { DisclaimerBanner } from './components/common/DisclaimerBanner';

// Telas
import { DashboardView } from './components/dashboard/DashboardView';
import { MarketView } from './components/market/MarketView';
import { CoinDetailsView } from './components/details/CoinDetailsView';
import { PaperTradingView } from './components/paperTrading/PaperTradingView';
import { SignalsView } from './components/signals/SignalsView';
import { SettingsView } from './components/settings/SettingsView';

// Modais
import { NewTradeModal } from './components/paperTrading/NewTradeModal';

export default function App() {
  const [activeTab, setActiveTab] = useState<ScreenTab>('dashboard');
  const [assets, setAssets] = useState<CryptoAsset[]>(INITIAL_ASSETS);
  const [signals] = useState<TechnicalSignal[]>(INITIAL_SIGNALS);
  const [selectedCoin, setSelectedCoin] = useState<CryptoAsset>(INITIAL_ASSETS[0]);
  const [tradeModalOpen, setTradeModalOpen] = useState(false);
  const [tradeModalCoin, setTradeModalCoin] = useState<CryptoAsset>(INITIAL_ASSETS[0]);

  // Conta simulada (Paper Trading) e Configurações salvas
  const [paperAccount, setPaperAccount] = useState<PaperAccount>(() => StorageService.getPaperAccount());
  const [settings, setSettings] = useState<AppSettings>(() => StorageService.getSettings());

  // Estado de conexão e carregamento
  const [isFetching, setIsFetching] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [isMobileFrame, setIsMobileFrame] = useState(false);

  // Prevenção estrita de requisições concorrentes
  const isUpdatingRef = useRef(false);

  // Salva conta de paper trading no localStorage quando alterada
  const updatePaperAccount = useCallback((newAccount: PaperAccount) => {
    setPaperAccount(newAccount);
    StorageService.savePaperAccount(newAccount);
  }, []);

  // Verificação e execução de ordens LIMIT pendentes, Stop-Loss e Take-Profit
  const checkTriggers = useCallback((currentAssets: CryptoAsset[], currentAcc: PaperAccount): PaperAccount => {
    if (!currentAcc.positions || currentAcc.positions.length === 0) return currentAcc;

    const priceMap = new Map<string, number>();
    currentAssets.forEach((a) => priceMap.set(a.symbol, a.price));

    let updatedBalance = currentAcc.virtualBalance;
    let totalFees = currentAcc.totalFeesPaid || 0;
    let totalTradesCount = currentAcc.totalTrades || 0;
    let wins = currentAcc.winTrades;
    let losses = currentAcc.lossTrades;
    const remainingPositions: PaperPosition[] = [];
    const newClosed: PaperPosition[] = [...currentAcc.closedHistory];
    let changed = false;

    for (const pos of currentAcc.positions) {
      const livePrice = priceMap.get(pos.symbol);
      if (!livePrice) {
        remainingPositions.push(pos);
        continue;
      }

      // 1. Tratamento de ordens LIMIT PENDENTES
      // Uma ordem LIMIT simulada NÃO abre antes de o preço atingir o seu limite!
      if (pos.status === 'PENDING') {
        const targetLimit = pos.limitPrice || pos.entryPrice;
        let limitTriggered = false;

        if (pos.direction === 'LONG') {
          // Compra LIMIT: só abre quando o preço de mercado cai para o limite ou abaixo dele
          if (livePrice <= targetLimit) {
            limitTriggered = true;
          }
        } else {
          // Venda LIMIT: só abre quando o preço de mercado sobe para o limite ou acima dele
          if (livePrice >= targetLimit) {
            limitTriggered = true;
          }
        }

        if (limitTriggered) {
          changed = true;
          totalTradesCount++;
          // Ordem atingiu o patamar estipulado e agora é uma posição ABERTA
          remainingPositions.push({
            ...pos,
            status: 'OPEN',
            entryPrice: targetLimit,
            currentPrice: livePrice,
            triggeredTimestamp: Date.now()
          });
        } else {
          // Permanece pendente sem gerar PnL nem acionar TP/SL
          remainingPositions.push({ ...pos, currentPrice: livePrice });
        }
        continue;
      }

      // 2. Tratamento de posições já ABERTAS (status === 'OPEN') para TP e SL
      let triggered = false;
      let reason: 'TAKE_PROFIT' | 'STOP_LOSS' | null = null;
      let exitPrice = livePrice;

      if (pos.direction === 'LONG') {
        if (pos.targetPrice && livePrice >= pos.targetPrice) {
          triggered = true;
          reason = 'TAKE_PROFIT';
          exitPrice = pos.targetPrice;
        } else if (pos.stopLossPrice && livePrice <= pos.stopLossPrice) {
          triggered = true;
          reason = 'STOP_LOSS';
          exitPrice = pos.stopLossPrice;
        }
      } else {
        // SHORT
        if (pos.targetPrice && livePrice <= pos.targetPrice) {
          triggered = true;
          reason = 'TAKE_PROFIT';
          exitPrice = pos.targetPrice;
        } else if (pos.stopLossPrice && livePrice >= pos.stopLossPrice) {
          triggered = true;
          reason = 'STOP_LOSS';
          exitPrice = pos.stopLossPrice;
        }
      }

      if (triggered && reason) {
        changed = true;
        const priceDiff = pos.direction === 'LONG' ? exitPrice - pos.entryPrice : pos.entryPrice - exitPrice;
        const percentDiff = (priceDiff / pos.entryPrice) * pos.leverage;
        const grossPnl = pos.investedUSDT * percentDiff;
        const closeFee = Number(((pos.amount * exitPrice) * 0.0005).toFixed(4));
        const totalTradeFees = Number(((pos.openFee || 0) + closeFee).toFixed(2));
        const netRealizedPnl = grossPnl - (pos.openFee || 0) - closeFee;
        totalFees += closeFee;

        // Retorna margem investida + PnL bruto - taxa de saída (margem isolada com teto de perda)
        const returnedCash = Math.max(0, pos.investedUSDT + grossPnl - closeFee);
        updatedBalance += returnedCash;

        if (netRealizedPnl > 0) wins++;
        else losses++;

        newClosed.unshift({
          ...pos,
          status: 'CLOSED',
          closedTimestamp: Date.now(),
          closePrice: exitPrice,
          closeFee,
          totalFees: totalTradeFees,
          realizedPnl: Number(netRealizedPnl.toFixed(2)),
          realizedPnlPercent: Number(((netRealizedPnl / pos.investedUSDT) * 100).toFixed(2)),
          closeReason: reason
        });
      } else {
        remainingPositions.push({ ...pos, currentPrice: livePrice });
      }
    }

    if (!changed) return currentAcc;

    return {
      ...currentAcc,
      virtualBalance: Number(updatedBalance.toFixed(2)),
      totalTrades: totalTradesCount,
      totalFeesPaid: Number(totalFees.toFixed(2)),
      winTrades: wins,
      lossTrades: losses,
      positions: remainingPositions,
      closedHistory: newClosed
    };
  }, []);

  // Consulta cotações da API pública (Binance ou snapshot) sem concorrência
  const refreshPrices = useCallback(async () => {
    if (isUpdatingRef.current) return;
    isUpdatingRef.current = true;
    setIsFetching(true);
    try {
      const data = await apiService.fetchTickers();
      setAssets(data);
      const anyLive = data.some((a) => !a.isDemoData);
      setIsLive(anyLive);

      // Mantém a moeda selecionada sincronizada com o preço novo
      setSelectedCoin((prev) => data.find((a) => a.symbol === prev.symbol) || prev);

      // Avalia gatilhos de ordens LIMIT pendentes, Stop-Loss e Take-Profit
      setPaperAccount((prevAcc) => {
        const evaluated = checkTriggers(data, prevAcc);
        if (evaluated !== prevAcc) {
          StorageService.savePaperAccount(evaluated);
        }
        return evaluated;
      });
    } catch (err) {
      console.warn('Erro ao atualizar preços:', err);
    } finally {
      setIsFetching(false);
      isUpdatingRef.current = false;
    }
  }, [checkTriggers]);

  // Atualização periódica configurada nas configurações com limpeza de temporizador e prevenção de concorrência
  useEffect(() => {
    refreshPrices(); // Primeira carga

    const intervalSeconds = Math.max(5, settings.refreshIntervalSeconds || 30);
    const timerId = setInterval(() => {
      if (!isUpdatingRef.current) {
        refreshPrices();
      }
    }, intervalSeconds * 1000);

    return () => {
      clearInterval(timerId); // Limpa temporizador ao desmontar
    };
  }, [refreshPrices, settings.refreshIntervalSeconds]);

  // Salva configurações
  const handleSaveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    StorageService.saveSettings(newSettings);
  };

  // Abrir detalhes de uma moeda
  const handleSelectCoin = (asset: CryptoAsset) => {
    setSelectedCoin(asset);
    setActiveTab('details');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectCoinBySymbol = (symbol: string) => {
    const found = assets.find((a) => a.symbol === symbol) || assets[0];
    handleSelectCoin(found);
  };

  // Abertura de modal de ordem simulada
  const handleOpenTradeModal = (asset: CryptoAsset) => {
    setTradeModalCoin(asset);
    setTradeModalOpen(true);
  };

  // Execução de ordem simulada (Paper Trading) com suporte a MARKET e LIMIT
  const handleConfirmTrade = (
    tradeData: Omit<PaperPosition, 'id' | 'openTimestamp' | 'isDemo'>
  ) => {
    const isLimit = tradeData.orderType === 'LIMIT';
    const newPos: PaperPosition = {
      ...tradeData,
      id: `pos-${Date.now()}`,
      openTimestamp: Date.now(),
      status: isLimit ? 'PENDING' : 'OPEN',
      isDemo: true
    };

    const fee = tradeData.openFee ?? Number((tradeData.investedUSDT * tradeData.leverage * 0.0005).toFixed(4));
    const totalRequired = tradeData.investedUSDT + fee;
    const newBalance = Math.max(0, paperAccount.virtualBalance - totalRequired);

    const updated: PaperAccount = {
      ...paperAccount,
      virtualBalance: Number(newBalance.toFixed(2)),
      totalTrades: isLimit ? paperAccount.totalTrades : paperAccount.totalTrades + 1,
      totalFeesPaid: Number(((paperAccount.totalFeesPaid || 0) + fee).toFixed(2)),
      positions: [newPos, ...paperAccount.positions]
    };

    updatePaperAccount(updated);
  };

  // Cancelamento de ordem LIMIT pendente com devolução integral do saldo reservado
  const handleCancelPendingOrder = (positionId: string) => {
    const pos = paperAccount.positions.find((p) => p.id === positionId);
    if (!pos || pos.status !== 'PENDING') return;

    const refundAmount = pos.investedUSDT + (pos.openFee || 0);
    const newBalance = paperAccount.virtualBalance + refundAmount;

    const cancelledPos: PaperPosition = {
      ...pos,
      status: 'CLOSED',
      closedTimestamp: Date.now(),
      closePrice: pos.entryPrice,
      realizedPnl: 0,
      realizedPnlPercent: 0,
      closeReason: 'CANCELLED'
    };

    const updated: PaperAccount = {
      ...paperAccount,
      virtualBalance: Number(newBalance.toFixed(2)),
      totalFeesPaid: Math.max(0, Number(((paperAccount.totalFeesPaid || 0) - (pos.openFee || 0)).toFixed(2))),
      positions: paperAccount.positions.filter((p) => p.id !== positionId),
      closedHistory: [cancelledPos, ...paperAccount.closedHistory]
    };

    updatePaperAccount(updated);
  };

  // Encerramento manual de posição aberta a mercado
  const handleClosePosition = (positionId: string) => {
    const pos = paperAccount.positions.find((p) => p.id === positionId);
    if (!pos || pos.status !== 'OPEN') return;

    const currentCoinPrice = assets.find((a) => a.symbol === pos.symbol)?.price || pos.currentPrice;
    const priceDiff =
      pos.direction === 'LONG' ? currentCoinPrice - pos.entryPrice : pos.entryPrice - currentCoinPrice;
    const percentDiff = (priceDiff / pos.entryPrice) * pos.leverage;
    const grossPnl = pos.investedUSDT * percentDiff;
    const closeFee = Number(((pos.amount * currentCoinPrice) * 0.0005).toFixed(4));
    const totalTradeFees = Number(((pos.openFee || 0) + closeFee).toFixed(2));
    const netRealizedPnl = grossPnl - (pos.openFee || 0) - closeFee;

    // Retorna a margem inicial + o PnL líquido à vista (proteção isolada: perda máx é a margem)
    const returnedCash = Math.max(0, pos.investedUSDT + grossPnl - closeFee);
    const returnedBalance = paperAccount.virtualBalance + returnedCash;

    const closedPos: PaperPosition = {
      ...pos,
      status: 'CLOSED',
      closedTimestamp: Date.now(),
      closePrice: currentCoinPrice,
      closeFee,
      totalFees: totalTradeFees,
      realizedPnl: Number(netRealizedPnl.toFixed(2)),
      realizedPnlPercent: Number(((netRealizedPnl / pos.investedUSDT) * 100).toFixed(2)),
      closeReason: 'MANUAL'
    };

    const isWin = netRealizedPnl > 0;

    const updated: PaperAccount = {
      ...paperAccount,
      virtualBalance: Number(returnedBalance.toFixed(2)),
      totalFeesPaid: Number(((paperAccount.totalFeesPaid || 0) + closeFee).toFixed(2)),
      winTrades: isWin ? paperAccount.winTrades + 1 : paperAccount.winTrades,
      lossTrades: !isWin ? paperAccount.lossTrades + 1 : paperAccount.lossTrades,
      positions: paperAccount.positions.filter((p) => p.id !== positionId),
      closedHistory: [closedPos, ...paperAccount.closedHistory]
    };

    updatePaperAccount(updated);
  };

  // Resetar saldo de demonstração
  const handleResetPaperAccount = () => {
    const fresh = StorageService.resetPaperAccount(10000);
    setPaperAccount(fresh);
  };

  // Título da tela ativa para o cabeçalho
  const getScreenTitle = () => {
    switch (activeTab) {
      case 'dashboard':
        return 'Radar Principal & Mercados';
      case 'market':
        return 'Cotações & Filtros de Exchange';
      case 'details':
        return `${selectedCoin.symbol} • Análise Técnica`;
      case 'signals':
        return 'Histórico de Sinais Técnicos';
      case 'paper':
        return 'Simulador Paper Trading';
      case 'settings':
        return 'Configurações & Risco';
      default:
        return 'CryptoRadar';
    }
  };

  return (
    <div className={`min-h-screen bg-[#0B0E14] text-slate-100 flex justify-center ${isMobileFrame ? 'p-0 sm:p-6 bg-[#07090D]' : ''}`}>
      {/* Container Mobile ou Moldura de Smartphone para Desktop */}
      <div
        className={`w-full min-h-screen flex flex-col transition-all duration-200 ${
          isMobileFrame
            ? 'max-w-[420px] rounded-3xl border border-slate-800 shadow-2xl bg-[#0B0E14] overflow-hidden my-auto max-h-[92vh]'
            : 'max-w-2xl'
        }`}
      >
        {/* Banner Fixo de Modo Demo / Isenção no Topo */}
        <DisclaimerBanner compact />

        {/* Header Superior Fixo com indicação do intervalo de monitoramento */}
        <Header
          isLive={isLive}
          isFetching={isFetching}
          onRefresh={refreshPrices}
          isMobileFrame={isMobileFrame}
          onToggleFrame={() => setIsMobileFrame(!isMobileFrame)}
          activeScreenTitle={getScreenTitle()}
          refreshIntervalSeconds={settings.refreshIntervalSeconds || 30}
        />

        {/* Conteúdo Principal com Scroll */}
        <main className="flex-1 px-3.5 pt-3 overflow-y-auto">
          {activeTab === 'dashboard' && (
            <DashboardView
              assets={assets}
              signals={signals}
              onSelectCoin={handleSelectCoin}
              onNavigateToSignals={() => setActiveTab('signals')}
              onNavigateToPaper={() => setActiveTab('paper')}
              onOpenTradeModal={handleOpenTradeModal}
            />
          )}

          {activeTab === 'market' && (
            <MarketView
              assets={assets}
              onSelectCoin={handleSelectCoin}
              onOpenTradeModal={handleOpenTradeModal}
            />
          )}

          {activeTab === 'details' && (
            <CoinDetailsView
              asset={selectedCoin}
              onBack={() => setActiveTab('market')}
              onOpenTradeModal={handleOpenTradeModal}
            />
          )}

          {activeTab === 'signals' && (
            <SignalsView
              signals={signals}
              assets={assets}
              onOpenTradeModal={handleOpenTradeModal}
              onSelectCoinBySymbol={handleSelectCoinBySymbol}
            />
          )}

          {activeTab === 'paper' && (
            <PaperTradingView
              account={paperAccount}
              assets={assets}
              onOpenNewTradeModal={() => handleOpenTradeModal(assets[0])}
              onClosePosition={handleClosePosition}
              onCancelPendingOrder={handleCancelPendingOrder}
              onResetAccount={handleResetPaperAccount}
              onSelectCoinBySymbol={handleSelectCoinBySymbol}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              settings={settings}
              onSaveSettings={handleSaveSettings}
            />
          )}
        </main>

        {/* Navegação Inferior Fixa no Celular */}
        <BottomNav
          activeTab={activeTab}
          onSelectTab={(tab) => {
            setActiveTab(tab);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          openPositionsCount={paperAccount.positions.length}
          activeSignalsCount={signals.filter((s) => s.status === 'OPEN').length}
        />

        {/* Modal de Nova Ordem Simulada */}
        <NewTradeModal
          isOpen={tradeModalOpen}
          onClose={() => setTradeModalOpen(false)}
          assets={assets}
          initialAsset={tradeModalCoin}
          virtualBalance={paperAccount.virtualBalance}
          onConfirmTrade={handleConfirmTrade}
        />
      </div>
    </div>
  );
}

/**
 * CryptoRadar - Plataforma Mobile-First de Análise de Criptomoedas
 * Versão 1.0 (DEMO)
 */

import React, { useState, useEffect, useCallback } from 'react';
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

  // Salva conta de paper trading no localStorage quando alterada
  const updatePaperAccount = useCallback((newAccount: PaperAccount) => {
    setPaperAccount(newAccount);
    StorageService.savePaperAccount(newAccount);
  }, []);

  // Verificação e execução automática de Stop-Loss e Take-Profit com base nos preços atualizados
  const checkTriggers = useCallback((currentAssets: CryptoAsset[], currentAcc: PaperAccount): PaperAccount => {
    if (!currentAcc.positions || currentAcc.positions.length === 0) return currentAcc;

    const priceMap = new Map<string, number>();
    currentAssets.forEach((a) => priceMap.set(a.symbol, a.price));

    let updatedBalance = currentAcc.virtualBalance;
    let totalFees = currentAcc.totalFeesPaid || 0;
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

        // Retorna margem investida + PnL bruto - taxa de saída (margem isolada)
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
      totalFeesPaid: Number(totalFees.toFixed(2)),
      winTrades: wins,
      lossTrades: losses,
      positions: remainingPositions,
      closedHistory: newClosed
    };
  }, []);

  // Consulta cotações da API pública (Binance ou snapshot)
  const refreshPrices = useCallback(async () => {
    setIsFetching(true);
    try {
      const data = await apiService.fetchTickers();
      setAssets(data);
      const anyLive = data.some((a) => !a.isDemoData);
      setIsLive(anyLive);

      // Mantém a moeda selecionada sincronizada com o preço novo
      setSelectedCoin((prev) => data.find((a) => a.symbol === prev.symbol) || prev);

      // Avalia Stop-Loss e Take-Profit das posições simuladas
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
    }
  }, [checkTriggers]);

  useEffect(() => {
    refreshPrices();
  }, [refreshPrices]);

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

  // Execução de ordem simulada (Paper Trading) com débito de margem + taxa
  const handleConfirmTrade = (
    tradeData: Omit<PaperPosition, 'id' | 'openTimestamp' | 'status' | 'isDemo'>
  ) => {
    const newPos: PaperPosition = {
      ...tradeData,
      id: `pos-${Date.now()}`,
      openTimestamp: Date.now(),
      status: 'OPEN',
      isDemo: true
    };

    const fee = tradeData.openFee ?? Number((tradeData.investedUSDT * tradeData.leverage * 0.0005).toFixed(4));
    const totalRequired = tradeData.investedUSDT + fee;
    const newBalance = Math.max(0, paperAccount.virtualBalance - totalRequired);

    const updated: PaperAccount = {
      ...paperAccount,
      virtualBalance: Number(newBalance.toFixed(2)),
      totalTrades: paperAccount.totalTrades + 1,
      totalFeesPaid: Number(((paperAccount.totalFeesPaid || 0) + fee).toFixed(2)),
      positions: [newPos, ...paperAccount.positions]
    };

    updatePaperAccount(updated);
  };

  // Encerramento manual de posição simulada
  const handleClosePosition = (positionId: string) => {
    const pos = paperAccount.positions.find((p) => p.id === positionId);
    if (!pos) return;

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

        {/* Header Superior Fixo */}
        <Header
          isLive={isLive}
          isFetching={isFetching}
          onRefresh={refreshPrices}
          isMobileFrame={isMobileFrame}
          onToggleFrame={() => setIsMobileFrame(!isMobileFrame)}
          activeScreenTitle={getScreenTitle()}
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

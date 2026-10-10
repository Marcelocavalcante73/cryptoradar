/**
 * CryptoRadar - Plataforma Mobile-First de Análise de Criptomoedas
 * Versão 1.0 (DEMO)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CryptoAsset, TechnicalSignal, PaperAccount, AppSettings, PaperPosition } from './types/crypto';
import { INITIAL_ASSETS, INITIAL_SIGNALS } from './services/mockData';
import { StorageService } from './services/storageService';
import { apiService } from './services/apiService';
import { createTradeOrder, cancelPendingOrder, closeOpenPosition, evaluateTriggers } from './services/paperTradingService';
import { soundService } from './services/soundService';

// Layout & Navegação
import { Header } from './components/layout/Header';
import { BottomNav, ScreenTab } from './components/layout/BottomNav';
import { DisclaimerBanner } from './components/common/DisclaimerBanner';

// Telas
import { DashboardView } from './components/dashboard/DashboardView';
import { MarketView } from './components/market/MarketView';
import { CoinDetailsView } from './components/details/CoinDetailsView';
import { PaperTradingView } from './components/paperTrading/PaperTradingView';
import { SignalsView, ScanInfo } from './components/signals/SignalsView';
import { SettingsView } from './components/settings/SettingsView';

// Modais
import { NewTradeModal } from './components/paperTrading/NewTradeModal';

export default function App() {
  const [activeTab, setActiveTab] = useState<ScreenTab>('dashboard');
  const [assets, setAssets] = useState<CryptoAsset[]>(INITIAL_ASSETS);
  const [signals, setSignals] = useState<TechnicalSignal[]>(INITIAL_SIGNALS);
  const [scanInfo, setScanInfo] = useState<ScanInfo | null>(null);
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

      // Avalia gatilhos de ordens LIMIT pendentes, Stop-Loss e Take-Profit com o serviço unificado
      setPaperAccount((prevAcc) => {
        const { account: evaluated, triggeredOrders } = evaluateTriggers(prevAcc, data);
        if (triggeredOrders.length > 0) {
          if (settings.soundAlerts) {
            const hasTpOrProfit = triggeredOrders.some((t) => t.type === 'TAKE_PROFIT' || (t.netPnl !== undefined && t.netPnl > 0));
            if (hasTpOrProfit) soundService.playSuccess();
            else soundService.playAlert();
          }
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
  }, [settings.soundAlerts]);

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

  // Sinais reais do scanner do servidor (top 100). Sem servidor/dados, mantém a demonstração.
  useEffect(() => {
    let cancelled = false;
    const loadSignals = async () => {
      try {
        const r = await fetch('/api/signals', { signal: AbortSignal.timeout(5000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (cancelled) return;
        setScanInfo({
          lastScanAt: j.lastScanAt,
          lastError: j.lastError,
          scannedPairs: j.scannedPairs,
          universeSource: j.universe?.source ?? null,
          universeCount: j.universe?.count ?? 0,
          exchanges: j.universe?.exchanges,
          marketMode: j.marketMode,
          skipped: j.universe?.skipped ?? [],
          running: j.running
        });
        if (j.lastScanAt && Array.isArray(j.signals) && !j.lastError) setSignals(j.signals);
      } catch {
        if (!cancelled) setScanInfo(null);
      }
    };
    loadSignals();
    const id = setInterval(loadSignals, 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

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
    setPaperAccount((prev) => {
      const res = createTradeOrder(prev, {
        symbol: tradeData.symbol,
        direction: tradeData.direction,
        orderType: tradeData.orderType,
        entryPrice: tradeData.entryPrice,
        currentPrice: tradeData.currentPrice,
        limitPrice: tradeData.limitPrice,
        investedUSDT: tradeData.investedUSDT,
        leverage: tradeData.leverage,
        targetPrice: tradeData.targetPrice,
        stopLossPrice: tradeData.stopLossPrice
      });

      if (res.success && res.account) {
        if (settings.soundAlerts) soundService.playSuccess();
        StorageService.savePaperAccount(res.account);
        return res.account;
      }
      return prev;
    });
  };

  // Cancelamento de ordem LIMIT pendente com devolução integral do saldo reservado
  const handleCancelPendingOrder = (positionId: string) => {
    setPaperAccount((prev) => {
      const res = cancelPendingOrder(prev, positionId);
      if (res.success && res.account) {
        StorageService.savePaperAccount(res.account);
        return res.account;
      }
      return prev;
    });
  };

  // Encerramento manual de posição aberta a mercado
  const handleClosePosition = (positionId: string) => {
    setPaperAccount((prev) => {
      const pos = prev.positions.find((p) => p.id === positionId);
      if (!pos) return prev;

      const livePrice = assets.find((a) => a.symbol === pos.symbol)?.price || pos.currentPrice || pos.entryPrice;
      const res = closeOpenPosition(prev, positionId, livePrice, 'MANUAL');

      if (res.success && res.account) {
        if (settings.soundAlerts) {
          if ((res.position?.realizedPnl || 0) >= 0) soundService.playSuccess();
          else soundService.playAlert();
        }
        StorageService.savePaperAccount(res.account);
        return res.account;
      }
      return prev;
    });
  };

  // Resetar saldo para conta limpa
  const handleResetPaperAccount = () => {
    const fresh = StorageService.resetPaperAccount(10000);
    setPaperAccount(fresh);
  };

  // Carregar conta de demonstração com dados de exemplo
  const handleLoadDemoPaperAccount = () => {
    const demo = StorageService.loadDemoAccount();
    setPaperAccount(demo);
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
              scanInfo={scanInfo}
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
              onLoadDemoAccount={handleLoadDemoPaperAccount}
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

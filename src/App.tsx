/**
 * CryptoRadar — sinais de compra e venda das 100 maiores criptomoedas, com carteira simulada.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CryptoAsset, TechnicalSignal, PaperAccount, AppSettings } from './types/crypto';
import { INITIAL_ASSETS, INITIAL_SIGNALS } from './services/mockData';
import { StorageService } from './services/storageService';
import { apiService } from './services/apiService';
import { createTradeOrder, closeOpenPosition, evaluateTriggers } from './services/paperTradingService';
import { soundService } from './services/soundService';

import { Header } from './components/layout/Header';
import { BottomNav, ScreenTab } from './components/layout/BottomNav';
import { MarketView } from './components/market/MarketView';
import { CoinDetailsView } from './components/details/CoinDetailsView';
import { WalletView } from './components/paperTrading/WalletView';
import { SignalsView, ScanInfo } from './components/signals/SignalsView';
import { SettingsView } from './components/settings/SettingsView';
import { TradeSheet, TradeRequest } from './components/paperTrading/TradeSheet';

export default function App() {
  const [activeTab, setActiveTab] = useState<ScreenTab>('signals');
  const [assets, setAssets] = useState<CryptoAsset[]>(INITIAL_ASSETS);
  const [signals, setSignals] = useState<TechnicalSignal[]>(INITIAL_SIGNALS);
  const [scanInfo, setScanInfo] = useState<ScanInfo | null>(null);
  const [selectedCoin, setSelectedCoin] = useState<CryptoAsset>(INITIAL_ASSETS[0]);
  const [trade, setTrade] = useState<{ asset: CryptoAsset; signal?: TechnicalSignal } | null>(null);

  const [paperAccount, setPaperAccount] = useState<PaperAccount>(() => StorageService.getPaperAccount());
  const [settings, setSettings] = useState<AppSettings>(() => StorageService.getSettings());

  const [isFetching, setIsFetching] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [demoReason, setDemoReason] = useState<string | null>(null);

  // Refs com o estado mais recente, para uso dentro de callbacks assíncronos
  const isUpdatingRef = useRef(false);
  const accountRef = useRef(paperAccount);
  const signalsRef = useRef(signals);
  const assetsRef = useRef(assets);
  const scanInfoRef = useRef<ScanInfo | null>(null);
  accountRef.current = paperAccount;
  signalsRef.current = signals;
  assetsRef.current = assets;
  scanInfoRef.current = scanInfo;

  const commitAccount = useCallback((account: PaperAccount) => {
    accountRef.current = account;
    setPaperAccount(account);
    StorageService.savePaperAccount(account);
  }, []);

  // Preços: lista principal + moedas de sinais abertos e de posições simuladas
  const refreshPrices = useCallback(async () => {
    if (isUpdatingRef.current) return;
    isUpdatingRef.current = true;
    setIsFetching(true);
    try {
      const base = await apiService.fetchTickers();
      const have = new Set(base.map((a) => a.symbol));
      const extra = new Set<string>();
      accountRef.current.positions.forEach((p) => !have.has(p.symbol) && extra.add(p.symbol));
      scanInfoRef.current?.coins?.forEach((c) => !have.has(c.symbol) && extra.add(c.symbol));
      signalsRef.current.forEach((s) => !s.isDemo && s.status === 'OPEN' && !have.has(s.symbol) && extra.add(s.symbol));
      const extraAssets = extra.size ? await apiService.fetchAssetsBySymbols(Array.from(extra)) : [];
      const data = [...base, ...extraAssets];

      const validation = apiService.getDataValidationStatus();
      const forcedDemo = validation.isDemoDataForced || !validation.isValid;
      const isSimulationActive = forcedDemo || data.every((a) => a.isDemoData);

      setAssets(data);
      setIsLive(!isSimulationActive && data.some((a) => !a.isDemoData));
      setIsDemoMode(isSimulationActive);
      setDemoReason(forcedDemo ? (validation.reason || null) : null);
      setSelectedCoin((prev) => data.find((a) => a.symbol === prev.symbol) || prev);

      // Stop e alvo das posições simuladas, só com preços reais
      const live = data.filter((a) => !a.isDemoData);
      const { account: evaluated, triggeredOrders } = evaluateTriggers(accountRef.current, live);
      if (triggeredOrders.length > 0) {
        if (settings.soundAlerts) {
          const win = triggeredOrders.some((t) => t.type === 'TAKE_PROFIT' || (t.netPnl !== undefined && t.netPnl > 0));
          win ? soundService.playSuccess() : soundService.playAlert();
        }
        commitAccount(evaluated);
      }
    } catch (err) {
      console.warn('Erro ao atualizar preços:', err);
    } finally {
      setIsFetching(false);
      isUpdatingRef.current = false;
    }
  }, [settings.soundAlerts, commitAccount]);

  useEffect(() => {
    refreshPrices();
    const id = setInterval(refreshPrices, Math.max(5, settings.refreshIntervalSeconds || 30) * 1000);
    return () => clearInterval(id);
  }, [refreshPrices, settings.refreshIntervalSeconds]);

  // Ao receber a lista de moedas do scanner, busca os preços delas sem esperar o próximo ciclo
  const coinsCount = scanInfo?.coins?.length ?? 0;
  useEffect(() => {
    if (coinsCount > 0) refreshPrices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coinsCount]);

  // Sinais reais do scanner do servidor; sem servidor, mantém exemplos
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
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
          coins: j.universe?.coins ?? [],
          running: j.running
        });
        if (j.lastScanAt && Array.isArray(j.signals) && !j.lastError) setSignals(j.signals);
      } catch {
        if (!cancelled) setScanInfo(null);
      }
    };
    load();
    const id = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const handleSaveSettings = (next: AppSettings) => {
    setSettings(next);
    StorageService.saveSettings(next);
  };

  const goTo = (tab: ScreenTab) => {
    setActiveTab(tab);
    window.scrollTo({ top: 0 });
  };

  const findAsset = (symbol: string, fallbackPrice?: number): CryptoAsset =>
    assetsRef.current.find((a) => a.symbol === symbol) || {
      id: symbol.toLowerCase(), symbol, baseAsset: symbol.replace('USDT', ''), quoteAsset: 'USDT',
      name: symbol.replace('USDT', ''), price: fallbackPrice ?? 0, change24h: 0, high24h: fallbackPrice ?? 0,
      low24h: fallbackPrice ?? 0, volume24h: 0, exchanges: ['binance'], sparkline: [fallbackPrice ?? 0],
      lastUpdated: '', isDemoData: true
    };

  const handleSelectCoin = (asset: CryptoAsset) => { setSelectedCoin(asset); goTo('details'); };
  const handleSelectCoinBySymbol = (symbol: string) => handleSelectCoin(findAsset(symbol));

  // Compra simulada (spot: sem alavancagem, ordem a mercado)
  const handleConfirmTrade = (req: TradeRequest): { success: boolean; error?: string } => {
    const asset = trade?.asset;
    if (!asset || asset.isDemoData) {
      return { success: false, error: 'Sem preço ao vivo agora. Atualize e tente de novo.' };
    }
    const res = createTradeOrder(accountRef.current, {
      symbol: req.symbol,
      direction: 'LONG',
      orderType: 'MARKET',
      entryPrice: req.price,
      currentPrice: req.price,
      investedUSDT: req.amountUSDT,
      leverage: 1,
      targetPrice: req.targetPrice,
      stopLossPrice: req.stopLossPrice
    });
    if (!res.success || !res.account) return { success: false, error: res.error || 'Não foi possível abrir a simulação.' };
    if (settings.soundAlerts) soundService.playSuccess();
    commitAccount(res.account);
    setTrade(null);
    goTo('wallet');
    return { success: true };
  };

  const handleClosePosition = (positionId: string) => {
    const pos = accountRef.current.positions.find((p) => p.id === positionId);
    if (!pos) return;
    const live = assetsRef.current.find((a) => a.symbol === pos.symbol && !a.isDemoData)?.price;
    const res = closeOpenPosition(accountRef.current, positionId, live || pos.currentPrice || pos.entryPrice, 'MANUAL');
    if (res.success && res.account) {
      if (settings.soundAlerts) (res.position?.realizedPnl || 0) >= 0 ? soundService.playSuccess() : soundService.playAlert();
      commitAccount(res.account);
    }
  };

  const handleResetBalance = () => {
    setPaperAccount(StorageService.resetPaperAccount(10000, true));
  };

  const handleClearHistory = () => {
    commitAccount({ ...accountRef.current, closedHistory: [], totalTrades: 0, winTrades: 0, lossTrades: 0, totalFeesPaid: 0 });
  };

  const openSignals = signals.filter((s) => s.status === 'OPEN').length;

  return (
    <div className="min-h-screen bg-[#0f1115] text-slate-100 flex justify-center">
      <div className="w-full max-w-2xl min-h-screen flex flex-col">
        <Header
          isLive={isLive}
          isDemoData={isDemoMode}
          isFetching={isFetching}
          onRefresh={refreshPrices}
          onOpenSettings={() => goTo('settings')}
        />

        <main className="flex-1 px-4 pt-4">
          {activeTab === 'signals' && (
            <SignalsView
              scanInfo={scanInfo}
              signals={signals}
              account={paperAccount}
              onSimulate={(s) => setTrade({ asset: findAsset(s.symbol, s.entryPrice), signal: s })}
              onClosePosition={handleClosePosition}
              onSelectCoinBySymbol={handleSelectCoinBySymbol}
              isDemoData={isDemoMode}
              demoReason={demoReason}
            />
          )}

          {activeTab === 'wallet' && (
            <WalletView
              account={paperAccount}
              assets={assets}
              onClosePosition={handleClosePosition}
              onResetBalance={handleResetBalance}
              onClearHistory={handleClearHistory}
              onSelectCoinBySymbol={handleSelectCoinBySymbol}
            />
          )}

          {activeTab === 'market' && (
            <MarketView assets={assets} coins={scanInfo?.coins ?? []} onSelectCoin={handleSelectCoin} />
          )}

          {activeTab === 'details' && (
            <CoinDetailsView asset={selectedCoin} onBack={() => goTo('market')} onOpenTradeModal={(asset) => setTrade({ asset })} />
          )}

          {activeTab === 'settings' && (
            <SettingsView settings={settings} scanInfo={scanInfo} onSaveSettings={handleSaveSettings} onBack={() => goTo('signals')} />
          )}
        </main>

        <BottomNav
          activeTab={activeTab}
          onSelectTab={goTo}
          openSignals={openSignals}
          openPositions={paperAccount.positions.filter((p) => p.status === 'OPEN').length}
        />

        <TradeSheet
          asset={trade?.asset ?? null}
          signal={trade?.signal}
          balance={paperAccount.virtualBalance}
          riskPercent={settings.risk.maxRiskPerTradePercent}
          defaultStopPercent={settings.risk.defaultStopLossPercent}
          defaultRewardRatio={settings.risk.defaultTakeProfitRatio}
          onClose={() => setTrade(null)}
          onConfirm={handleConfirmTrade}
        />
      </div>
    </div>
  );
}

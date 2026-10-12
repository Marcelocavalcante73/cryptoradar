/**
 * CryptoRadar — sinais de compra e venda das 100 maiores criptomoedas, com carteira simulada.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CryptoAsset, TechnicalSignal, PaperAccount, AppSettings, MarketType } from './types/crypto';
import { INITIAL_ASSETS, INITIAL_SIGNALS } from './services/mockData';
import { StorageService } from './services/storageService';
import { apiService } from './services/apiService';
import { createTradeOrder, closeOpenPosition, evaluateTriggers } from './services/paperTradingService';
import { soundService } from './services/soundService';
import { DEFAULT_FUTURES_LEVERAGE } from './services/futures';

import { Header } from './components/layout/Header';
import { BottomNav, ScreenTab } from './components/layout/BottomNav';
import { MarketView } from './components/market/MarketView';
import { CoinDetailsView } from './components/details/CoinDetailsView';
import { WalletView } from './components/paperTrading/WalletView';
import { SignalsView, ScanInfo } from './components/signals/SignalsView';
import { SettingsView } from './components/settings/SettingsView';
import { TradeSheet, TradeRequest } from './components/paperTrading/TradeSheet';

const MARKETS: MarketType[] = ['spot', 'futures'];

/** Ativo mínimo montado a partir de um preço de contrato de futuros. */
function futuresAsset(symbol: string, price: number): CryptoAsset {
  const base = symbol.replace(/USDT$/, '');
  return {
    id: symbol.toLowerCase(), symbol, baseAsset: base, quoteAsset: 'USDT', name: base, price,
    change24h: 0, high24h: price, low24h: price, volume24h: 0, exchanges: ['binance'], sparkline: [price],
    lastUpdated: new Date().toLocaleTimeString('pt-BR'), isDemoData: false
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ScreenTab>('signals');
  const [market, setMarket] = useState<MarketType>(() => StorageService.getMarket());
  const [assets, setAssets] = useState<CryptoAsset[]>(INITIAL_ASSETS);
  const [futuresAssets, setFuturesAssets] = useState<CryptoAsset[]>([]);
  const [signalsBy, setSignalsBy] = useState<Record<MarketType, TechnicalSignal[]>>({ spot: INITIAL_SIGNALS, futures: [] });
  const [scanInfos, setScanInfos] = useState<Record<MarketType, ScanInfo | null>>({ spot: null, futures: null });
  const [selectedCoin, setSelectedCoin] = useState<CryptoAsset>(INITIAL_ASSETS[0]);
  const [detailsMarket, setDetailsMarket] = useState<MarketType>('spot');
  const [backTab, setBackTab] = useState<ScreenTab>('market');
  const [trade, setTrade] = useState<{ market: MarketType; asset: CryptoAsset; signal?: TechnicalSignal } | null>(null);

  const [accounts, setAccounts] = useState<Record<MarketType, PaperAccount>>(() => ({
    spot: StorageService.getPaperAccount('spot'),
    futures: StorageService.getPaperAccount('futures')
  }));
  const [settings, setSettings] = useState<AppSettings>(() => StorageService.getSettings());

  const [isFetching, setIsFetching] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [demoReason, setDemoReason] = useState<string | null>(null);

  // Refs com o estado mais recente, para uso dentro de callbacks assíncronos
  const isUpdatingRef = useRef(false);
  const accountsRef = useRef(accounts);
  const signalsRef = useRef(signalsBy);
  const assetsRef = useRef(assets);
  const futuresAssetsRef = useRef(futuresAssets);
  const scanInfosRef = useRef(scanInfos);
  accountsRef.current = accounts;
  signalsRef.current = signalsBy;
  assetsRef.current = assets;
  futuresAssetsRef.current = futuresAssets;
  scanInfosRef.current = scanInfos;

  const signals = signalsBy[market];
  const scanInfo = scanInfos[market];
  const paperAccount = accounts[market];

  const commitAccount = useCallback((m: MarketType, account: PaperAccount) => {
    accountsRef.current = { ...accountsRef.current, [m]: account };
    setAccounts(accountsRef.current);
    StorageService.savePaperAccount(account, m);
  }, []);

  const changeMarket = (m: MarketType) => {
    setMarket(m);
    StorageService.saveMarket(m);
  };

  // Preços: lista principal + moedas de sinais abertos e de posições simuladas
  const refreshPrices = useCallback(async () => {
    if (isUpdatingRef.current) return;
    isUpdatingRef.current = true;
    setIsFetching(true);
    try {
      const base = await apiService.fetchTickers();
      const have = new Set(base.map((a) => a.symbol));
      const extra = new Set<string>();
      accountsRef.current.spot.positions.forEach((p) => !have.has(p.symbol) && extra.add(p.symbol));
      scanInfosRef.current.spot?.coins?.forEach((c) => !have.has(c.symbol) && extra.add(c.symbol));
      signalsRef.current.spot.forEach((s) => !s.isDemo && s.status === 'OPEN' && !have.has(s.symbol) && extra.add(s.symbol));
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
      const { account: evaluated, triggeredOrders } = evaluateTriggers(accountsRef.current.spot, live);
      if (triggeredOrders.length > 0) {
        if (settings.soundAlerts) {
          const win = triggeredOrders.some((t) => t.type === 'TAKE_PROFIT' || (t.netPnl !== undefined && t.netPnl > 0));
          win ? soundService.playSuccess() : soundService.playAlert();
        }
        commitAccount('spot', evaluated);
      }

      // Futuros: preços dos contratos perpétuos (via servidor) para posições abertas e sinais abertos
      try {
        const fSymbols = new Set<string>();
        accountsRef.current.futures.positions.forEach((p) => fSymbols.add(p.symbol));
        signalsRef.current.futures.forEach((s) => s.status === 'OPEN' && fSymbols.add(s.symbol));
        if (fSymbols.size > 0) {
          const r = await fetch(`/api/futures/prices?symbols=${Array.from(fSymbols).slice(0, 150).join(',')}`, { signal: AbortSignal.timeout(6000) });
          if (r.ok) {
            const { prices } = await r.json();
            const fa = Object.entries(prices as Record<string, number>).map(([sym, px]) => futuresAsset(sym, px));
            setFuturesAssets(fa);
            const fEval = evaluateTriggers(accountsRef.current.futures, fa);
            if (fEval.triggeredOrders.length > 0) {
              if (settings.soundAlerts) {
                const win = fEval.triggeredOrders.some((t) => t.type === 'TAKE_PROFIT' || (t.netPnl !== undefined && t.netPnl > 0));
                win ? soundService.playSuccess() : soundService.playAlert();
              }
              commitAccount('futures', fEval.account);
            }
          }
        }
      } catch (fErr) {
        console.warn('Erro ao atualizar preços de futuros:', fErr);
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
  const coinsCount = (scanInfos.spot?.coins?.length ?? 0) + (scanInfos.futures?.coins?.length ?? 0);
  useEffect(() => {
    if (coinsCount > 0) refreshPrices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coinsCount]);

  // Sinais reais dos scanners do servidor (spot e futuros). Sem servidor, o spot mantém exemplos.
  useEffect(() => {
    let cancelled = false;
    const load = async (m: MarketType) => {
      try {
        const r = await fetch(`/api/signals?market=${m}`, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (cancelled) return;
        setScanInfos((prev) => ({
          ...prev,
          [m]: {
            lastScanAt: j.lastScanAt,
            lastError: j.lastError,
            scannedPairs: j.scannedPairs,
            universeSource: j.universe?.source ?? null,
            universeCount: j.universe?.count ?? 0,
            exchanges: j.universe?.exchanges,
            market: m,
            skipped: j.universe?.skipped ?? [],
            coins: j.universe?.coins ?? [],
            running: j.running
          }
        }));
        if (j.lastScanAt && Array.isArray(j.signals) && !j.lastError) setSignalsBy((prev) => ({ ...prev, [m]: j.signals }));
      } catch {
        if (!cancelled) setScanInfos((prev) => ({ ...prev, [m]: null }));
      }
    };
    const loadAll = () => MARKETS.forEach((m) => load(m));
    loadAll();
    const id = setInterval(loadAll, 60000);
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

  const findAsset = (symbol: string, fallbackPrice?: number, m: MarketType = 'spot'): CryptoAsset =>
    (m === 'futures' ? futuresAssetsRef.current : assetsRef.current).find((a) => a.symbol === symbol) || {
      id: symbol.toLowerCase(), symbol, baseAsset: symbol.replace('USDT', ''), quoteAsset: 'USDT',
      name: symbol.replace('USDT', ''), price: fallbackPrice ?? 0, change24h: 0, high24h: fallbackPrice ?? 0,
      low24h: fallbackPrice ?? 0, volume24h: 0, exchanges: ['binance'], sparkline: [fallbackPrice ?? 0],
      lastUpdated: '', isDemoData: true
    };

  const handleSelectCoin = (asset: CryptoAsset, m: MarketType = 'spot', from: ScreenTab = 'market') => {
    setSelectedCoin(asset);
    setDetailsMarket(m);
    setBackTab(from);
    goTo('details');
  };
  const handleSelectCoinBySymbol = (symbol: string) => handleSelectCoin(findAsset(symbol, undefined, market), market, activeTab);

  const openTrade = (m: MarketType, asset: CryptoAsset, signal?: TechnicalSignal) => {
    setTrade({ market: m, asset, signal });
    if (m === 'futures') refreshPrices(); // garante o preço do contrato antes de confirmar
  };

  // Ordem simulada a mercado. Spot: só compra, sem alavancagem. Futuros: long/short com alavancagem e margem isolada.
  const handleConfirmTrade = (req: TradeRequest): { success: boolean; error?: string } => {
    const asset = trade?.asset;
    const m = trade?.market ?? 'spot';
    if (!asset || asset.isDemoData) {
      return { success: false, error: 'Sem preço ao vivo agora. Atualize e tente de novo.' };
    }
    const res = createTradeOrder(accountsRef.current[m], {
      symbol: req.symbol,
      direction: m === 'futures' ? req.direction : 'LONG',
      orderType: 'MARKET',
      entryPrice: req.price,
      currentPrice: req.price,
      investedUSDT: req.amountUSDT,
      leverage: m === 'futures' ? req.leverage : 1,
      targetPrice: req.targetPrice,
      stopLossPrice: req.stopLossPrice
    });
    if (!res.success || !res.account) return { success: false, error: res.error || 'Não foi possível abrir a simulação.' };
    if (settings.soundAlerts) soundService.playSuccess();
    commitAccount(m, res.account);
    setTrade(null);
    changeMarket(m);
    goTo('wallet');
    return { success: true };
  };

  const handleClosePosition = (positionId: string) => {
    const acc = accountsRef.current[market];
    const pos = acc.positions.find((p) => p.id === positionId);
    if (!pos) return;
    const list = market === 'futures' ? futuresAssetsRef.current : assetsRef.current;
    const live = list.find((a) => a.symbol === pos.symbol && !a.isDemoData)?.price;
    const res = closeOpenPosition(acc, positionId, live || pos.currentPrice || pos.entryPrice, 'MANUAL');
    if (res.success && res.account) {
      if (settings.soundAlerts) (res.position?.realizedPnl || 0) >= 0 ? soundService.playSuccess() : soundService.playAlert();
      commitAccount(market, res.account);
    }
  };

  const handleResetBalance = () => {
    const fresh = StorageService.resetPaperAccount(10000, true, market);
    accountsRef.current = { ...accountsRef.current, [market]: fresh };
    setAccounts(accountsRef.current);
  };

  const handleClearHistory = () => {
    commitAccount(market, { ...accountsRef.current[market], closedHistory: [], totalTrades: 0, winTrades: 0, lossTrades: 0, totalFeesPaid: 0 });
  };

  const openSignals = signals.filter((s) => s.status === 'OPEN').length;
  const openSignalsBy = (m: MarketType) => signalsBy[m].filter((s) => s.status === 'OPEN').length;
  const showSwitch = activeTab === 'signals' || activeTab === 'wallet';

  return (
    <div className="min-h-screen bg-[#0f1115] text-slate-100 flex justify-center">
      <div className="w-full max-w-2xl min-h-screen flex flex-col">
        <Header
          isLive={market === 'futures' ? Boolean(scanInfos.futures?.lastScanAt && !scanInfos.futures.lastError) : isLive}
          isDemoData={market === 'spot' && isDemoMode}
          isFetching={isFetching}
          onRefresh={refreshPrices}
          onOpenSettings={() => goTo('settings')}
        />

        <main className="flex-1 px-4 pt-4">
          {showSwitch && (
            <div className="grid grid-cols-2 gap-1 bg-[#161920] border border-[#23272f] rounded-xl p-1 mb-4">
              {MARKETS.map((m) => (
                <button
                  key={m}
                  onClick={() => changeMarket(m)}
                  className={`py-2.5 rounded-lg text-sm font-medium ${market === m ? 'bg-[#2a2f3a] text-slate-100' : 'text-slate-400'}`}
                >
                  {m === 'spot' ? 'Spot' : 'Futuros'}
                  {openSignalsBy(m) > 0 && <span className="ml-2 text-xs text-slate-500">{openSignalsBy(m)}</span>}
                </button>
              ))}
            </div>
          )}

          {activeTab === 'signals' && (
            <SignalsView
              market={market}
              futuresLeverage={settings.futuresLeverage}
              scanInfo={scanInfo}
              signals={signals}
              account={paperAccount}
              realCapital={settings.realCapital}
              realRiskPercent={settings.realRiskPercent}
              onSimulate={(s) => openTrade(market, findAsset(s.symbol, s.entryPrice, market), s)}
              onClosePosition={handleClosePosition}
              onSelectCoinBySymbol={handleSelectCoinBySymbol}
              isDemoData={market === 'spot' && isDemoMode}
              demoReason={demoReason}
            />
          )}

          {activeTab === 'wallet' && (
            <WalletView
              market={market}
              account={paperAccount}
              assets={market === 'futures' ? futuresAssets : assets}
              onClosePosition={handleClosePosition}
              onResetBalance={handleResetBalance}
              onClearHistory={handleClearHistory}
              onSelectCoinBySymbol={handleSelectCoinBySymbol}
            />
          )}

          {activeTab === 'market' && (
            <MarketView assets={assets} coins={scanInfos.spot?.coins ?? []} onSelectCoin={(a) => handleSelectCoin(a, 'spot', 'market')} />
          )}

          {activeTab === 'details' && (
            <CoinDetailsView asset={selectedCoin} market={detailsMarket} signals={signalsBy[detailsMarket]} onBack={() => goTo(backTab)} onOpenTradeModal={(asset) => openTrade(detailsMarket, asset)} />
          )}

          {activeTab === 'settings' && (
            <SettingsView settings={settings} scanInfos={scanInfos} onSaveSettings={handleSaveSettings} onBack={() => goTo('signals')} />
          )}
        </main>

        <BottomNav
          activeTab={activeTab}
          onSelectTab={goTo}
          openSignals={openSignals}
          openPositions={paperAccount.positions.filter((p) => p.status === 'OPEN').length}
        />

        <TradeSheet
          market={trade?.market ?? 'spot'}
          asset={trade?.asset ?? null}
          signal={trade?.signal}
          balance={accounts[trade?.market ?? 'spot'].virtualBalance}
          defaultLeverage={settings.futuresLeverage ?? DEFAULT_FUTURES_LEVERAGE}
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

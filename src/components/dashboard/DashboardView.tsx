import React from 'react';
import { ArrowUpRight, ArrowDownRight, Radio, Activity, Wallet, ShieldAlert, ChevronRight, Zap } from 'lucide-react';
import { CryptoAsset, TechnicalSignal } from '../../types/crypto';
import { Sparkline } from '../common/Sparkline';
import { Badge } from '../common/Badge';
import { FearGreedIndex } from './FearGreedIndex';

interface DashboardViewProps {
  assets: CryptoAsset[];
  signals: TechnicalSignal[];
  onSelectCoin: (asset: CryptoAsset) => void;
  onNavigateToSignals: () => void;
  onNavigateToPaper: () => void;
  onOpenTradeModal: (asset: CryptoAsset) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  assets,
  signals,
  onSelectCoin,
  onNavigateToSignals,
  onNavigateToPaper,
  onOpenTradeModal
}) => {
  // Principais ativos em destaque (BTC, ETH, SOL)
  const btc = assets.find(a => a.symbol === 'BTCUSDT') || assets[0];
  const eth = assets.find(a => a.symbol === 'ETHUSDT') || assets[1];
  const sol = assets.find(a => a.symbol === 'SOLUSDT') || assets[2];
  const heroAssets = [btc, eth, sol].filter(Boolean);

  // Sinais recentes (primeiros 3)
  const recentSignals = signals.slice(0, 3);

  const formatPrice = (val: number) => {
    return val.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: val < 10 ? 4 : 2,
      maximumFractionDigits: val < 10 ? 4 : 2
    });
  };

  return (
    <div className="space-y-4 pb-20">
      {/* Banner de Risco & Isenção */}
      <div className="bg-[#121622] border border-slate-800 rounded-2xl p-3 text-[11px] text-slate-300 flex items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-slate-300">
            Ambiente educacional de análise e simulação. <strong className="text-amber-300 font-semibold">Sem ordens reais.</strong>
          </span>
        </div>
        <Badge variant="demo" size="sm">DEMO</Badge>
      </div>

      {/* Destaque das Principais Moedas (BTC, ETH, SOL) */}
      <section className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-emerald-400" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Destaques do Mercado
            </h2>
          </div>
          <span className="text-[10px] text-slate-500 font-mono">24h Variação</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {heroAssets.map((coin) => {
            const isPositive = coin.change24h >= 0;
            return (
              <div
                key={coin.symbol}
                onClick={() => onSelectCoin(coin)}
                role="button"
                tabIndex={0}
                className="group relative bg-[#121722] hover:bg-[#182030] active:scale-[0.99] border border-slate-800/90 hover:border-slate-700 rounded-2xl p-3.5 transition-all cursor-pointer shadow-lg shadow-black/20"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-slate-800 flex items-center justify-center font-bold text-xs text-white border border-slate-700">
                      {coin.baseAsset.slice(0, 3)}
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white group-hover:text-emerald-400 transition">
                        {coin.baseAsset}
                      </h3>
                      <p className="text-[10px] text-slate-400">{coin.name}</p>
                    </div>
                  </div>

                  <span
                    className={`inline-flex items-center text-xs font-bold px-2 py-0.5 rounded-lg ${
                      isPositive
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-rose-500/15 text-rose-400'
                    }`}
                  >
                    {isPositive ? (
                      <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" />
                    ) : (
                      <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" />
                    )}
                    {isPositive ? '+' : ''}
                    {coin.change24h.toFixed(2)}%
                  </span>
                </div>

                {/* Preço e Sparkline */}
                <div className="mt-3 flex items-end justify-between">
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider block">Preço</span>
                    <span className="text-base font-bold font-mono text-white tracking-tight">
                      {formatPrice(coin.price)}
                    </span>
                  </div>
                  <Sparkline
                    data={coin.sparkline}
                    isPositive={isPositive}
                    width={76}
                    height={26}
                  />
                </div>

                {/* Dados rápidos 24h & Ação Simular */}
                <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400">
                  <span>Mín: {formatPrice(coin.low24h)}</span>
                  <span>Máx: {formatPrice(coin.high24h)}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenTradeModal(coin);
                    }}
                    className="text-emerald-400 hover:text-emerald-300 font-medium flex items-center gap-0.5 ml-1"
                    title="Simular ordem"
                  >
                    <Zap className="w-3 h-3" />
                    Simular
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Índice de Sentimento de Medo & Ganância (Calculado dinamicamente sobre os ativos) */}
      <FearGreedIndex assets={assets} />

      {/* Pulso Rápido do Mercado (Dominância & Volume) */}
      <section className="bg-[#121722] border border-slate-800/90 rounded-2xl p-3">
        <div className="grid grid-cols-2 gap-2 text-center divide-x divide-slate-800">
          <div>
            <span className="text-[10px] text-slate-500 uppercase">Dominância BTC (Estimada)</span>
            <p className="text-sm font-bold text-white font-mono mt-0.5">56.4%</p>
            <span className="text-[9px] text-emerald-400 font-mono">+0.4% hoje</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase">Volume Global 24h</span>
            <p className="text-sm font-bold text-white font-mono mt-0.5">$74.2 B</p>
            <span className="text-[9px] text-slate-400 font-mono">Binance API + Ref</span>
          </div>
        </div>
      </section>

      {/* Radar de Sinais Recentes */}
      <section className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-1.5">
            <Radio className="w-4 h-4 text-cyan-400 animate-pulse" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Radar de Sinais Técnicos (DEMO)
            </h2>
          </div>
          <button
            onClick={onNavigateToSignals}
            className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-0.5"
          >
            Ver todos <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="space-y-2">
          {recentSignals.map((signal) => {
            const isLong = signal.direction === 'LONG';
            return (
              <div
                key={signal.id}
                className="bg-[#121722] border border-slate-800/90 hover:border-slate-700/80 rounded-2xl p-3 transition"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded-lg ${
                        isLong
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                      }`}
                    >
                      {isLong ? 'LONG ↑' : 'SHORT ↓'}
                    </span>
                    <span className="text-sm font-bold text-white">{signal.symbol}</span>
                    <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">
                      {signal.timeframe}
                    </span>
                  </div>

                  <Badge variant={signal.status === 'OPEN' ? 'cyan' : 'neutral'} size="sm">
                    {signal.status === 'OPEN' ? 'EM ABERTO' : 'ALVO ATINGIDO'}
                  </Badge>
                </div>

                <p className="text-xs text-slate-300 mt-2 font-medium">
                  {signal.strategyName}
                </p>

                <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                  {signal.technicalReason}
                </p>

                {/* Preços chave do sinal */}
                <div className="mt-2.5 pt-2 border-t border-slate-800/80 grid grid-cols-3 gap-1 text-[11px] font-mono">
                  <div>
                    <span className="text-[9px] text-slate-500 block">ENTRADA</span>
                    <span className="text-white">${signal.entryPrice.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-500 block">ALVO (TP)</span>
                    <span className="text-emerald-400">${signal.targetPrice.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-500 block">STOP LOSS</span>
                    <span className="text-rose-400">${signal.stopLossPrice.toLocaleString()}</span>
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-between pt-1">
                  <span className="text-[10px] text-slate-500">
                    Risco/Retorno: <strong className="text-slate-300">{signal.riskRewardRatio}</strong>
                  </span>
                  <button
                    onClick={() => {
                      const coin = assets.find(a => a.symbol === signal.symbol) || assets[0];
                      onOpenTradeModal(coin);
                    }}
                    className="text-[11px] text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-1 rounded-lg transition flex items-center gap-1 font-medium"
                  >
                    <Wallet className="w-3 h-3" />
                    Simular Ordem
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Cartão de Acesso Rápido ao Paper Trading */}
      <section 
        onClick={onNavigateToPaper}
        role="button"
        tabIndex={0}
        className="cursor-pointer bg-gradient-to-r from-slate-900 via-[#131b2c] to-slate-900 border border-slate-700/60 rounded-2xl p-4 flex items-center justify-between shadow-lg"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
            <Wallet className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
              Simulador Paper Trading
              <span className="text-[10px] text-emerald-400 font-mono font-normal">$10,000 USDT</span>
            </h3>
            <p className="text-[11px] text-slate-400">
              Pratique estratégias sem arriscar capital real
            </p>
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-slate-400" />
      </section>
    </div>
  );
};

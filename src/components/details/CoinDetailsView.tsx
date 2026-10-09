import React, { useState, useMemo } from 'react';
import { ArrowLeft, ArrowUpRight, ArrowDownRight, BarChart2, LineChart, Wallet, Info } from 'lucide-react';
import { CryptoAsset, Timeframe } from '../../types/crypto';
import { generateCandlesForAsset } from '../../services/mockData';
import { CandlestickChart } from './CandlestickChart';
import { OrderBookMini } from './OrderBookMini';
import { Badge } from '../common/Badge';

interface CoinDetailsViewProps {
  asset: CryptoAsset;
  onBack: () => void;
  onOpenTradeModal: (asset: CryptoAsset) => void;
}

export const CoinDetailsView: React.FC<CoinDetailsViewProps> = ({
  asset,
  onBack,
  onOpenTradeModal
}) => {
  const [timeframe, setTimeframe] = useState<Timeframe>('4h');
  const [chartType, setChartType] = useState<'candle' | 'line'>('candle');
  const [showEma20, setShowEma20] = useState(true);
  const [showEma50, setShowEma50] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [showRsi, setShowRsi] = useState(true);
  const [showMacd, setShowMacd] = useState(false);

  // Gera velas de alta fidelidade baseadas no ativo e timeframe
  const candleCount = timeframe === '15m' ? 48 : timeframe === '1h' ? 40 : 36;
  const candles = useMemo(() => {
    return generateCandlesForAsset(asset, candleCount);
  }, [asset, timeframe, candleCount]);

  const isPositive = asset.change24h >= 0;

  const formatPrice = (val: number) => {
    return val.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: val < 10 ? 4 : 2,
      maximumFractionDigits: val < 10 ? 4 : 2
    });
  };

  return (
    <div className="space-y-3 pb-28">
      {/* Barra de Navegação Superior da Moeda */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-white bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl transition"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Voltar ao Mercado</span>
        </button>

        <div className="flex items-center gap-1.5">
          <Badge variant="demo" size="sm">DEMO TÉCNICO</Badge>
          <span className="text-[10px] text-slate-500 font-mono">
            {asset.exchanges.join(' / ').toUpperCase()}
          </span>
        </div>
      </div>

      {/* Cabeçalho do Ativo */}
      <div className="bg-[#121722] border border-slate-800/90 rounded-2xl p-4 shadow-lg">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center font-bold text-xs text-white border border-slate-700">
                {asset.baseAsset.slice(0, 3)}
              </div>
              <h2 className="text-lg font-bold text-white tracking-tight">
                {asset.baseAsset}
                <span className="text-xs text-slate-400 font-normal ml-1">/{asset.quoteAsset}</span>
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">{asset.name}</p>
          </div>

          <div className="text-right">
            <div className="text-xl font-bold font-mono text-white tracking-tight">
              {formatPrice(asset.price)}
            </div>
            <div className="flex justify-end mt-1">
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
                {asset.change24h.toFixed(2)}%
              </span>
            </div>
          </div>
        </div>

        {/* Métricas 24h */}
        <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-800 text-[11px] font-mono">
          <div>
            <span className="text-[9px] text-slate-500 uppercase block font-sans">Mínima 24h</span>
            <span className="text-slate-300 font-semibold">{formatPrice(asset.low24h)}</span>
          </div>
          <div>
            <span className="text-[9px] text-slate-500 uppercase block font-sans">Máxima 24h</span>
            <span className="text-slate-300 font-semibold">{formatPrice(asset.high24h)}</span>
          </div>
          <div>
            <span className="text-[9px] text-slate-500 uppercase block font-sans">Volume 24h</span>
            <span className="text-slate-300 font-semibold">
              ${(asset.volume24h / 1e6).toFixed(1)}M
            </span>
          </div>
        </div>
      </div>

      {/* Controles de Gráfico & Timeframes */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-1">
          {/* Seletor de Timeframe */}
          <div className="flex items-center gap-1 bg-[#121722] border border-slate-800 rounded-xl p-1 overflow-x-auto no-scrollbar">
            {(['15m', '1h', '4h', '1D', '1W'] as Timeframe[]).map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                  timeframe === tf
                    ? 'bg-slate-800 text-emerald-400 font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* Alternar Velas / Linha */}
          <div className="flex items-center gap-1 bg-[#121722] border border-slate-800 rounded-xl p-1 shrink-0">
            <button
              onClick={() => setChartType('candle')}
              className={`p-1.5 rounded-lg transition ${
                chartType === 'candle'
                  ? 'bg-slate-800 text-emerald-400'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Velas Japonesas (Candlesticks)"
            >
              <BarChart2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setChartType('line')}
              className={`p-1.5 rounded-lg transition ${
                chartType === 'line'
                  ? 'bg-slate-800 text-emerald-400'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Gráfico em Linha"
            >
              <LineChart className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Toggles de Indicadores Técnicos */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 text-[11px]">
          <span className="text-[10px] text-slate-500 font-semibold uppercase shrink-0">
            Indicadores:
          </span>

          <button
            onClick={() => setShowEma20(!showEma20)}
            className={`px-2.5 py-0.5 rounded-lg border transition shrink-0 ${
              showEma20
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 font-semibold'
                : 'bg-slate-900 text-slate-500 border-slate-800'
            }`}
          >
            EMA 20
          </button>

          <button
            onClick={() => setShowEma50(!showEma50)}
            className={`px-2.5 py-0.5 rounded-lg border transition shrink-0 ${
              showEma50
                ? 'bg-purple-500/20 text-purple-300 border-purple-500/40 font-semibold'
                : 'bg-slate-900 text-slate-500 border-slate-800'
            }`}
          >
            EMA 50
          </button>

          <button
            onClick={() => setShowVolume(!showVolume)}
            className={`px-2.5 py-0.5 rounded-lg border transition shrink-0 ${
              showVolume
                ? 'bg-slate-800 text-slate-200 border-slate-700 font-semibold'
                : 'bg-slate-900 text-slate-500 border-slate-800'
            }`}
          >
            Volume
          </button>

          <button
            onClick={() => setShowRsi(!showRsi)}
            className={`px-2.5 py-0.5 rounded-lg border transition shrink-0 ${
              showRsi
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-semibold'
                : 'bg-slate-900 text-slate-500 border-slate-800'
            }`}
          >
            RSI (14)
          </button>

          <button
            onClick={() => setShowMacd(!showMacd)}
            className={`px-2.5 py-0.5 rounded-lg border transition shrink-0 ${
              showMacd
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 font-semibold'
                : 'bg-slate-900 text-slate-500 border-slate-800'
            }`}
          >
            MACD
          </button>
        </div>
      </div>

      {/* Gráfico Interativo de Alta Performance */}
      <CandlestickChart
        candles={candles}
        chartType={chartType}
        showEma20={showEma20}
        showEma50={showEma50}
        showVolume={showVolume}
        showRsi={showRsi}
        showMacd={showMacd}
        height={340}
      />

      {/* Termômetro Técnico & Resumo Educacional */}
      <div className="bg-[#121722] border border-slate-800 rounded-2xl p-3.5 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-cyan-400" />
            Diagnóstico Técnico ({timeframe})
          </h3>
          <span className="text-[10px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded font-mono">
            EDUCACIONAL
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center pt-1">
          <div className="bg-slate-900/80 p-2 rounded-xl border border-slate-800">
            <span className="text-[10px] text-slate-400 block">Osciladores</span>
            <span className="text-xs font-bold text-amber-400 mt-0.5 block">Neutro</span>
            <span className="text-[9px] text-slate-500">RSI: 54.2</span>
          </div>

          <div className="bg-slate-900/80 p-2 rounded-xl border border-slate-800">
            <span className="text-[10px] text-slate-400 block">Médias Móveis</span>
            <span className="text-xs font-bold text-emerald-400 mt-0.5 block">Compra Forte</span>
            <span className="text-[9px] text-slate-500">EMA20 &gt; EMA50</span>
          </div>

          <div className="bg-slate-900/80 p-2 rounded-xl border border-slate-800">
            <span className="text-[10px] text-slate-400 block">Resumo dos Sinais</span>
            <span className="text-xs font-bold text-emerald-400 mt-0.5 block">11 Compra / 3 Venda</span>
            <span className="text-[9px] text-slate-500">Volatilidade Média</span>
          </div>
        </div>
      </div>

      {/* Livro de Ofertas Nível 2 Simulado */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 px-1 mb-1.5">
          Profundidade de Mercado (Order Book DEMO)
        </h3>
        <OrderBookMini currentPrice={asset.price} />
      </div>

      {/* Botão de Ação Rápida de Simulação com o Polegar */}
      <div className="sticky bottom-16 z-30 pt-2">
        <button
          onClick={() => onOpenTradeModal(asset)}
          className="w-full bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] text-slate-950 font-bold py-3.5 px-4 rounded-2xl shadow-xl shadow-emerald-500/20 flex items-center justify-center gap-2 text-sm transition"
        >
          <Wallet className="w-4 h-4" />
          Simular Operação com {asset.baseAsset} (Paper Trading)
        </button>
      </div>
    </div>
  );
};

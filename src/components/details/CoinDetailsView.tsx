import React, { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, Maximize2, RotateCw } from 'lucide-react';
import { CryptoAsset, CandleData, Timeframe } from '../../types/crypto';
import { apiService } from '../../services/apiService';
import { calculateTechnicalDiagnosis } from '../../services/indicators';
import { CandlestickChart } from './CandlestickChart';
import { fmtPrice, fmtPct, pnlColor } from '../common/format';

interface CoinDetailsViewProps {
  asset: CryptoAsset;
  onBack: () => void;
  onOpenTradeModal: (asset: CryptoAsset) => void;
}

const TIMEFRAMES: Timeframe[] = ['15m', '1h', '4h', '1D', '1W'];

export const CoinDetailsView: React.FC<CoinDetailsViewProps> = ({ asset, onBack, onOpenTradeModal }) => {
  const [timeframe, setTimeframe] = useState<Timeframe>('4h');
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isChartExpanded, setIsChartExpanded] = useState(false);
  const [isChartRotated, setIsChartRotated] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiService
      .fetchHistoricalKlines(asset.symbol, timeframe, asset, 120)
      .then((res) => {
        if (!active) return;
        // Nunca mostra velas sintéticas como se fossem reais
        setLive(res.isLive);
        setCandles(res.isLive ? res.candles : []);
      })
      .catch(() => active && (setLive(false), setCandles([])))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [asset.symbol, timeframe]);

  const diagnosis = useMemo(() => calculateTechnicalDiagnosis(candles), [candles]);
  const verdictColor =
    diagnosis.summary.sentiment === 'bullish' ? 'text-emerald-400'
    : diagnosis.summary.sentiment === 'bearish' ? 'text-rose-400' : 'text-slate-300';

  const hasPrice = asset.price > 0;

  return (
    <div className="space-y-4 pb-28">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-slate-300 py-1 hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4" /> Voltar ao Mercado
      </button>

      <div>
        <div className="text-sm text-slate-400">{asset.name}</div>
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-semibold text-slate-100 tabular-nums">{hasPrice ? `$${fmtPrice(asset.price)}` : '—'}</span>
          {hasPrice && <span className={`text-base ${pnlColor(asset.change24h)}`}>{fmtPct(asset.change24h)} em 24h</span>}
        </div>
      </div>

      {loading ? (
        <div className="bg-[#111622] border border-slate-800 rounded-2xl p-12 text-center">
          <p className="text-sm text-slate-400 animate-pulse">Carregando dados históricos da Binance…</p>
        </div>
      ) : live ? (
        <>
          {/* Barra de Acesso Rápido ao Gráfico TradingView & Fullscreen Mobile */}
          <div className="flex items-center justify-between gap-2 flex-wrap bg-[#111622] p-2.5 rounded-xl border border-slate-800">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-semibold text-slate-200">Gráfico Interativo Binance</span>
              <span className="text-[11px] text-slate-400 hidden sm:inline">· TradingView Guide</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  setIsChartRotated(true);
                  setIsChartExpanded(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600/20 hover:bg-purple-600/30 text-purple-200 border border-purple-500/30 rounded-lg text-xs font-medium transition-all"
                title="Abrir no modo paisagem rotacionado horizontalmente a 90° (otimizado para telas pequenas)"
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span>Modo Paisagem (90°)</span>
              </button>
              <button
                onClick={() => {
                  setIsChartRotated(false);
                  setIsChartExpanded(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 rounded-lg text-xs font-medium transition-all"
                title="Expandir gráfico em tela cheia (Fullscreen)"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Fullscreen</span>
              </button>
            </div>
          </div>

          <CandlestickChart
            candles={candles}
            assetSymbol={asset.symbol}
            assetName={asset.name}
            currentPrice={asset.price}
            priceChange24h={asset.change24h}
            timeframe={timeframe}
            onChangeTimeframe={(tf) => setTimeframe(tf)}
            onOpenTradeModal={() => onOpenTradeModal(asset)}
            chartType="candle"
            showEma20={true}
            showEma50={true}
            showBollinger={false}
            showVolume={true}
            showRsi={false}
            showMacd={false}
            height={340}
            isExpandable={true}
            isExpanded={isChartExpanded}
            onToggleExpand={(exp) => setIsChartExpanded(exp)}
            isRotated={isChartRotated}
            onToggleRotate={(rot) => setIsChartRotated(rot)}
          />
          <div className="bg-[#161920] border border-[#23272f] rounded-xl p-4">
            <div className="text-sm text-slate-400">Leitura técnica ({timeframe})</div>
            <div className={`text-lg font-semibold ${verdictColor}`}>{diagnosis.summary.verdict}</div>
            <div className="text-sm text-slate-400 mt-1">
              {diagnosis.summary.buyCount} indicadores a favor da compra · {diagnosis.summary.sellCount} da venda ·{' '}
              {diagnosis.summary.neutralCount} neutros
            </div>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              RSI, posição do preço nas médias de 20 e 50 períodos e MACD. É uma leitura de apoio, não um sinal de entrada.
            </p>
          </div>
        </>
      ) : (
        <p className="text-sm text-slate-400 bg-[#161920] border border-[#23272f] rounded-xl p-4">
          Não foi possível carregar o gráfico real agora. Tente atualizar em instantes.
        </p>
      )}

      {hasPrice && (
        <div className="fixed left-0 right-0 bottom-[68px] z-30 px-4">
          <div className="max-w-2xl mx-auto">
            <button
              onClick={() => onOpenTradeModal(asset)}
              className="w-full bg-slate-100 text-slate-900 font-semibold py-3.5 rounded-lg text-base"
            >
              Simular compra de {asset.baseAsset}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

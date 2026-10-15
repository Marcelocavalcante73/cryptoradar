import React, { useState, useEffect, useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';
import { CryptoAsset, CandleData, Timeframe, TechnicalSignal, MarketType } from '../../types/crypto';
import { apiService } from '../../services/apiService';
import { calculateTechnicalDiagnosis } from '../../services/indicators';
import { TvChart, ChartLevel } from './TvChart';
import { fmtPrice, fmtPct, pnlColor } from '../common/format';

interface CoinDetailsViewProps {
  asset: CryptoAsset;
  market?: MarketType;
  signals?: TechnicalSignal[];
  onBack: () => void;
  onOpenTradeModal: (asset: CryptoAsset) => void;
}

const TIMEFRAMES: Timeframe[] = ['15m', '1h', '4h', '1D', '1W'];

export const CoinDetailsView: React.FC<CoinDetailsViewProps> = ({ asset, market = 'spot', signals = [], onBack, onOpenTradeModal }) => {
  const [timeframe, setTimeframe] = useState<Timeframe>('4h');
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    (market === 'futures'
      ? apiService.fetchFuturesKlines(asset.symbol, timeframe, 300)
      : apiService.fetchHistoricalKlines(asset.symbol, timeframe, asset, 300))
      .then((res) => {
        if (!active) return;
        // Nunca mostra velas sintéticas como se fossem reais
        setLive(res.isLive);
        setCandles(res.isLive ? res.candles : []);
      })
      .catch(() => active && (setLive(false), setCandles([])))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [asset.symbol, timeframe, market]);

  const diagnosis = useMemo(() => calculateTechnicalDiagnosis(candles), [candles]);
  const verdictColor =
    diagnosis.summary.sentiment === 'bullish' ? 'text-emerald-400'
    : diagnosis.summary.sentiment === 'bearish' ? 'text-rose-400' : 'text-slate-300';

  // Entrada, stop e alvo do sinal de compra aberto desta moeda, desenhados sobre o gráfico
  const levels = useMemo<ChartLevel[]>(() => {
    const sig = signals.find((x) => x.symbol === asset.symbol && x.status === 'OPEN' && (market === 'futures' || x.direction === 'LONG'));
    return sig
      ? [
          { price: sig.entryPrice, color: '#cbd5e1', title: 'Entrada' },
          { price: sig.targetPrice, color: '#26a69a', title: 'Alvo' },
          { price: sig.stopLossPrice, color: '#ef5350', title: 'Stop' }
        ]
      : [];
  }, [signals, asset.symbol]);

  const hasPrice = asset.price > 0;

  return (
    <div className="space-y-4 pb-28">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-slate-300 py-1 hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4" /> Voltar
      </button>

      <div>
        <div className="text-sm text-slate-400">{asset.name}</div>
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-semibold text-slate-100 tabular-nums">{hasPrice ? `$${fmtPrice(asset.price)}` : '—'}</span>
          {hasPrice && market === 'spot' && <span className={`text-base ${pnlColor(asset.change24h)}`}>{fmtPct(asset.change24h)} em 24h</span>}
        </div>
      </div>

      {loading ? (
        <div className="bg-[#111622] border border-slate-800 rounded-2xl p-12 text-center">
          <p className="text-sm text-slate-400 animate-pulse">Carregando dados históricos da Binance…</p>
        </div>
      ) : live ? (
        <>
          <div className="inline-flex bg-[#181A20] border border-[#2B313A] rounded-lg p-0.5">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors cursor-pointer ${timeframe === tf ? 'bg-[#2B313A] text-[#F0B90B] font-semibold' : 'text-[#848E9C] hover:text-[#EAECEF]'}`}
              >
                {tf}
              </button>
            ))}
          </div>

          <TvChart candles={candles} levels={levels} tvSymbol={market === 'futures' ? `BINANCE:${asset.symbol}.P` : `BINANCE:${asset.symbol}`} height={340} />
          <div className="bg-[#181A20] border border-[#2B313A] rounded-xl p-4 shadow-sm">
            <div className="text-xs text-[#848E9C]">Leitura Técnica ({timeframe})</div>
            <div className={`text-base font-bold mt-0.5 ${verdictColor}`}>{diagnosis.summary.verdict}</div>
            <div className="text-xs text-[#848E9C] mt-1 font-mono">
              {diagnosis.summary.buyCount} compras · {diagnosis.summary.sellCount} vendas ·{' '}
              {diagnosis.summary.neutralCount} neutros
            </div>
            <p className="text-[11px] text-[#848E9C] mt-2 leading-relaxed">
              RSI, posição do preço nas médias móveis de 20 e 50 períodos e histograma MACD.
            </p>
          </div>
        </>
      ) : (
        <p className="text-xs text-[#848E9C] bg-[#181A20] border border-[#2B313A] rounded-xl p-4">
          Não foi possível carregar o gráfico real agora. Tente atualizar em instantes.
        </p>
      )}

      {hasPrice && (
        <div className="fixed left-0 right-0 bottom-[68px] z-30 px-4">
          <div className="max-w-2xl mx-auto">
            <button
              onClick={() => onOpenTradeModal(asset)}
              className="w-full bg-[#F0B90B] hover:bg-[#FCD535] text-black font-semibold py-3 rounded-lg text-xs shadow-md transition-all cursor-pointer active:scale-95"
            >
              {market === 'futures' ? `Simular Ordem em ${asset.baseAsset} Futuros` : `Simular Compra de ${asset.baseAsset}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

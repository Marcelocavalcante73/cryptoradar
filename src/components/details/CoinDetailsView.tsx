import React, { useState, useEffect, useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';
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

const TIMEFRAMES: Timeframe[] = ['1h', '4h', '1D'];

export const CoinDetailsView: React.FC<CoinDetailsViewProps> = ({ asset, onBack, onOpenTradeModal }) => {
  const [timeframe, setTimeframe] = useState<Timeframe>('4h');
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiService
      .fetchHistoricalKlines(asset.symbol, timeframe, asset, 80)
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
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-slate-300 py-1">
        <ArrowLeft className="w-4 h-4" /> Mercado
      </button>

      <div>
        <div className="text-sm text-slate-400">{asset.name}</div>
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-semibold text-slate-100 tabular-nums">{hasPrice ? `$${fmtPrice(asset.price)}` : '—'}</span>
          {hasPrice && <span className={`text-base ${pnlColor(asset.change24h)}`}>{fmtPct(asset.change24h)} em 24h</span>}
        </div>
      </div>

      <div className="inline-flex bg-[#161920] border border-[#23272f] rounded-lg p-0.5">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            onClick={() => setTimeframe(tf)}
            className={`px-4 py-1.5 text-sm rounded-md ${timeframe === tf ? 'bg-[#2a2f3a] text-slate-100' : 'text-slate-400'}`}
          >
            {tf}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 py-10 text-center">Carregando gráfico…</p>
      ) : live ? (
        <>
          <CandlestickChart
            candles={candles}
            chartType="candle"
            showEma20
            showEma50
            showVolume={false}
            showRsi={false}
            showMacd={false}
            height={300}
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

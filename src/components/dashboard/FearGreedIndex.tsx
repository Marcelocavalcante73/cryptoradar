import React, { useMemo } from 'react';
import { Gauge, TrendingUp, TrendingDown, Info, ShieldAlert } from 'lucide-react';
import { CryptoAsset } from '../../types/crypto';
import { calculateFearGreedIndex } from '../../services/indicators';

interface FearGreedIndexProps {
  assets: CryptoAsset[];
}

export const FearGreedIndex: React.FC<FearGreedIndexProps> = ({ assets }) => {
  const sentimentData = useMemo(() => {
    return calculateFearGreedIndex(assets);
  }, [assets]);

  const {
    score,
    label,
    bgClass,
    textClass,
    borderClass,
    averageChange,
    advancersCount,
    declinersCount,
    totalAssets
  } = sentimentData;

  // Principais ativos de referência (BTC, ETH, SOL)
  const btc = assets.find((a) => a.symbol === 'BTCUSDT');
  const eth = assets.find((a) => a.symbol === 'ETHUSDT');
  const sol = assets.find((a) => a.symbol === 'SOLUSDT');

  return (
    <section className="bg-[#121722] border border-slate-800/90 rounded-2xl p-4 shadow-lg space-y-3.5">
      {/* Cabeçalho do Card */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center text-cyan-400 border border-slate-700/80">
            <Gauge className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              Índice de Medo & Ganância
              <span className="text-[9px] font-mono bg-amber-500/10 text-amber-300 border border-amber-500/30 px-1.5 py-0.2 rounded font-normal">
                DEMO
              </span>
            </h3>
            <p className="text-[10px] text-slate-400">
              Sentimento calculado com base nas oscilações dos principais ativos
            </p>
          </div>
        </div>

        {/* Badge do Sentimento */}
        <span
          className={`text-xs font-bold px-2.5 py-1 rounded-xl border font-mono tracking-tight ${bgClass} ${textClass} ${borderClass}`}
        >
          {label}
        </span>
      </div>

      {/* Indicador Central: Pontuação e Barra Gradiente */}
      <div className="bg-[#0D111A] border border-slate-800/80 rounded-xl p-3 space-y-2.5">
        <div className="flex items-end justify-between">
          <div>
            <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
              Pontuação Composta (0-100)
            </span>
            <div className="flex items-baseline gap-1.5">
              <span className={`text-3xl font-black font-mono tracking-tight ${textClass}`}>
                {score}
              </span>
              <span className="text-xs font-mono text-slate-500">/ 100</span>
            </div>
          </div>

          <div className="text-right">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
              Variação Média 24h
            </span>
            <span
              className={`text-xs font-bold font-mono inline-flex items-center gap-0.5 ${
                averageChange >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {averageChange >= 0 ? (
                <TrendingUp className="w-3.5 h-3.5" />
              ) : (
                <TrendingDown className="w-3.5 h-3.5" />
              )}
              {averageChange >= 0 ? '+' : ''}
              {averageChange}%
            </span>
          </div>
        </div>

        {/* Barra de Progresso com Zonas de Sentimento */}
        <div className="space-y-1">
          <div className="relative h-2.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
            {/* Gradiente de fundo: Medo Extremo (vermelho) -> Neutro (ardósia) -> Ganância Extrema (verde) */}
            <div className="absolute inset-0 bg-gradient-to-r from-rose-500 via-orange-400 via-slate-400 via-emerald-400 to-green-500 opacity-80" />

            {/* Marcador atual com corte */}
            <div
              className="absolute top-0 bottom-0 w-2.5 bg-white rounded-full shadow-md border-2 border-slate-950 transition-all duration-500 -translate-x-1/2"
              style={{ left: `${score}%` }}
              title={`Sentimento atual: ${score}/100 (${label})`}
            />
          </div>

          {/* Rótulos dos extremos */}
          <div className="flex justify-between text-[9px] font-mono text-slate-500 px-0.5">
            <span className="text-rose-400">0 (Medo Extremo)</span>
            <span className="text-slate-400">50 (Neutro)</span>
            <span className="text-emerald-400">100 (Ganância)</span>
          </div>
        </div>
      </div>

      {/* Métricas dos Ativos Monitores de Referência */}
      <div className="grid grid-cols-3 gap-2 text-center pt-1 border-t border-slate-800/80 text-[11px] font-mono">
        {btc && (
          <div className="bg-slate-900/60 rounded-lg p-2 border border-slate-800/60">
            <span className="text-[9px] text-slate-400 block font-sans">BTC (Peso 40%)</span>
            <span className={`font-bold block ${btc.change24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {btc.change24h >= 0 ? '+' : ''}{btc.change24h.toFixed(2)}%
            </span>
          </div>
        )}
        {eth && (
          <div className="bg-slate-900/60 rounded-lg p-2 border border-slate-800/60">
            <span className="text-[9px] text-slate-400 block font-sans">ETH (Peso 25%)</span>
            <span className={`font-bold block ${eth.change24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {eth.change24h >= 0 ? '+' : ''}{eth.change24h.toFixed(2)}%
            </span>
          </div>
        )}
        {sol && (
          <div className="bg-slate-900/60 rounded-lg p-2 border border-slate-800/60">
            <span className="text-[9px] text-slate-400 block font-sans">SOL (Peso 15%)</span>
            <span className={`font-bold block ${sol.change24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {sol.change24h >= 0 ? '+' : ''}{sol.change24h.toFixed(2)}%
            </span>
          </div>
        )}
      </div>

      {/* Amplitude e Transparência do Cálculo */}
      <div className="flex items-center justify-between text-[10px] text-slate-400 bg-slate-900/40 rounded-lg px-2.5 py-1.5 border border-slate-800/60">
        <div className="flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <span>
            Amplitude: <strong className="text-emerald-400">{advancersCount} em alta</strong> vs{' '}
            <strong className="text-rose-400">{declinersCount} em baixa</strong> ({totalAssets} pares)
          </span>
        </div>
        <span className="text-slate-500 font-mono text-[9px]">Algorítmico</span>
      </div>
    </section>
  );
};

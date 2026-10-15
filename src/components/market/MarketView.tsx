import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { CryptoAsset, MarketType } from '../../types/crypto';
import { fmtPrice, fmtPct } from '../common/format';

export interface MarketCoin {
  rank: number;
  baseAsset: string;
  name: string;
  symbol: string;
}

interface MarketViewProps {
  assets: CryptoAsset[];
  coins: MarketCoin[];            // universo do scanner (top 100 ∩ corretoras), em ordem de ranking
  onSelectCoin: (asset: CryptoAsset) => void;
  market?: MarketType;
}

export const MarketView: React.FC<MarketViewProps> = ({ assets, coins, onSelectCoin, market = 'spot' }) => {
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const bySymbol = new Map(assets.map((a) => [a.symbol, a]));
    const base: MarketCoin[] = coins.length
      ? coins
      : assets.map((a, i) => ({ rank: i + 1, baseAsset: a.baseAsset, name: a.name, symbol: a.symbol }));
    const q = query.trim().toLowerCase();
    return base
      .filter((c) => !q || c.baseAsset.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q))
      .map((c) => ({ coin: c, asset: bySymbol.get(c.symbol) }));
  }, [assets, coins, query]);

  const isFutures = market === 'futures';

  return (
    <div className="space-y-3 pb-24 text-[#F1F5F9]">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-[#F1F5F9]">
            {isFutures ? 'Mercado Futuros USDT-M' : 'Mercado Cripto à Vista'}
          </h2>
          <p className="text-xs text-[#94A3B8]">
            {isFutures ? 'Contratos perpétuos com alavancagem' : coins.length ? 'Top pares por capitalização de mercado' : 'Principais criptoativos'}
          </p>
        </div>
        {isFutures && (
          <span className="text-[11px] px-2 py-0.5 rounded bg-[#F5AC37]/10 text-[#F5AC37] border border-[#F5AC37]/30 font-mono font-medium">
            PERPÉTUA
          </span>
        )}
      </div>

      <label className="flex items-center gap-2 bg-[#10192A] border border-[#1E293B] rounded-xl px-3 py-2 shadow-xs">
        <Search className="w-4 h-4 text-[#94A3B8]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={isFutures ? 'Buscar contrato (ex: BTC, ETH, SOL)' : 'Buscar ativo por ticker ou nome'}
          className="bg-transparent flex-1 text-xs text-[#F1F5F9] placeholder:text-[#94A3B8] focus:outline-none"
        />
      </label>

      {rows.length === 0 ? (
        <p className="text-xs text-[#94A3B8] text-center py-8">Nenhum par encontrado no radar.</p>
      ) : (
        <div className="bg-[#10192A] border border-[#1E293B] rounded-xl divide-y divide-[#1E293B] overflow-hidden shadow-sm">
          {rows.map(({ coin, asset }) => {
            const hasData = asset && (!asset.isDemoData || asset.price > 0);
            const chg = asset?.change24h ?? 0;
            const isPos = chg > 0;
            const isNeg = chg < 0;

            return (
              <button
                key={coin.symbol}
                disabled={!asset}
                onClick={() => asset && onSelectCoin(asset)}
                className="w-full flex items-center justify-between px-3.5 py-3 text-left hover:bg-[#141F36]/50 transition-colors disabled:opacity-60 cursor-pointer"
              >
                <div className="flex items-baseline gap-2.5 min-w-0">
                  <span className="text-xs text-[#94A3B8] w-5 tabular-nums font-mono">{coin.rank}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-bold text-[#F1F5F9]">{coin.baseAsset}</span>
                      <span className="text-[11px] text-[#94A3B8]">/USDT</span>
                      {isFutures && (
                        <span className="text-[10px] px-1 py-0.2 rounded bg-[#1E293B] text-[#94A3B8] border border-[#2E405E]/40 font-mono">PERP</span>
                      )}
                    </div>
                    <div className="text-[11px] text-[#94A3B8] truncate">{coin.name}</div>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-sm font-mono font-medium text-[#F1F5F9] tabular-nums">
                    {hasData ? `$${fmtPrice(asset.price)}` : '—'}
                  </div>
                  <div
                    className={`text-xs font-mono tabular-nums font-medium ${
                      isPos ? 'text-[#10B981]' : isNeg ? 'text-[#F43F5E]' : 'text-[#94A3B8]'
                    }`}
                  >
                    {hasData ? fmtPct(chg) : ''}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

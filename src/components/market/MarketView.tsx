import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { CryptoAsset, MarketType } from '../../types/crypto';
import { fmtPrice, fmtPct, pnlColor } from '../common/format';

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
    // Sem scanner, mostra as moedas já carregadas
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
    <div className="space-y-4 pb-24">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">
            {isFutures ? 'Mercado de Futuros' : 'Mercado Spot'}
          </h2>
          <p className="text-xs text-slate-400">
            {isFutures ? 'Contratos perpétuos USDT-M' : coins.length ? 'Ordem por valor de mercado' : 'Top criptomoedas à vista'}
          </p>
        </div>
        {isFutures && (
          <span className="text-[11px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">
            Perpétuos
          </span>
        )}
      </div>

      <label className="flex items-center gap-2 bg-[#161920] border border-[#23272f] rounded-xl px-3 py-2.5">
        <Search className="w-4 h-4 text-slate-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={isFutures ? 'Buscar contrato perpétuo (ex: BTC, SOL, ETH)' : 'Buscar moeda'}
          className="bg-transparent flex-1 text-base text-slate-100 placeholder:text-slate-500 focus:outline-none"
        />
      </label>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-8">Nenhuma moeda encontrada.</p>
      ) : (
        <div className="bg-[#161920] border border-[#23272f] rounded-xl divide-y divide-[#23272f]">
          {rows.map(({ coin, asset }) => (
            <button
              key={coin.symbol}
              disabled={!asset}
              onClick={() => asset && onSelectCoin(asset)}
              className="w-full flex items-center justify-between px-4 py-3 text-left disabled:opacity-60"
            >
              <div className="flex items-baseline gap-3 min-w-0">
                <span className="text-xs text-slate-500 w-6 tabular-nums">{coin.rank}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-base font-medium text-slate-100">{coin.baseAsset}</span>
                    {isFutures && (
                      <span className="text-[10px] px-1 py-0.2 rounded bg-amber-500/10 text-amber-400 font-mono">PERP</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 truncate">{coin.name}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-base text-slate-100 tabular-nums">{asset && (!asset.isDemoData || asset.price > 0) ? `$${fmtPrice(asset.price)}` : '—'}</div>
                <div className={`text-sm tabular-nums ${asset && (!asset.isDemoData || asset.change24h !== 0) ? pnlColor(asset.change24h) : 'text-slate-500'}`}>
                  {asset && (!asset.isDemoData || asset.change24h !== 0) ? fmtPct(asset.change24h) : ''}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

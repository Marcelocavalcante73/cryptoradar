import React, { useState, useMemo } from 'react';
import { Search, ArrowUpDown, ArrowUpRight, ArrowDownRight, Zap, Filter } from 'lucide-react';
import { CryptoAsset, ExchangeId } from '../../types/crypto';
import { Sparkline } from '../common/Sparkline';
import { Badge } from '../common/Badge';

interface MarketViewProps {
  assets: CryptoAsset[];
  onSelectCoin: (asset: CryptoAsset) => void;
  onOpenTradeModal: (asset: CryptoAsset) => void;
}

type SortField = 'volume' | 'gainers' | 'losers' | 'name' | 'price';
type PeriodOption = '1h' | '24h' | '7d';

export const MarketView: React.FC<MarketViewProps> = ({
  assets,
  onSelectCoin,
  onOpenTradeModal
}) => {
  const [search, setSearch] = useState('');
  const [selectedExchange, setSelectedExchange] = useState<ExchangeId>('all');
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodOption>('24h');
  const [sortField, setSortField] = useState<SortField>('volume');

  // Filtragem e ordenação
  const filteredAssets = useMemo(() => {
    return assets
      .filter((asset) => {
        // Busca
        const matchesSearch =
          asset.name.toLowerCase().includes(search.toLowerCase()) ||
          asset.symbol.toLowerCase().includes(search.toLowerCase()) ||
          asset.baseAsset.toLowerCase().includes(search.toLowerCase());

        // Exchange
        const matchesExchange =
          selectedExchange === 'all' || asset.exchanges.includes(selectedExchange as any);

        return matchesSearch && matchesExchange;
      })
      .sort((a, b) => {
        if (sortField === 'volume') return b.volume24h - a.volume24h;
        if (sortField === 'gainers') return b.change24h - a.change24h;
        if (sortField === 'losers') return a.change24h - b.change24h;
        if (sortField === 'price') return b.price - a.price;
        if (sortField === 'name') return a.name.localeCompare(b.name);
        return 0;
      });
  }, [assets, search, selectedExchange, sortField]);

  const formatPrice = (val: number) => {
    return val.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: val < 10 ? 4 : 2,
      maximumFractionDigits: val < 10 ? 4 : 2
    });
  };

  const formatVolume = (vol: number) => {
    if (vol >= 1e9) return `$${(vol / 1e9).toFixed(2)}B`;
    if (vol >= 1e6) return `$${(vol / 1e6).toFixed(1)}M`;
    return `$${(vol / 1e3).toFixed(0)}K`;
  };

  return (
    <div className="space-y-3 pb-24">
      {/* Campo de Busca & Contagem */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar moeda (ex: BTC, Solana, ETH)..."
          className="w-full bg-[#121722] border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
          >
            Limpar
          </button>
        )}
      </div>

      {/* Barra de Filtros: Exchange & Período (Otimizado para o polegar) */}
      <div className="flex flex-col gap-2">
        {/* Filtro de Exchange */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          <span className="text-[10px] text-slate-500 font-semibold uppercase shrink-0 mr-1 flex items-center gap-1">
            <Filter className="w-3 h-3" /> Exchange:
          </span>
          {(['all', 'binance', 'bybit'] as ExchangeId[]).map((ex) => (
            <button
              key={ex}
              onClick={() => setSelectedExchange(ex)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition shrink-0 ${
                selectedExchange === ex
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-white'
              }`}
            >
              {ex === 'all' ? 'Todas' : ex === 'binance' ? 'Binance' : 'Bybit'}
            </button>
          ))}
        </div>

        {/* Filtro de Período & Ordenação */}
        <div className="flex items-center justify-between gap-2 overflow-x-auto no-scrollbar">
          {/* Período */}
          <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-0.5 shrink-0">
            {(['1h', '24h', '7d'] as PeriodOption[]).map((p) => (
              <button
                key={p}
                onClick={() => setSelectedPeriod(p)}
                className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition ${
                  selectedPeriod === p
                    ? 'bg-slate-800 text-white font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Ordenação */}
          <div className="flex items-center gap-1 shrink-0">
            <ArrowUpDown className="w-3 h-3 text-slate-400" />
            <select
              value={sortField}
              onChange={(e) => setSortField(e.target.value as SortField)}
              className="bg-slate-900 border border-slate-800 text-slate-300 text-[11px] rounded-lg px-2 py-1 focus:outline-none focus:border-emerald-500"
            >
              <option value="volume">Maior Volume</option>
              <option value="gainers">Maior Alta</option>
              <option value="losers">Maior Baixa</option>
              <option value="price">Maior Preço</option>
              <option value="name">Alfabética</option>
            </select>
          </div>
        </div>
      </div>

      {/* Lista de Criptomoedas */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between px-3 text-[10px] font-semibold uppercase text-slate-500 tracking-wider">
          <span>Ativo / Volume</span>
          <div className="flex items-center gap-6">
            <span>Tendência</span>
            <span className="w-20 text-right">Preço / 24h</span>
          </div>
        </div>

        {filteredAssets.length === 0 ? (
          <div className="bg-[#121722] border border-slate-800 rounded-2xl p-8 text-center space-y-2">
            <p className="text-sm text-slate-300">Nenhum ativo encontrado para esta busca.</p>
            <p className="text-xs text-slate-500">Tente ajustar o filtro de exchange ou o termo digitado.</p>
          </div>
        ) : (
          filteredAssets.map((coin) => {
            const isPositive = coin.change24h >= 0;

            return (
              <div
                key={coin.id}
                onClick={() => onSelectCoin(coin)}
                role="button"
                tabIndex={0}
                className="group w-full bg-[#121722] hover:bg-[#182030] active:scale-[0.99] border border-slate-800/80 hover:border-slate-700 rounded-2xl p-3 transition flex items-center justify-between cursor-pointer select-none"
              >
                {/* Lado Esquerdo: Moeda, Nome e Volume */}
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700/80 flex items-center justify-center font-bold text-xs text-white shrink-0 shadow-sm">
                    {coin.baseAsset.slice(0, 3)}
                  </div>
                  <div className="truncate">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-bold text-white group-hover:text-emerald-400 transition">
                        {coin.baseAsset}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        /{coin.quoteAsset}
                      </span>
                      {coin.exchanges.includes('binance') && (
                        <span className="text-[9px] bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-1 rounded">
                          BN
                        </span>
                      )}
                      {coin.exchanges.includes('bybit') && (
                        <span className="text-[9px] bg-orange-500/10 text-orange-400 border border-orange-500/20 px-1 rounded">
                          BY
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                      <span className="truncate max-w-[80px]">{coin.name}</span>
                      <span>•</span>
                      <span>Vol: {formatVolume(coin.volume24h)}</span>
                    </div>
                  </div>
                </div>

                {/* Centro: Mini Sparkline */}
                <div className="hidden xs:block shrink-0 px-2">
                  <Sparkline
                    data={coin.sparkline}
                    isPositive={isPositive}
                    width={56}
                    height={22}
                  />
                </div>

                {/* Lado Direito: Preço, Variação e Botão Simular */}
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <div className="text-xs font-bold font-mono text-white">
                      {formatPrice(coin.price)}
                    </div>
                    <div className="flex justify-end mt-0.5">
                      <span
                        className={`inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          isPositive
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-rose-500/15 text-rose-400'
                        }`}
                      >
                        {isPositive ? (
                          <ArrowUpRight className="w-3 h-3 mr-0.5" />
                        ) : (
                          <ArrowDownRight className="w-3 h-3 mr-0.5" />
                        )}
                        {isPositive ? '+' : ''}
                        {coin.change24h.toFixed(2)}%
                      </span>
                    </div>
                  </div>

                  {/* Ação rápida de Simulação com o polegar */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenTradeModal(coin);
                    }}
                    className="p-2 rounded-xl bg-slate-900 hover:bg-emerald-500/20 text-slate-400 hover:text-emerald-400 border border-slate-800 transition active:scale-95 ml-1"
                    title="Simular ordem rápida"
                    aria-label="Simular ordem rápida"
                  >
                    <Zap className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

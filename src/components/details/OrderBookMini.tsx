import React, { useMemo } from 'react';

interface OrderBookProps {
  currentPrice: number;
}

export const OrderBookMini: React.FC<OrderBookProps> = ({ currentPrice }) => {
  // Gera mini livro de ofertas dinâmico simulado em torno do preço atual
  const { asks, bids, spread } = useMemo(() => {
    const isSmall = currentPrice < 10;
    const step = currentPrice * 0.0006;
    const count = 5;

    const asksArr = [];
    for (let i = count; i >= 1; i--) {
      const price = currentPrice + i * step;
      const amount = (Math.random() * 2.5 + 0.2) * (currentPrice > 1000 ? 0.3 : 10);
      asksArr.push({
        price: Number(price.toFixed(isSmall ? 4 : 2)),
        amount: Number(amount.toFixed(3)),
        total: 0
      });
    }

    const bidsArr = [];
    for (let i = 1; i <= count; i++) {
      const price = currentPrice - i * step;
      const amount = (Math.random() * 2.5 + 0.2) * (currentPrice > 1000 ? 0.3 : 10);
      bidsArr.push({
        price: Number(price.toFixed(isSmall ? 4 : 2)),
        amount: Number(amount.toFixed(3)),
        total: 0
      });
    }

    const sp = asksArr[asksArr.length - 1].price - bidsArr[0].price;

    return { asks: asksArr, bids: bidsArr, spread: Math.max(0.01, sp) };
  }, [currentPrice]);

  return (
    <div className="bg-[#121722] border border-slate-800 rounded-2xl p-3 text-[11px] font-mono">
      <div className="flex items-center justify-between text-[10px] text-slate-500 uppercase tracking-wider pb-1.5 border-b border-slate-800">
        <span>Livro N2 (DEMO)</span>
        <span>Qtd</span>
        <span>Total ($)</span>
      </div>

      {/* Asks (Venda - Vermelho) */}
      <div className="space-y-1 py-1">
        {asks.map((ask, i) => (
          <div key={`ask-${i}`} className="flex items-center justify-between relative text-rose-400">
            <span className="font-semibold">${ask.price.toLocaleString()}</span>
            <span className="text-slate-400">{ask.amount}</span>
            <span className="text-slate-400">${(ask.price * ask.amount).toFixed(0)}</span>
            {/* Barra de profundidade */}
            <div
              className="absolute right-0 top-0 bottom-0 bg-rose-500/10 pointer-events-none rounded"
              style={{ width: `${Math.min(100, ask.amount * 18)}%` }}
            />
          </div>
        ))}
      </div>

      {/* Preço Atual e Spread */}
      <div className="py-1 px-2 my-1 bg-slate-900 rounded-lg flex items-center justify-between font-bold text-xs">
        <span className="text-white">${currentPrice.toLocaleString()}</span>
        <span className="text-[10px] text-slate-400 font-normal">Spread: ${spread.toFixed(2)}</span>
      </div>

      {/* Bids (Compra - Verde) */}
      <div className="space-y-1 py-1">
        {bids.map((bid, i) => (
          <div key={`bid-${i}`} className="flex items-center justify-between relative text-emerald-400">
            <span className="font-semibold">${bid.price.toLocaleString()}</span>
            <span className="text-slate-400">{bid.amount}</span>
            <span className="text-slate-400">${(bid.price * bid.amount).toFixed(0)}</span>
            {/* Barra de profundidade */}
            <div
              className="absolute right-0 top-0 bottom-0 bg-emerald-500/10 pointer-events-none rounded"
              style={{ width: `${Math.min(100, bid.amount * 18)}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { X, ShieldAlert, ArrowUpRight, ArrowDownRight, Calculator } from 'lucide-react';
import { CryptoAsset, SignalDirection, OrderType, PaperPosition } from '../../types/crypto';

interface NewTradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  assets: CryptoAsset[];
  initialAsset?: CryptoAsset;
  virtualBalance: number;
  onConfirmTrade: (trade: Omit<PaperPosition, 'id' | 'openTimestamp' | 'status' | 'isDemo'>) => void;
}

export const NewTradeModal: React.FC<NewTradeModalProps> = ({
  isOpen,
  onClose,
  assets,
  initialAsset,
  virtualBalance,
  onConfirmTrade
}) => {
  if (!isOpen) return null;

  const defaultAsset = initialAsset || assets[0];
  const [selectedSymbol, setSelectedSymbol] = useState(defaultAsset.symbol);
  const [direction, setDirection] = useState<SignalDirection>('LONG');
  const [orderType, setOrderType] = useState<OrderType>('MARKET');
  const [amountUSDT, setAmountUSDT] = useState<number>(500);
  const [leverage, setLeverage] = useState<number>(1);
  const [enableTp, setEnableTp] = useState(false);
  const [enableSl, setEnableSl] = useState(true);

  const activeAsset = assets.find((a) => a.symbol === selectedSymbol) || defaultAsset;
  const currentPrice = activeAsset.price;

  // Cálculos automáticos de TP e SL padrão
  const decimals = currentPrice < 10 ? 4 : 2;
  const defaultTpPrice = direction === 'LONG' ? currentPrice * 1.05 : currentPrice * 0.95;
  const defaultSlPrice = direction === 'LONG' ? currentPrice * 0.975 : currentPrice * 1.025;

  const [tpPrice, setTpPrice] = useState<number>(Number(defaultTpPrice.toFixed(decimals)));
  const [slPrice, setSlPrice] = useState<number>(Number(defaultSlPrice.toFixed(decimals)));

  // Taxa padrão de corretagem (0.05% = 0.0005)
  const notional = amountUSDT * leverage;
  const estimatedOpenFee = notional * 0.0005;
  const totalRequiredBalance = amountUSDT + estimatedOpenFee;

  const cryptoQuantity = amountUSDT > 0 && currentPrice > 0 ? notional / currentPrice : 0;

  const handleSelectDirection = (newDir: SignalDirection) => {
    setDirection(newDir);
    const dec = currentPrice < 10 ? 4 : 2;
    if (newDir === 'LONG') {
      setTpPrice(Number((currentPrice * 1.05).toFixed(dec)));
      setSlPrice(Number((currentPrice * 0.975).toFixed(dec)));
    } else {
      setTpPrice(Number((currentPrice * 0.95).toFixed(dec)));
      setSlPrice(Number((currentPrice * 1.025).toFixed(dec)));
    }
  };

  const handleQuickPercent = (pct: number) => {
    const val = Math.floor(virtualBalance * pct);
    setAmountUSDT(Math.max(10, val));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (amountUSDT <= 0) {
      alert('Informe um valor de investimento válido em USDT.');
      return;
    }

    if (totalRequiredBalance > virtualBalance) {
      alert(`Saldo virtual insuficiente. Disponível: $${virtualBalance.toFixed(2)} USDT. Necessário: $${totalRequiredBalance.toFixed(2)} USDT (incluindo taxa de $${estimatedOpenFee.toFixed(2)}).`);
      return;
    }

    // Validação estrita de coerência de Stop-Loss e Take-Profit
    if (enableTp) {
      if (direction === 'LONG' && tpPrice <= currentPrice) {
        alert('Em ordens de COMPRA (LONG), o Take-Profit (alvo) deve ser maior que o preço de entrada.');
        return;
      }
      if (direction === 'SHORT' && tpPrice >= currentPrice) {
        alert('Em ordens de VENDA (SHORT), o Take-Profit (alvo) deve ser menor que o preço de entrada.');
        return;
      }
    }

    if (enableSl) {
      if (direction === 'LONG' && slPrice >= currentPrice) {
        alert('Em ordens de COMPRA (LONG), o Stop-Loss deve ser menor que o preço de entrada.');
        return;
      }
      if (direction === 'SHORT' && slPrice <= currentPrice) {
        alert('Em ordens de VENDA (SHORT), o Stop-Loss deve ser maior que o preço de entrada.');
        return;
      }
    }

    onConfirmTrade({
      symbol: activeAsset.symbol,
      direction,
      orderType,
      entryPrice: currentPrice,
      currentPrice,
      amount: cryptoQuantity,
      investedUSDT: amountUSDT,
      leverage,
      targetPrice: enableTp ? tpPrice : undefined,
      stopLossPrice: enableSl ? slPrice : undefined,
      openFee: Number(estimatedOpenFee.toFixed(4))
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-lg bg-[#0F141F] border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-3xl p-5 max-h-[92vh] overflow-y-auto space-y-4 shadow-2xl animate-in slide-in-from-bottom duration-200">
        {/* Cabeçalho do Modal */}
        <div className="flex items-center justify-between pb-2 border-b border-slate-800">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              Nova Ordem Simulada
              <span className="text-[10px] font-mono bg-amber-500/15 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded">
                DEMO
              </span>
            </h3>
            <p className="text-xs text-slate-400">Paper Trading sem risco de capital</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Seleção do Ativo */}
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">
              Criptomoeda
            </label>
            <select
              value={selectedSymbol}
              onChange={(e) => {
                setSelectedSymbol(e.target.value);
                const asset = assets.find((a) => a.symbol === e.target.value);
                if (asset) {
                  setTpPrice(Number((direction === 'LONG' ? asset.price * 1.05 : asset.price * 0.95).toFixed(asset.price < 10 ? 4 : 2)));
                  setSlPrice(Number((direction === 'LONG' ? asset.price * 0.975 : asset.price * 1.025).toFixed(asset.price < 10 ? 4 : 2)));
                }
              }}
              className="w-full bg-[#161D2B] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-sm text-white font-medium focus:outline-none focus:border-emerald-500"
            >
              {assets.map((asset) => (
                <option key={asset.symbol} value={asset.symbol}>
                  {asset.baseAsset} - {asset.name} (${asset.price.toLocaleString()})
                </option>
              ))}
            </select>
          </div>

          {/* Direção: LONG vs SHORT */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleSelectDirection('LONG')}
              className={`py-3 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition ${
                direction === 'LONG'
                  ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20'
                  : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-white'
              }`}
            >
              <ArrowUpRight className="w-4 h-4" />
              COMPRAR / LONG (Alta)
            </button>

            <button
              type="button"
              onClick={() => handleSelectDirection('SHORT')}
              className={`py-3 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition ${
                direction === 'SHORT'
                  ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/20'
                  : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-white'
              }`}
            >
              <ArrowDownRight className="w-4 h-4" />
              VENDER / SHORT (Baixa)
            </button>
          </div>

          {/* Tipo de Ordem: Mercado vs Limite */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Tipo:</span>
            <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-0.5">
              {(['MARKET', 'LIMIT'] as OrderType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setOrderType(type)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition ${
                    orderType === type
                      ? 'bg-slate-800 text-white font-semibold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {type === 'MARKET' ? 'Mercado Imediato' : 'Ordem Limite'}
                </button>
              ))}
            </div>
          </div>

          {/* Valor do Investimento & Botões Rápidos de Porcentagem */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-300">Margem (USDT Virtual)</span>
              <span className="text-slate-400 font-mono">
                Disponível: <strong className="text-white">${virtualBalance.toFixed(2)}</strong>
              </span>
            </div>

            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-mono">
                $
              </span>
              <input
                type="number"
                min="10"
                max={virtualBalance}
                step="10"
                value={amountUSDT}
                onChange={(e) => setAmountUSDT(Number(e.target.value))}
                className="w-full bg-[#161D2B] border border-slate-700/80 rounded-xl pl-8 pr-16 py-2.5 text-sm font-mono text-white focus:outline-none focus:border-emerald-500"
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-400">
                USDT
              </span>
            </div>

            {/* Atalhos de % do saldo */}
            <div className="grid grid-cols-4 gap-1.5 pt-1">
              {[0.1, 0.25, 0.5, 1.0].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => handleQuickPercent(pct)}
                  className="py-1 px-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg text-[11px] font-mono text-slate-300 transition"
                >
                  {pct * 100}%
                </button>
              ))}
            </div>
          </div>

          {/* Alavancagem Simulada */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-300">Alavancagem Simulada</span>
              <span className="text-amber-400 font-mono text-[11px]">{leverage}x</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {[1, 2, 5, 10].map((lev) => (
                <button
                  key={lev}
                  type="button"
                  onClick={() => setLeverage(lev)}
                  className={`py-1.5 rounded-lg text-xs font-mono font-medium border transition ${
                    leverage === lev
                      ? 'bg-slate-800 text-emerald-400 border-emerald-500/50'
                      : 'bg-slate-900 text-slate-400 border-slate-800'
                  }`}
                >
                  {lev === 1 ? '1x (Spot)' : `${lev}x`}
                </button>
              ))}
            </div>
          </div>

          {/* Take Profit & Stop Loss */}
          <div className="bg-[#121722] border border-slate-800/80 rounded-2xl p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Calculator className="w-3.5 h-3.5 text-cyan-400" />
                Gerenciamento de Risco
              </span>
              <span className="text-[10px] text-slate-500 font-mono">Automático</span>
            </div>

            {/* Take Profit Toggle e Input */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[11px] text-slate-300 flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={enableTp}
                    onChange={(e) => setEnableTp(e.target.checked)}
                    className="rounded bg-slate-800 border-slate-700 text-emerald-500"
                  />
                  Take Profit (Alvo de Lucro)
                </label>
                <span className="text-[10px] text-emerald-400 font-mono">+5.0%</span>
              </div>
              {enableTp && (
                <input
                  type="number"
                  step="any"
                  value={tpPrice}
                  onChange={(e) => setTpPrice(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-mono text-emerald-400"
                />
              )}
            </div>

            {/* Stop Loss Toggle e Input */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[11px] text-slate-300 flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={enableSl}
                    onChange={(e) => setEnableSl(e.target.checked)}
                    className="rounded bg-slate-800 border-slate-700 text-rose-500"
                  />
                  Stop Loss (Proteção de Capital)
                </label>
                <span className="text-[10px] text-rose-400 font-mono">-2.5%</span>
              </div>
              {enableSl && (
                <input
                  type="number"
                  step="any"
                  value={slPrice}
                  onChange={(e) => setSlPrice(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-mono text-rose-400"
                />
              )}
            </div>
          </div>

          {/* Resumo da Ordem & Taxas */}
          <div className="bg-slate-900/80 rounded-xl p-3 text-xs font-mono text-slate-300 space-y-1.5 border border-slate-800">
            <div className="flex justify-between">
              <span className="text-slate-400">Preço de Execução:</span>
              <span>${currentPrice.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Quantidade da Moeda:</span>
              <span>
                {cryptoQuantity.toFixed(4)} {activeAsset.baseAsset}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Nocional da Ordem:</span>
              <span className="text-white font-bold">${notional.toFixed(2)}</span>
            </div>
            <div className="flex justify-between pt-1 border-t border-slate-800 text-[11px]">
              <span className="text-amber-400">Taxa de Corretagem (0.05%):</span>
              <span className="text-amber-400 font-semibold">${estimatedOpenFee.toFixed(2)} USDT</span>
            </div>
            <div className="flex justify-between text-[11px] font-bold">
              <span className="text-slate-200">Total Debitado do Saldo:</span>
              <span className="text-emerald-400">${totalRequiredBalance.toFixed(2)} USDT</span>
            </div>
          </div>

          {/* Aviso Legal */}
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Simulação contábil local. Nenhuma ordem real enviada à exchange.</span>
          </div>

          {/* Botão de Envio com o Polegar */}
          <button
            type="submit"
            className="w-full bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] text-slate-950 font-bold py-3.5 px-4 rounded-xl text-sm transition shadow-lg shadow-emerald-500/20"
          >
            Confirmar Operação Simulada (DEMO)
          </button>
        </form>
      </div>
    </div>
  );
};

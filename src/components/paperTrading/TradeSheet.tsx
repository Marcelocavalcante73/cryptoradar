import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { CryptoAsset, TechnicalSignal } from '../../types/crypto';
import { TRADING_FEE_RATE } from '../../services/paperTradingService';
import { fmtPrice, fmtUsd } from '../common/format';

export interface TradeRequest {
  symbol: string;
  price: number;
  amountUSDT: number;
  stopLossPrice: number;
  targetPrice: number;
}

interface TradeSheetProps {
  asset: CryptoAsset | null;
  signal?: TechnicalSignal | null;
  balance: number;
  riskPercent: number;      // % do saldo arriscado por operação
  defaultStopPercent: number;
  defaultRewardRatio: number;
  onClose: () => void;
  onConfirm: (req: TradeRequest) => { success: boolean; error?: string };
}

const toNum = (v: string) => Number(v.replace(',', '.'));

/** Tamanho que perde `riskPercent` do saldo se o stop for atingido (limitado ao saldo disponível). */
export function suggestAmount(balance: number, price: number, stop: number, riskPercent: number): number {
  const stopDist = (price - stop) / price;
  if (!(stopDist > 0)) return 0;
  const raw = (balance * (riskPercent / 100)) / (stopDist + 2 * TRADING_FEE_RATE);
  return Math.max(0, Math.floor(Math.min(raw, balance * 0.95)));
}

export const TradeSheet: React.FC<TradeSheetProps> = ({
  asset, signal, balance, riskPercent, defaultStopPercent, defaultRewardRatio, onClose, onConfirm
}) => {
  const price = asset?.price ?? signal?.entryPrice ?? 0;
  const [amount, setAmount] = useState('');
  const [stop, setStop] = useState('');
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!asset) return;
    const p = asset.price;
    const s = signal ? signal.stopLossPrice : p * (1 - defaultStopPercent / 100);
    const t = signal ? signal.targetPrice : p * (1 + (defaultStopPercent / 100) * defaultRewardRatio);
    const dec = p >= 1000 ? 2 : p >= 1 ? 4 : 8;
    setStop(String(Number(s.toFixed(dec))));
    setTarget(String(Number(t.toFixed(dec))));
    setAmount(String(suggestAmount(balance, p, s, riskPercent)));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset?.symbol, signal?.id]);

  const a = toNum(amount), st = toNum(stop), tg = toNum(target);
  const valid = Number.isFinite(a) && a > 0 && st > 0 && st < price && tg > price;

  const calc = useMemo(() => {
    if (!valid) return null;
    const fees = a * TRADING_FEE_RATE * 2;
    return {
      maxLoss: (a * (price - st)) / price + fees,
      gain: (a * (tg - price)) / price - fees,
      qty: a / price
    };
  }, [valid, a, st, tg, price]);

  if (!asset) return null;

  const moved = signal ? ((price - signal.entryPrice) / signal.entryPrice) * 100 : 0;

  const submit = () => {
    if (!valid) return setError('Confira os valores: o stop deve ficar abaixo do preço atual e o alvo acima.');
    const res = onConfirm({ symbol: asset.symbol, price, amountUSDT: a, stopLossPrice: st, targetPrice: tg });
    if (!res.success) setError(res.error || 'Não foi possível abrir a simulação.');
  };

  const field = 'w-full bg-[#0f1115] border border-[#2a2f3a] rounded-lg px-3 py-3 text-base text-slate-100 tabular-nums focus:outline-none focus:border-slate-400';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-md bg-[#161920] border border-[#23272f] rounded-t-2xl sm:rounded-2xl p-5 safe-area-pb" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-100">Comprar {asset.baseAsset}</h3>
            <p className="text-sm text-slate-400">Simulação · preço atual {fmtPrice(price)}</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400" aria-label="Fechar"><X className="w-5 h-5" /></button>
        </div>

        {Math.abs(moved) >= 1 && (
          <p className="text-sm text-amber-300 mb-3">O preço já se moveu {moved > 0 ? '+' : '−'}{Math.abs(moved).toFixed(1)}% desde o sinal.</p>
        )}

        <label className="block mb-3">
          <span className="text-sm text-slate-400">Valor (USDT) · saldo {fmtUsd(balance)}</span>
          <input className={field} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <label className="block">
            <span className="text-sm text-slate-400">Stop</span>
            <input className={field} inputMode="decimal" value={stop} onChange={(e) => setStop(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-sm text-slate-400">Alvo</span>
            <input className={field} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
          </label>
        </div>

        {calc && (
          <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
            <div>
              <div className="text-slate-500">Perda máxima</div>
              <div className="text-rose-400 font-medium">{fmtUsd(-calc.maxLoss)} ({((calc.maxLoss / balance) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% do saldo)</div>
            </div>
            <div>
              <div className="text-slate-500">Ganho no alvo</div>
              <div className="text-emerald-400 font-medium">{fmtUsd(calc.gain, true)}</div>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-rose-400 mb-3">{error}</p>}

        <button onClick={submit} className="w-full bg-slate-100 text-slate-900 font-semibold py-3.5 rounded-lg text-base">
          Confirmar simulação
        </button>
      </div>
    </div>
  );
};

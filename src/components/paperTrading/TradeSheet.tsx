import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { CryptoAsset, MarketType, SignalDirection, TechnicalSignal } from '../../types/crypto';
import { TRADING_FEE_RATE } from '../../services/paperTradingService';
import {
  futuresSizing, liquidationPrice, maxSafeLeverage, stopBeforeLiquidation, MAX_LEVERAGE
} from '../../services/futures';
import { fmtPrice, fmtUsd } from '../common/format';

export interface TradeRequest {
  symbol: string;
  direction: SignalDirection;
  leverage: number;
  price: number;
  amountUSDT: number;      // margem (em spot, o valor da compra)
  stopLossPrice: number;
  targetPrice?: number; // ausente em estratégias sem alvo fixo (tendência)
}

interface TradeSheetProps {
  market: MarketType;
  asset: CryptoAsset | null;
  signal?: TechnicalSignal | null;
  noTarget?: boolean;       // tendência: só stop e saída pela tendência
  balance: number;
  riskPercent: number;      // % do saldo arriscado por operação
  defaultStopPercent: number;
  defaultRewardRatio: number;
  defaultLeverage: number;
  onClose: () => void;
  onConfirm: (req: TradeRequest) => { success: boolean; error?: string };
}

const toNum = (v: string) => Number(v.replace(',', '.'));
const LEVERAGE_CHOICES = [1, 2, 3, 5, 10, 20].filter((l) => l <= MAX_LEVERAGE);

/** Tamanho (spot) que perde `riskPercent` do saldo se o stop for atingido (limitado ao saldo disponível). */
export function suggestAmount(balance: number, price: number, stop: number, riskPercent: number): number {
  const stopDist = (price - stop) / price;
  if (!(stopDist > 0)) return 0;
  const raw = (balance * (riskPercent / 100)) / (stopDist + 2 * TRADING_FEE_RATE);
  return Math.max(0, Math.floor(Math.min(raw, balance * 0.95)));
}

export const TradeSheet: React.FC<TradeSheetProps> = ({
  market, asset, signal, noTarget = false, balance, riskPercent, defaultStopPercent, defaultRewardRatio, defaultLeverage, onClose, onConfirm
}) => {
  const futures = market === 'futures';
  const price = asset?.price ?? signal?.entryPrice ?? 0;
  const [direction, setDirection] = useState<SignalDirection>('LONG');
  const [leverage, setLeverage] = useState(1);
  const [amount, setAmount] = useState('');
  const [stop, setStop] = useState('');
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string | null>(null);

  // (Re)inicializa ao abrir para outra moeda/sinal
  const init = (dir: SignalDirection, p: number, sig?: TechnicalSignal | null) => {
    const sign = dir === 'LONG' ? 1 : -1;
    const sVal = sig && sig.direction === dir ? sig.stopLossPrice : p * (1 - sign * (defaultStopPercent / 100));
    const tVal = sig && sig.direction === dir ? sig.targetPrice : p * (1 + sign * (defaultStopPercent / 100) * defaultRewardRatio);
    const dec = p >= 1000 ? 2 : p >= 1 ? 4 : 8;
    setStop(String(Number(sVal.toFixed(dec))));
    setTarget(String(Number(tVal.toFixed(dec))));

    const lev = futures ? Math.min(defaultLeverage, maxSafeLeverage(p, sVal), MAX_LEVERAGE) : 1;
    setLeverage(lev);
    if (futures) {
      const sz = futuresSizing({ balance, entry: p, stop: sVal, riskPercent, leverage: lev, feeRate: TRADING_FEE_RATE });
      setAmount(String(Math.max(0, Math.floor(sz.margin))));
    } else {
      setAmount(String(suggestAmount(balance, p, sVal, riskPercent)));
    }
    setError(null);
  };

  useEffect(() => {
    if (!asset) return;
    const dir: SignalDirection = futures ? signal?.direction ?? 'LONG' : 'LONG';
    setDirection(dir);
    init(dir, asset.price, signal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset?.symbol, signal?.id, market]);

  const sign = direction === 'LONG' ? 1 : -1;
  const a = toNum(amount), st = toNum(stop), tg = toNum(target);
  const stopOk = st > 0 && (direction === 'LONG' ? st < price : st > price);
  const targetOk = tg > 0 && (direction === 'LONG' ? tg > price : tg < price);
  const valid = Number.isFinite(a) && a > 0 && stopOk && (noTarget || targetOk);

  const safeLev = stopOk ? maxSafeLeverage(price, st) : 1;
  const liq = liquidationPrice(direction, price, leverage);
  const stopProtects = !futures || leverage <= 1 || !stopOk || stopBeforeLiquidation(direction, price, st, leverage);

  const calc = useMemo(() => {
    if (!valid) return null;
    const notional = a * leverage;
    const fees = notional * TRADING_FEE_RATE * 2;
    return {
      notional,
      maxLoss: (notional * Math.abs(price - st)) / price + fees,
      gain: noTarget ? 0 : (notional * Math.abs(tg - price)) / price - fees
    };
  }, [valid, a, leverage, st, tg, price]);

  if (!asset) return null;

  const moved = signal ? ((price - signal.entryPrice) / signal.entryPrice) * 100 : 0;
  const label = futures ? (direction === 'LONG' ? 'Long' : 'Short') : 'Comprar';

  const changeDirection = (dir: SignalDirection) => {
    setDirection(dir);
    init(dir, price, signal);
  };

  const submit = () => {
    if (!valid) {
      return setError(direction === 'LONG'
        ? 'Confira os valores: o stop deve ficar abaixo do preço atual e o alvo acima.'
        : 'Confira os valores: em short, o stop deve ficar acima do preço atual e o alvo abaixo.');
    }
    if (!stopProtects) return setError('Com essa alavancagem a liquidação acontece antes do stop. Reduza a alavancagem ou aproxime o stop.');
    const res = onConfirm({ symbol: asset.symbol, direction, leverage, price, amountUSDT: a, stopLossPrice: st, targetPrice: noTarget ? undefined : tg });
    if (!res.success) setError(res.error || 'Não foi possível abrir a simulação.');
  };

  const field = 'w-full bg-[#0A0F1D] border border-[#1E293B] rounded-lg px-3 py-2 text-sm text-[#F1F5F9] font-mono tabular-nums mt-1 focus:outline-none focus:border-[#F5AC37] transition-colors';
  const seg = (on: boolean) => `px-3.5 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${on ? 'bg-[#1E293B] text-[#F5AC37] border border-[#2E405E]/50 shadow-sm' : 'text-[#94A3B8] hover:text-[#F1F5F9]'}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-xs" onClick={onClose}>
      <div className="w-full max-w-md max-h-[92vh] overflow-y-auto bg-[#10192A] border border-[#1E293B] rounded-t-2xl sm:rounded-2xl p-5 safe-area-pb shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-[#F1F5F9] flex items-center gap-1.5">
              <span>{label} {asset.baseAsset}</span>
              <span className="text-xs text-[#94A3B8] font-mono">/USDT</span>
              {futures && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1E293B] text-[#F5AC37] border border-[#2E405E]/40 font-mono font-medium">FUTUROS</span>}
            </h3>
            <p className="text-xs text-[#94A3B8] font-mono mt-0.5">Preço atual: {fmtPrice(price)}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-[#94A3B8] hover:text-[#F1F5F9] rounded-lg cursor-pointer" aria-label="Fechar"><X className="w-5 h-5" /></button>
        </div>

        {futures && !signal && (
          <div className="inline-flex bg-[#0A0F1D] border border-[#1E293B] rounded-lg p-0.5 mb-4 shadow-xs">
            <button className={seg(direction === 'LONG')} onClick={() => changeDirection('LONG')}>Long (compra)</button>
            <button className={seg(direction === 'SHORT')} onClick={() => changeDirection('SHORT')}>Short (venda)</button>
          </div>
        )}

        {Math.abs(moved) >= 1 && (
          <p className="text-xs text-[#F5AC37] mb-3">O preço já se moveu {moved > 0 ? '+' : '−'}{Math.abs(moved).toFixed(1)}% desde o sinal.</p>
        )}

        {futures && (
          <div className="mb-4">
            <div className="text-xs text-[#94A3B8] mb-1.5">Alavancagem</div>
            <div className="flex gap-1.5 flex-wrap">
              {LEVERAGE_CHOICES.map((l) => (
                <button
                  key={l}
                  onClick={() => {
                    setLeverage(l);
                    const sz = futuresSizing({ balance, entry: price, stop: stopOk ? st : price * (1 - sign * defaultStopPercent / 100), riskPercent, leverage: l, feeRate: TRADING_FEE_RATE });
                    setAmount(String(Math.max(0, Math.floor(sz.margin))));
                  }}
                  className={`min-w-[48px] px-2.5 py-1.5 rounded-lg text-xs font-mono font-medium border transition-colors cursor-pointer ${leverage === l ? 'bg-[#1E293B] border-[#F5AC37] text-[#F5AC37] shadow-xs' : 'border-[#1E293B] bg-[#0A0F1D] text-[#94A3B8] hover:text-[#F1F5F9]'}`}
                >
                  {l}x
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[#94A3B8] mt-1.5">
              Alavancagem segura para este stop: até {safeLev}x.
            </p>
          </div>
        )}

        <label className="block mb-3">
          <span className="text-xs text-[#94A3B8]">{futures ? 'Margem (USDT)' : 'Valor da Compra (USDT)'} · saldo {fmtUsd(balance)}</span>
          <input className={field} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>

        <div className={`grid ${noTarget ? 'grid-cols-1' : 'grid-cols-2'} gap-3 mb-4`}>
          <label className="block">
            <span className="text-xs text-[#F43F5E]">Stop Loss</span>
            <input className={field} inputMode="decimal" value={stop} onChange={(e) => setStop(e.target.value)} />
          </label>
          {!noTarget && (
            <label className="block">
              <span className="text-xs text-[#10B981]">Take Profit (Alvo)</span>
              <input className={field} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
            </label>
          )}
        </div>
        {noTarget && <p className="text-xs text-[#94A3B8] -mt-2 mb-4">Sem alvo fixo: encerramento pela reversão de tendência ou stop móvel.</p>}

        {calc && (
          <div className="grid grid-cols-2 gap-2.5 mb-4 text-xs bg-[#0A0F1D] border border-[#1E293B] rounded-lg p-3">
            {futures && (
              <>
                <div>
                  <div className="text-[#94A3B8]">Posição total</div>
                  <div className="text-[#F1F5F9] font-mono font-medium mt-0.5">{fmtUsd(calc.notional)}</div>
                </div>
                <div>
                  <div className="text-[#94A3B8]">Preço liquidação</div>
                  <div className={`font-mono font-medium mt-0.5 ${stopProtects ? 'text-[#F1F5F9]' : 'text-[#F43F5E]'}`}>{fmtPrice(liq)}</div>
                </div>
              </>
            )}
            <div>
              <div className="text-[#94A3B8]">Risco máximo</div>
              <div className="text-[#F43F5E] font-mono font-medium mt-0.5">{fmtUsd(-calc.maxLoss)} ({((calc.maxLoss / balance) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%)</div>
            </div>
            {!noTarget && (
              <div>
                <div className="text-[#94A3B8]">Lucro estimado</div>
                <div className="text-[#10B981] font-mono font-medium mt-0.5">{fmtUsd(calc.gain, true)}</div>
              </div>
            )}
          </div>
        )}

        {futures && !stopProtects && (
          <p className="text-xs text-[#F43F5E] mb-3">A liquidação ({fmtPrice(liq)}) ocorre antes do stop ({fmtPrice(st)}). Reduza a alavancagem.</p>
        )}
        {error && <p className="text-xs text-[#F43F5E] mb-3">{error}</p>}

        <button
          onClick={submit}
          disabled={futures && !stopProtects}
          className="w-full bg-[#F5AC37] hover:bg-[#FBBF24] text-[#0B0F17] font-semibold py-3 rounded-lg text-xs shadow-sm transition-all disabled:opacity-40 cursor-pointer active:scale-95"
        >
          Confirmar Ordem Simulada
        </button>
      </div>
    </div>
  );
};

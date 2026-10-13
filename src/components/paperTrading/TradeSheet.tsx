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

  const field = 'w-full bg-[#0f1115] border border-[#2a2f3a] rounded-lg px-3 py-3 text-base text-slate-100 tabular-nums focus:outline-none focus:border-slate-400';
  const seg = (on: boolean) => `px-4 py-2 text-sm rounded-md ${on ? 'bg-[#2a2f3a] text-slate-100' : 'text-slate-400'}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-md max-h-[92vh] overflow-y-auto bg-[#161920] border border-[#23272f] rounded-t-2xl sm:rounded-2xl p-5 safe-area-pb" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-100">{label} {asset.baseAsset}{futures ? ' · Futuros' : ''}</h3>
            <p className="text-sm text-slate-400">Simulação · preço atual {fmtPrice(price)}</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400" aria-label="Fechar"><X className="w-5 h-5" /></button>
        </div>

        {futures && !signal && (
          <div className="inline-flex bg-[#0f1115] border border-[#23272f] rounded-lg p-0.5 mb-4">
            <button className={seg(direction === 'LONG')} onClick={() => changeDirection('LONG')}>Long (compra)</button>
            <button className={seg(direction === 'SHORT')} onClick={() => changeDirection('SHORT')}>Short (venda)</button>
          </div>
        )}

        {Math.abs(moved) >= 1 && (
          <p className="text-sm text-amber-300 mb-3">O preço já se moveu {moved > 0 ? '+' : '−'}{Math.abs(moved).toFixed(1)}% desde o sinal.</p>
        )}

        {futures && (
          <div className="mb-4">
            <div className="text-sm text-slate-400 mb-1.5">Alavancagem</div>
            <div className="flex gap-1.5 flex-wrap">
              {LEVERAGE_CHOICES.map((l) => (
                <button
                  key={l}
                  onClick={() => {
                    setLeverage(l);
                    const sz = futuresSizing({ balance, entry: price, stop: stopOk ? st : price * (1 - sign * defaultStopPercent / 100), riskPercent, leverage: l, feeRate: TRADING_FEE_RATE });
                    setAmount(String(Math.max(0, Math.floor(sz.margin))));
                  }}
                  className={`min-w-[52px] px-3 py-2 rounded-lg text-sm border ${leverage === l ? 'bg-[#2a2f3a] border-[#3a4150] text-slate-100' : 'border-[#23272f] text-slate-400'}`}
                >
                  {l}x
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-1.5">
              Segura para este stop: até {safeLev}x. A alavancagem não muda quanto você arrisca (isso vem do stop), só quanta margem fica travada e o quão perto está a liquidação.
            </p>
          </div>
        )}

        <label className="block mb-3">
          <span className="text-sm text-slate-400">{futures ? 'Margem (USDT)' : 'Valor (USDT)'} · saldo {fmtUsd(balance)}</span>
          <input className={field} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>

        <div className={`grid ${noTarget ? 'grid-cols-1' : 'grid-cols-2'} gap-3 mb-4`}>
          <label className="block">
            <span className="text-sm text-slate-400">Stop</span>
            <input className={field} inputMode="decimal" value={stop} onChange={(e) => setStop(e.target.value)} />
          </label>
          {!noTarget && (
            <label className="block">
              <span className="text-sm text-slate-400">Alvo</span>
              <input className={field} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
            </label>
          )}
        </div>
        {noTarget && <p className="text-xs text-slate-500 -mt-2 mb-4">Sem alvo fixo: saia pelo stop ou quando o app avisar que fechou abaixo da mínima de 20 dias.</p>}

        {calc && (
          <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
            {futures && (
              <>
                <div>
                  <div className="text-slate-500">Tamanho da posição</div>
                  <div className="text-slate-100 font-medium">{fmtUsd(calc.notional)}</div>
                </div>
                <div>
                  <div className="text-slate-500">Preço de liquidação</div>
                  <div className={`font-medium ${stopProtects ? 'text-slate-100' : 'text-rose-400'}`}>{fmtPrice(liq)}</div>
                </div>
              </>
            )}
            <div>
              <div className="text-slate-500">Perda máxima</div>
              <div className="text-rose-400 font-medium">{fmtUsd(-calc.maxLoss)} ({((calc.maxLoss / balance) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% do saldo)</div>
            </div>
            {!noTarget && (
              <div>
                <div className="text-slate-500">Ganho no alvo</div>
                <div className="text-emerald-400 font-medium">{fmtUsd(calc.gain, true)}</div>
              </div>
            )}
          </div>
        )}

        {futures && !stopProtects && (
          <p className="text-sm text-rose-400 mb-3">A liquidação ({fmtPrice(liq)}) vem antes do stop ({fmtPrice(st)}): a posição perderia toda a margem. Reduza a alavancagem.</p>
        )}
        {error && <p className="text-sm text-rose-400 mb-3">{error}</p>}

        <button
          onClick={submit}
          disabled={futures && !stopProtects}
          className="w-full bg-slate-100 text-slate-900 font-semibold py-3.5 rounded-lg text-base disabled:opacity-40"
        >
          Confirmar simulação
        </button>
      </div>
    </div>
  );
};

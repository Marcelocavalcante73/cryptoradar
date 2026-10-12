/**
 * Regras de futuros perpétuos (USDT-M), margem isolada.
 * Funções puras, sem rede, usadas pelo simulador, pela tela de ordem e pelo backtest.
 *
 * Aproximações assumidas (a corretora real pode diferir, principalmente em posições grandes):
 *  - taxa de manutenção de margem de 0,5%;
 *  - preço de liquidação calculado sobre o preço de entrada, sem considerar funding acumulado.
 */

import { SignalDirection } from '../types/crypto';

export const MAINTENANCE_MARGIN_RATE = 0.005;
export const MAX_LEVERAGE = 20;
export const DEFAULT_FUTURES_LEVERAGE = 3;

/** Preço em que a posição é liquidada (margem isolada). */
export function liquidationPrice(
  direction: SignalDirection,
  entry: number,
  leverage: number,
  mmr: number = MAINTENANCE_MARGIN_RATE
): number {
  const inv = 1 / Math.max(1, leverage);
  return direction === 'LONG' ? entry * (1 - inv + mmr) : entry * (1 + inv - mmr);
}

/** O stop precisa ser atingido ANTES da liquidação, senão ele não protege nada. */
export function stopBeforeLiquidation(
  direction: SignalDirection,
  entry: number,
  stop: number,
  leverage: number
): boolean {
  const liq = liquidationPrice(direction, entry, leverage);
  return direction === 'LONG' ? stop > liq && stop < entry : stop < liq && stop > entry;
}

/**
 * Maior alavancagem em que a distância até a liquidação ainda é `safety` vezes a distância até o stop
 * (margem de segurança para o stop ser executado com derrapagem). Limitada por `cap`.
 */
export function maxSafeLeverage(
  entry: number,
  stop: number,
  cap: number = 10,
  safety: number = 2
): number {
  const stopDist = Math.abs(entry - stop) / entry;
  if (!(stopDist > 0)) return 1;
  const lev = Math.floor(1 / (safety * stopDist + MAINTENANCE_MARGIN_RATE));
  return Math.max(1, Math.min(cap, MAX_LEVERAGE, lev));
}

export interface FuturesSizing {
  notional: number;   // tamanho da posição em USDT
  margin: number;     // margem a depositar (notional / alavancagem)
  maxLoss: number;    // perda no stop, incluindo taxas
  capped: boolean;    // true se o tamanho foi limitado pelo saldo
}

/**
 * Tamanho da posição para perder `riskPercent` do saldo se o stop for atingido.
 * A alavancagem NÃO muda o risco: só muda quanta margem fica travada.
 */
export function futuresSizing(args: {
  balance: number;
  entry: number;
  stop: number;
  riskPercent: number;
  leverage: number;
  feeRate: number;
}): FuturesSizing {
  const { balance, entry, stop, riskPercent, leverage, feeRate } = args;
  const stopDist = Math.abs(entry - stop) / entry;
  if (!(stopDist > 0) || balance <= 0) return { notional: 0, margin: 0, maxLoss: 0, capped: false };

  const riskUsd = balance * (riskPercent / 100);
  let notional = riskUsd / (stopDist + 2 * feeRate);
  const maxNotional = balance * 0.95 * Math.max(1, leverage);
  const capped = notional > maxNotional;
  notional = Math.floor(Math.min(notional, maxNotional));
  return {
    notional,
    margin: notional / Math.max(1, leverage),
    maxLoss: notional * (stopDist + 2 * feeRate),
    capped
  };
}

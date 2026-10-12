/**
 * Serviço de Regras de Negócio e Contabilidade de Paper Trading - CryptoRadar
 * Executa todas as operações de ordens MARKET, LIMIT, TP/SL, cálculo de margem,
 * alavancagem, taxas e patrimônio total sem dupla tributação de taxas.
 */

import { PaperAccount, PaperPosition, CryptoAsset, SignalDirection, OrderType } from '../types/crypto';
import { liquidationPrice, stopBeforeLiquidation } from './futures';

export interface TradeOrderInput {
  symbol: string;
  direction: SignalDirection;
  orderType: OrderType;
  entryPrice: number;
  currentPrice: number;
  limitPrice?: number;
  investedUSDT: number;
  leverage: number;
  targetPrice?: number;
  stopLossPrice?: number;
}

export interface TradeExecutionResult {
  success: boolean;
  account: PaperAccount;
  position?: PaperPosition;
  error?: string;
}

export interface AccountMetrics {
  virtualBalance: number;       // Saldo livre disponível
  openPositionsMargin: number;  // Margem alocada em posições abertas
  pendingOrdersMargin: number;  // Margem + taxa retidas em ordens LIMIT pendentes
  totalReservedMargin: number;  // Margem total reservada
  totalNotional: number;        // Valor nocional total das posições abertas
  unrealizedGrossPnl: number;   // PnL bruto não realizado
  unrealizedNetPnl: number;     // PnL líquido não realizado (deduzindo taxas)
  totalEquity: number;          // Patrimônio total líquido simulado
  totalFeesPaid: number;        // Taxas acumuladas pagas
  totalExecutedTrades: number;  // Total de operações finalizadas (excluindo canceladas)
  winTrades: number;
  lossTrades: number;
  winRatePercent: number;       // Taxa de acerto das operações concluídas
}

export interface TriggerEvaluationResult {
  account: PaperAccount;
  triggeredOrders: Array<{
    positionId: string;
    symbol: string;
    type: 'LIMIT_FILLED' | 'TAKE_PROFIT' | 'STOP_LOSS' | 'LIQUIDATION';
    price: number;
    netPnl?: number;
  }>;
}

// Taxa padrão de corretagem por perna (0.05% = 0.0005)
export const TRADING_FEE_RATE = 0.0005;

/**
 * Cria uma nova ordem simulada (MARKET ou LIMIT).
 * Valida saldo disponível, calcula taxas de abertura, margem e quantidade nocional.
 */
export function createTradeOrder(
  account: PaperAccount,
  input: TradeOrderInput
): TradeExecutionResult {
  // 1. Validação de dados numéricos
  if (!Number.isFinite(input.investedUSDT) || input.investedUSDT <= 0) {
    return { success: false, account, error: 'O valor investido deve ser um número positivo.' };
  }
  if (!Number.isFinite(input.leverage) || input.leverage < 1) {
    return { success: false, account, error: 'A alavancagem mínima é de 1x.' };
  }
  if (!Number.isFinite(input.entryPrice) || input.entryPrice <= 0) {
    return { success: false, account, error: 'O preço de entrada deve ser maior que zero.' };
  }

  const isLimit = input.orderType === 'LIMIT';
  const effectivePrice = isLimit && input.limitPrice && input.limitPrice > 0 ? input.limitPrice : input.entryPrice;

  // Validação estrita de preço limite
  if (isLimit) {
    if (!input.limitPrice || input.limitPrice <= 0) {
      return { success: false, account, error: 'Preço limite inválido.' };
    }
    if (input.direction === 'LONG' && input.limitPrice > input.currentPrice) {
      return {
        success: false,
        account,
        error: `Para compra a limite (LONG), o preço limite ($${input.limitPrice}) deve ser menor ou igual à cotação atual ($${input.currentPrice}).`
      };
    }
    if (input.direction === 'SHORT' && input.limitPrice < input.currentPrice) {
      return {
        success: false,
        account,
        error: `Para venda a limite (SHORT), o preço limite ($${input.limitPrice}) deve ser maior ou igual à cotação atual ($${input.currentPrice}).`
      };
    }
  }

  // Validação de TP / SL
  if (input.targetPrice !== undefined) {
    if (input.direction === 'LONG' && input.targetPrice <= effectivePrice) {
      return { success: false, account, error: 'Em LONG, o Take-Profit deve ser maior que o preço de entrada.' };
    }
    if (input.direction === 'SHORT' && input.targetPrice >= effectivePrice) {
      return { success: false, account, error: 'Em SHORT, o Take-Profit deve ser menor que o preço de entrada.' };
    }
  }
  if (input.stopLossPrice !== undefined) {
    if (input.direction === 'LONG' && input.stopLossPrice >= effectivePrice) {
      return { success: false, account, error: 'Em LONG, o Stop-Loss deve ser menor que o preço de entrada.' };
    }
    if (input.direction === 'SHORT' && input.stopLossPrice <= effectivePrice) {
      return { success: false, account, error: 'Em SHORT, o Stop-Loss deve ser maior que o preço de entrada.' };
    }
  }

  // Com alavancagem, o stop precisa ficar antes do preço de liquidação, senão a posição é liquidada primeiro
  if (input.stopLossPrice !== undefined && input.leverage > 1 &&
      !stopBeforeLiquidation(input.direction, effectivePrice, input.stopLossPrice, input.leverage)) {
    const liq = liquidationPrice(input.direction, effectivePrice, input.leverage);
    return {
      success: false,
      account,
      error: `Com ${input.leverage}x, a liquidação ocorre em $${liq.toFixed(4)}, antes do seu stop. Reduza a alavancagem ou aproxime o stop.`
    };
  }

  // 2. Cálculos Nocional e Taxas
  const notional = input.investedUSDT * input.leverage;
  const amount = notional / effectivePrice;
  const openFee = Number((notional * TRADING_FEE_RATE).toFixed(4));
  const totalRequired = Number((input.investedUSDT + openFee).toFixed(2));

  // 3. Verificação de Saldo Disponível
  if (totalRequired > account.virtualBalance) {
    return {
      success: false,
      account,
      error: `Saldo insuficiente. Disponível: $${account.virtualBalance.toFixed(2)} USDT. Necessário: $${totalRequired.toFixed(2)} USDT (inclui taxa de abertura de $${openFee.toFixed(2)}).`
    };
  }

  // 4. Criação da Posição
  const newPosition: PaperPosition = {
    id: `pos-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    symbol: input.symbol,
    direction: input.direction,
    orderType: input.orderType,
    entryPrice: effectivePrice,
    currentPrice: input.currentPrice,
    limitPrice: isLimit ? input.limitPrice : undefined,
    amount,
    investedUSDT: input.investedUSDT,
    leverage: input.leverage,
    targetPrice: input.targetPrice,
    stopLossPrice: input.stopLossPrice,
    openFee,
    status: isLimit ? 'PENDING' : 'OPEN',
    isDemo: true,
    openTimestamp: Date.now()
  };

  const newBalance = Number((account.virtualBalance - totalRequired).toFixed(2));

  const updatedAccount: PaperAccount = {
    ...account,
    virtualBalance: newBalance,
    // Ordem LIMIT pendente não incrementa totalTrades até ser executada
    totalTrades: isLimit ? account.totalTrades : account.totalTrades + 1,
    totalFeesPaid: Number(((account.totalFeesPaid || 0) + openFee).toFixed(2)),
    positions: [newPosition, ...(account.positions || [])]
  };

  return {
    success: true,
    account: updatedAccount,
    position: newPosition
  };
}

/**
 * Cancela uma ordem LIMIT pendente.
 * Devolve integralmente a margem e a taxa reservada ao saldo livre.
 */
export function cancelPendingOrder(
  account: PaperAccount,
  positionId: string
): TradeExecutionResult {
  const pos = account.positions.find((p) => p.id === positionId);
  if (!pos) {
    return { success: false, account, error: 'Ordem não encontrada.' };
  }
  if (pos.status !== 'PENDING') {
    return { success: false, account, error: 'Apenas ordens pendentes podem ser canceladas.' };
  }

  const refundAmount = Number((pos.investedUSDT + (pos.openFee || 0)).toFixed(2));
  const newBalance = Number((account.virtualBalance + refundAmount).toFixed(2));
  const newFeesPaid = Math.max(0, Number(((account.totalFeesPaid || 0) - (pos.openFee || 0)).toFixed(2)));

  const cancelledPos: PaperPosition = {
    ...pos,
    status: 'CLOSED',
    closedTimestamp: Date.now(),
    closePrice: pos.entryPrice,
    realizedPnl: 0,
    realizedPnlPercent: 0,
    totalFees: 0,
    closeReason: 'CANCELLED'
  };

  const updatedAccount: PaperAccount = {
    ...account,
    virtualBalance: newBalance,
    totalFeesPaid: newFeesPaid,
    positions: account.positions.filter((p) => p.id !== positionId),
    closedHistory: [cancelledPos, ...(account.closedHistory || [])]
  };

  return {
    success: true,
    account: updatedAccount,
    position: cancelledPos
  };
}

/**
 * Encerra uma posição aberta (a mercado, por TP ou por SL).
 * Deduz a taxa de saída sem duplicar a dedução da taxa de abertura.
 */
export function closeOpenPosition(
  account: PaperAccount,
  positionId: string,
  exitPrice: number,
  reason: 'MANUAL' | 'TAKE_PROFIT' | 'STOP_LOSS' | 'LIQUIDATION' = 'MANUAL'
): TradeExecutionResult {
  const pos = account.positions.find((p) => p.id === positionId);
  if (!pos) {
    return { success: false, account, error: 'Posição não encontrada.' };
  }
  if (pos.status !== 'OPEN') {
    return { success: false, account, error: 'Apenas posições abertas podem ser encerradas.' };
  }
  if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
    return { success: false, account, error: 'Preço de saída inválido.' };
  }

  // 1. Variação percentual e PnL bruto alavancado
  const priceDiff = pos.direction === 'LONG' ? exitPrice - pos.entryPrice : pos.entryPrice - exitPrice;
  const percentDiff = (priceDiff / pos.entryPrice) * pos.leverage;
  const grossPnl = pos.investedUSDT * percentDiff;

  // 2. Taxa de fechamento (0.05% do valor nocional de saída)
  const closeFee = Number(((pos.amount * exitPrice) * TRADING_FEE_RATE).toFixed(4));
  const openFee = pos.openFee || 0;
  const totalTradeFees = Number((openFee + closeFee).toFixed(2));

  // 3. PnL Líquido Realizado (Lucro Bruto - Taxa de Abertura - Taxa de Fechamento)
  const netRealizedPnl = Number((grossPnl - openFee - closeFee).toFixed(2));
  const netRealizedPnlPercent = Number(((netRealizedPnl / pos.investedUSDT) * 100).toFixed(2));

  // 4. Retorno ao saldo disponível:
  // Como `pos.investedUSDT + openFee` já foram descontados na abertura,
  // o dinheiro devolvido ao saldo livre é: margem investida + PnL bruto - taxa de fechamento.
  // Margem isolada: o investidor não pode ficar com saldo negativo na operação (perda máxima = margem investida).
  const returnedCash = Math.max(0, pos.investedUSDT + grossPnl - closeFee);
  const newBalance = Number((account.virtualBalance + returnedCash).toFixed(2));

  // 5. Estatísticas de acerto (apenas trades executados, nunca cancelamentos)
  const isWin = netRealizedPnl > 0;
  const wins = isWin ? account.winTrades + 1 : account.winTrades;
  const losses = !isWin ? account.lossTrades + 1 : account.lossTrades;
  const newTotalFees = Number(((account.totalFeesPaid || 0) + closeFee).toFixed(2));

  const closedPos: PaperPosition = {
    ...pos,
    status: 'CLOSED',
    closedTimestamp: Date.now(),
    closePrice: exitPrice,
    closeFee,
    totalFees: totalTradeFees,
    realizedPnl: netRealizedPnl,
    realizedPnlPercent: netRealizedPnlPercent,
    closeReason: reason
  };

  const updatedAccount: PaperAccount = {
    ...account,
    virtualBalance: newBalance,
    totalFeesPaid: newTotalFees,
    winTrades: wins,
    lossTrades: losses,
    positions: account.positions.filter((p) => p.id !== positionId),
    closedHistory: [closedPos, ...(account.closedHistory || [])]
  };

  return {
    success: true,
    account: updatedAccount,
    position: closedPos
  };
}

/**
 * Avalia cotações atuais contra ordens LIMIT pendentes, Stop-Loss e Take-Profit.
 * Se o preço de um ativo estiver ausente, a posição correspondente é mantida sem erro.
 */
export function evaluateTriggers(
  account: PaperAccount,
  currentAssets: CryptoAsset[]
): TriggerEvaluationResult {
  if (!account.positions || account.positions.length === 0) {
    return { account, triggeredOrders: [] };
  }

  const priceMap = new Map<string, number>();
  for (const asset of currentAssets) {
    if (Number.isFinite(asset.price) && asset.price > 0) {
      priceMap.set(asset.symbol, asset.price);
    }
  }

  let currentAcc = { ...account };
  const triggeredEvents: TriggerEvaluationResult['triggeredOrders'] = [];
  const remainingPositions: PaperPosition[] = [];
  let mutated = false;

  for (const pos of currentAcc.positions) {
    const livePrice = priceMap.get(pos.symbol);

    // Se o preço estiver ausente, mantém a posição intacta
    if (livePrice === undefined) {
      remainingPositions.push(pos);
      continue;
    }

    // 1. Ordens LIMIT Pendentes
    if (pos.status === 'PENDING') {
      const targetLimit = pos.limitPrice || pos.entryPrice;
      let isFilled = false;

      if (pos.direction === 'LONG' && livePrice <= targetLimit) {
        isFilled = true;
      } else if (pos.direction === 'SHORT' && livePrice >= targetLimit) {
        isFilled = true;
      }

      if (isFilled) {
        mutated = true;
        // Ordem LIMIT executada: vira OPEN com preço exato do limite
        remainingPositions.push({
          ...pos,
          status: 'OPEN',
          entryPrice: targetLimit,
          currentPrice: livePrice,
          triggeredTimestamp: Date.now()
        });
        currentAcc.totalTrades = (currentAcc.totalTrades || 0) + 1;
        triggeredEvents.push({
          positionId: pos.id,
          symbol: pos.symbol,
          type: 'LIMIT_FILLED',
          price: targetLimit
        });
      } else {
        // Mantém pendente com cotação atualizada
        remainingPositions.push({ ...pos, currentPrice: livePrice });
      }
      continue;
    }

    // 2. Posições Abertas (Avaliação de TP e SL)
    if (pos.status === 'OPEN') {
      let shouldClose = false;
      let exitReason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'LIQUIDATION' | null = null;
      let exitPrice = livePrice;

      // Liquidação tem prioridade: se o preço já passou dela, a margem foi perdida antes de qualquer stop
      const liq = liquidationPrice(pos.direction, pos.entryPrice, pos.leverage);
      const liquidated = pos.direction === 'LONG' ? livePrice <= liq : livePrice >= liq;

      if (liquidated) {
        shouldClose = true;
        exitReason = 'LIQUIDATION';
        exitPrice = liq;
      } else if (pos.direction === 'LONG') {
        if (pos.targetPrice && livePrice >= pos.targetPrice) {
          shouldClose = true;
          exitReason = 'TAKE_PROFIT';
          exitPrice = pos.targetPrice;
        } else if (pos.stopLossPrice && livePrice <= pos.stopLossPrice) {
          shouldClose = true;
          exitReason = 'STOP_LOSS';
          exitPrice = pos.stopLossPrice;
        }
      } else {
        // SHORT
        if (pos.targetPrice && livePrice <= pos.targetPrice) {
          shouldClose = true;
          exitReason = 'TAKE_PROFIT';
          exitPrice = pos.targetPrice;
        } else if (pos.stopLossPrice && livePrice >= pos.stopLossPrice) {
          shouldClose = true;
          exitReason = 'STOP_LOSS';
          exitPrice = pos.stopLossPrice;
        }
      }

      if (shouldClose && exitReason) {
        mutated = true;
        // Realiza fechamento
        const res = closeOpenPosition(currentAcc, pos.id, exitPrice, exitReason);
        if (res.success) {
          currentAcc = res.account;
          triggeredEvents.push({
            positionId: pos.id,
            symbol: pos.symbol,
            type: exitReason,
            price: exitPrice,
            netPnl: res.position?.realizedPnl
          });
        } else {
          remainingPositions.push({ ...pos, currentPrice: livePrice });
        }
      } else {
        remainingPositions.push({ ...pos, currentPrice: livePrice });
      }
    }
  }

  if (mutated) {
    // Se houve alterações que não foram fechamentos completos (ex: LIMIT preenchida)
    currentAcc.positions = remainingPositions.filter((p) => p.status !== 'CLOSED');
    return { account: currentAcc, triggeredOrders: triggeredEvents };
  }

  // Apenas atualizou currentPrice das posições
  return {
    account: { ...account, positions: remainingPositions },
    triggeredOrders: []
  };
}

/**
 * Calcula todas as métricas financeiras consolidadas da conta de Paper Trading.
 * Garante que:
 * - A margem de posições abertas e ordens pendentes seja preservada no patrimônio total.
 * - As taxas de abertura não sejam descontadas duas vezes.
 * - Ordens canceladas não diminuam a taxa de acerto.
 */
export function calculateAccountMetrics(
  account: PaperAccount,
  currentAssets: CryptoAsset[]
): AccountMetrics {
  const priceMap = new Map<string, number>();
  for (const asset of currentAssets) {
    priceMap.set(asset.symbol, asset.price);
  }

  let openPositionsMargin = 0;
  let pendingOrdersMargin = 0;
  let totalNotional = 0;
  let unrealizedGrossPnl = 0;
  let unrealizedNetPnl = 0;
  let totalPositionLiquidationValue = 0;

  for (const pos of account.positions || []) {
    if (pos.status === 'PENDING') {
      // Ordem pendente retém margem e taxa de abertura reservada
      pendingOrdersMargin += pos.investedUSDT + (pos.openFee || 0);
    } else if (pos.status === 'OPEN') {
      const livePrice = priceMap.get(pos.symbol) || pos.currentPrice || pos.entryPrice;
      const notional = pos.amount * livePrice;
      const priceDiff = pos.direction === 'LONG' ? livePrice - pos.entryPrice : pos.entryPrice - livePrice;
      const grossPnl = pos.investedUSDT * ((priceDiff / pos.entryPrice) * pos.leverage);
      const openFee = pos.openFee || Number((pos.investedUSDT * pos.leverage * TRADING_FEE_RATE).toFixed(4));
      const estCloseFee = Number((notional * TRADING_FEE_RATE).toFixed(4));
      const netPnl = grossPnl - openFee - estCloseFee;

      openPositionsMargin += pos.investedUSDT;
      totalNotional += notional;
      unrealizedGrossPnl += grossPnl;
      unrealizedNetPnl += netPnl;

      // Valor de liquidação da posição se fechada agora:
      // Retorna margem + grossPnl - estCloseFee (isolado: teto mín de 0)
      const liquidationValue = Math.max(0, pos.investedUSDT + grossPnl - estCloseFee);
      totalPositionLiquidationValue += liquidationValue;
    }
  }

  const totalReservedMargin = openPositionsMargin + pendingOrdersMargin;

  // Patrimônio Total Simulado:
  // Saldo livre + Margem e taxas retidas em ordens pendentes + Valor de liquidação das posições abertas
  const totalEquity = Number((account.virtualBalance + pendingOrdersMargin + totalPositionLiquidationValue).toFixed(2));

  // Histórico de operações executadas (excluindo canceladas)
  const executedTrades = (account.closedHistory || []).filter((p) => p.closeReason !== 'CANCELLED');
  const winCount = executedTrades.filter((p) => (p.realizedPnl || 0) > 0).length;
  const lossCount = executedTrades.filter((p) => (p.realizedPnl || 0) <= 0).length;
  const winRatePercent = executedTrades.length > 0
    ? Number(((winCount / executedTrades.length) * 100).toFixed(1))
    : 0;

  return {
    virtualBalance: Number(account.virtualBalance.toFixed(2)),
    openPositionsMargin: Number(openPositionsMargin.toFixed(2)),
    pendingOrdersMargin: Number(pendingOrdersMargin.toFixed(2)),
    totalReservedMargin: Number(totalReservedMargin.toFixed(2)),
    totalNotional: Number(totalNotional.toFixed(2)),
    unrealizedGrossPnl: Number(unrealizedGrossPnl.toFixed(2)),
    unrealizedNetPnl: Number(unrealizedNetPnl.toFixed(2)),
    totalEquity,
    totalFeesPaid: Number((account.totalFeesPaid || 0).toFixed(2)),
    totalExecutedTrades: executedTrades.length,
    winTrades: winCount,
    lossTrades: lossCount,
    winRatePercent
  };
}

/**
 * PnL líquido não realizado de uma posição aberta (LONG ou SHORT), já descontando a taxa de abertura
 * e a taxa estimada de fechamento. Fonte única usada pelas telas.
 */
export function positionUnrealizedPnl(pos: PaperPosition, livePrice: number): { pnl: number; pct: number } {
  const diff = pos.direction === 'LONG' ? livePrice - pos.entryPrice : pos.entryPrice - livePrice;
  const gross = pos.investedUSDT * (diff / pos.entryPrice) * pos.leverage;
  const fees = (pos.openFee || 0) + pos.amount * livePrice * TRADING_FEE_RATE;
  const pnl = gross - fees;
  return { pnl, pct: pos.investedUSDT > 0 ? (pnl / pos.investedUSDT) * 100 : 0 };
}

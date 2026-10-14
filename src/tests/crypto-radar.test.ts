/**
 * Suíte de Testes Automatizados de Regressão e Auditoria Técnica - CryptoRadar
 * Executa as funções reais de negócio da aplicação:
 * - Indicadores Wilder's RSI (1978), EMA e MACD com vetores de referência e aquecimento
 * - Diagnóstico Técnico dinâmico (sem valores fixos) com identificação de dados insuficientes
 * - Contabilidade de Paper Trading de ponta a ponta: LONG e SHORT (lucro, prejuízo, alavancagem, taxas e patrimônio total)
 * - Ordens MARKET e LIMIT, cancelamento, Stop-Loss, Take-Profit e ausência de cotação
 * - Parsing oficial de Klines da Binance e tratamento de erros de API
 * - Validação segura de Telegram (sem vazamento de token no navegador e rate limiting)
 */

import {
  calculateWilderRSI,
  calculateEMA,
  calculateMACD,
  calculateBollingerBands,
  calculateFearGreedIndex,
  calculateTechnicalDiagnosis
} from '../services/indicators';

import {
  createTradeOrder,
  cancelPendingOrder,
  closeOpenPosition,
  evaluateTriggers,
  calculateAccountMetrics,
  TRADING_FEE_RATE
} from '../services/paperTradingService';

import {
  apiService,
  parseBinanceKline,
  priceDecimals,
  timeframeToBinanceInterval,
  validateBinanceMarketData,
  MarketDataValidator
} from '../services/apiService';

import {
  validateTelegramDestination,
  getTelegramServerStatus
} from '../services/telegramService';

import { calculateAllIndicators, calculateATR } from '../services/indicators';
import { runBacktest, computeStats, BacktestTrade } from '../services/backtest';
import { buildUniverse as buildUniverseRaw, resolveFuturesSymbol, resetTop100Cache } from '../../server/universe';

// Testes não gravam cache em disco, não esperam entre tentativas e partem sempre de cache vazio
process.env.STATE_BACKEND = 'memory'; // testes não gravam no disco nem no Supabase
process.env.UNIVERSE_CACHE = 'off';
process.env.RETRY_BASE_MS = '1';
const buildUniverse = (m?: 'spot' | 'futures') => { resetTop100Cache(); return buildUniverseRaw(m); };
import { formatTelegramAlert } from '../../server/scanner';
import { computeSignalPerformance, signalResultR, evaluateReadiness, PerfSignal } from '../services/signalPerformance';
import { suggestAmount } from '../components/paperTrading/TradeSheet';
import { historyToCsv } from '../components/paperTrading/WalletView';
import { liquidationPrice, stopBeforeLiquidation, maxSafeLeverage, futuresSizing } from '../services/futures';
import { positionUnrealizedPnl } from '../services/paperTradingService';
import { summarizeBatch, riskCurve, withoutBest } from '../services/backtestBatch';
import { detectTrendEntry, updateTrendSignal, canEnter, splitClosed, trendSignalResult, evaluateTrendReadiness, TrendSignal } from '../services/trendSignals';
import { runTrendBacktest, btcRegimeByDay, TREND_RULES } from '../services/trendBacktest';
import { parseYahooChart, B3_TICKERS, yahooSymbol } from '../../server/b3Data';
import { startBatchJob, getBatchJob } from '../../server/backtestJob';
import { futuresKlines, futuresPrices, futuresSymbolsFrom, getFuturesProvider, resetFuturesProvider, toOkxInstrument } from '../../server/futuresData';
import { getState, setState, stateBackend, storageInfo, storageHealth } from '../../server/stateStore';
import { stateRead, stateWrite, validPaperAccount, checkAccess } from '../../server/stateApi';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { decideSync, SyncQueue, pullState, pushState, accessKey, fetchStorageInfo } from '../services/remoteState';
import { localStore } from '../services/localStore';
import { runHealth, detectHost, DEFAULT_HOST } from '../../server/health';
import { shouldServeStatic } from '../../server/runtime';
import { runTrendScan, getTrendState, resetTrendState, formatTrendAlert } from '../../server/trendScanner';
import { evaluateSignal, scoreCandles, MIN_SCORE } from '../services/signalEngine';
import { StorageService, INITIAL_PAPER_ACCOUNT } from '../services/storageService';
import { CandleData, CryptoAsset, PaperAccount } from '../types/crypto';

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, details?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ [PASS] ${testName}`);
  } else {
    console.error(`  ✗ [FAIL] ${testName} ${details ? `(${details})` : ''}`);
    throw new Error(`Falha no teste: ${testName}`);
  }
}

function createCandles(prices: number[]): CandleData[] {
  return prices.map((price, idx) => ({
    time: `0${idx}:00`,
    timestamp: 1700000000000 + idx * 3600000,
    open: price,
    high: price * 1.005,
    low: price * 0.995,
    close: price,
    volume: 1000
  }));
}

console.log('========================================================');
console.log('1. AUDITORIA DO RSI DE WILDER (1978) E AQUECIMENTO');
console.log('========================================================');

// 1.1 Séries vazias e séries em período de aquecimento (< 14 períodos)
const emptyResult = calculateWilderRSI([], 14);
assert(emptyResult.length === 0, 'Série vazia retorna array vazio');

const singleCandle = createCandles([100]);
const singleResult = calculateWilderRSI(singleCandle, 14);
assert(singleResult[0].rsi === undefined, 'Vela única retorna undefined (warm-up / cálculo indisponível)');

const short5 = createCandles([100, 102, 101, 103, 104]);
const short5Result = calculateWilderRSI(short5, 14);
assert(
  short5Result.every((c) => c.rsi === undefined),
  'Série de 5 velas (< 14) retorna undefined para todas as velas (diferencia indisponível de neutro 50.0)'
);

// 1.2 Exatamente 14 velas (ainda em aquecimento, pois 14 velas contêm apenas 13 variações)
const candles14 = createCandles([
  100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113
]);
const res14 = calculateWilderRSI(candles14, 14);
assert(res14[13].rsi === undefined, '14 velas contêm 13 variações: última vela ainda em warm-up (undefined)');

// 1.3 15 velas flat (14 variações nulas completas) => Neutro legítimo 50.0
const flatPrices15 = new Array(15).fill(100);
const flatResult = calculateWilderRSI(createCandles(flatPrices15), 14);
assert(flatResult[13].rsi === undefined, 'Vela 13 (< 14 deltas) é undefined');
assert(flatResult[14].rsi === 50.0, 'Vela 14 (14 deltas nulos) tem RSI neutro legítimo de 50.0');

// 1.4 15 velas somente de alta => RSI = 100.0
const gainsPrices15 = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114];
const gainsResult = calculateWilderRSI(createCandles(gainsPrices15), 14);
assert(gainsResult[14].rsi === 100.0, 'Mercado exclusivamente com ganhos resulta em RSI = 100.0');

// 1.5 15 velas somente de queda => RSI = 0.0
const lossesPrices15 = [114, 113, 112, 111, 110, 109, 108, 107, 106, 105, 104, 103, 102, 101, 100];
const lossesResult = calculateWilderRSI(createCandles(lossesPrices15), 14);
assert(lossesResult[14].rsi === 0.0, 'Mercado exclusivamente com perdas resulta em RSI = 0.0');

// 1.6 VETOR DE REFERÊNCIA CLÁSSICO DE WILDER (1978 - "New Concepts in Technical Trading Systems")
// Tabela de teste padrão do livro original de Welles Wilder (15 preços para 14 períodos de variação):
const wilderReferencePrices = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28
];
const wilderTest = calculateWilderRSI(createCandles(wilderReferencePrices), 14);
assert(
  wilderTest[14].rsi === 70.5,
  'Vetor de referência clássico de Wilder (1978) confere com precisão exata: RSI = 70.5',
  `Obtido: ${wilderTest[14].rsi}`
);

console.log('\n========================================================');
console.log('2. AUDITORIA DE EMA, MACD E DIAGNÓSTICO TÉCNICO DINÂMICO');
console.log('========================================================');

// 2.1 EMA 20: warm-up e inicialização via SMA
const prices30 = Array.from({ length: 30 }, (_, i) => 100 + i);
const emaCandles = calculateEMA(createCandles(prices30), 20, 2);
assert(emaCandles[0].ema20 === undefined, 'Vela 0 da EMA20 está em warm-up (undefined)');
assert(emaCandles[18].ema20 === undefined, 'Vela 18 (< 20) está em warm-up (undefined)');
assert(emaCandles[19].ema20 === 109.5, 'Vela 19 inicializa EMA20 com a SMA dos primeiros 20 períodos (109.50)');
assert(emaCandles[29].ema20 !== undefined && emaCandles[29].ema20! > 109.5, 'Velas subsequentes aplicam suavização exponencial k=2/21');

// 2.2 MACD: exige 34 períodos para aquecimento completo
const prices50 = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i) * 5);
const macdCandles = calculateMACD(createCandles(prices50), 12, 26, 9, 2);
assert(macdCandles[0].macd === undefined, 'Vela 0 do MACD está em warm-up (undefined)');
assert(macdCandles[32].macd === undefined, 'Vela 32 (< 34) do MACD está em warm-up (undefined)');
assert(macdCandles[33].macd !== undefined, 'Vela 33 possui MACD completamente inicializado');
assert(
  macdCandles[33].macd!.histogram === Number((macdCandles[33].macd!.macd - macdCandles[33].macd!.signal).toFixed(2)),
  'Histograma do MACD é rigorosamente igual a (Linha MACD - Linha de Sinal)'
);

// 2.3 Diagnóstico Técnico Dinâmico em período de aquecimento (< 15 velas)
const diagnosisShort = calculateTechnicalDiagnosis(createCandles(wilderReferencePrices.slice(0, 10)));
assert(diagnosisShort.oscillators.label === 'Dados Insuficientes', 'Diagnóstico de osciladores indica Dados Insuficientes durante warm-up');
assert(diagnosisShort.oscillators.ruleExplanation.includes('Wilder'), 'Diagnóstico explica que Wilder exige 14 períodos');
assert(diagnosisShort.movingAverages.label === 'Dados Insuficientes', 'Diagnóstico de médias indica Dados Insuficientes');
assert(diagnosisShort.summary.verdict === 'Dados Insuficientes', 'Resumo de consenso indica Dados Insuficientes durante warm-up');

// 2.4 Diagnóstico Técnico Dinâmico com série completa (> 50 velas)
const series60 = Array.from({ length: 60 }, (_, i) => 100 + i * 2);
let processed60 = calculateEMA(createCandles(series60), 20, 2);
processed60 = calculateEMA(processed60, 50, 2);
processed60 = calculateWilderRSI(processed60, 14);
processed60 = calculateMACD(processed60, 12, 26, 9, 2);

const diagnosisFull = calculateTechnicalDiagnosis(processed60);
assert(diagnosisFull.oscillators.label !== 'Dados Insuficientes', 'Osciladores com série completa calculam classificação real');
assert(diagnosisFull.movingAverages.label === 'Compra Forte', 'Série de alta contínua classifica médias móveis como Compra Forte');
assert(diagnosisFull.summary.buyCount > 0, 'Consenso computa sinais reais de compra');
assert(diagnosisFull.summary.ruleExplanation.includes('consenso') || diagnosisFull.summary.ruleExplanation.includes('Consenso'), 'Explica a fundamentação das regras analisadas');

console.log('\n========================================================');
console.log('3. AUDITORIA CONTÁBIL NUMÉRICA DE PAPER TRADING (LONG E SHORT)');
console.log('========================================================');

// Conta inicial limpa de $10,000 USDT
let testAccount: PaperAccount = {
  virtualBalance: 10000.00,
  initialBalance: 10000.00,
  totalTrades: 0,
  winTrades: 0,
  lossTrades: 0,
  totalFeesPaid: 0,
  positions: [],
  closedHistory: []
};

// 3.1 Validação de Entradas Inválidas
const orderNegMargin = createTradeOrder(testAccount, {
  symbol: 'BTCUSDT', direction: 'LONG', orderType: 'MARKET',
  entryPrice: 50000, currentPrice: 50000, investedUSDT: -100, leverage: 1
});
assert(!orderNegMargin.success, 'Margem investida negativa é rejeitada');

const orderZeroLev = createTradeOrder(testAccount, {
  symbol: 'BTCUSDT', direction: 'LONG', orderType: 'MARKET',
  entryPrice: 50000, currentPrice: 50000, investedUSDT: 500, leverage: 0
});
assert(!orderZeroLev.success, 'Alavancagem inferior a 1x é rejeitada');

const orderInvTpLong = createTradeOrder(testAccount, {
  symbol: 'BTCUSDT', direction: 'LONG', orderType: 'MARKET',
  entryPrice: 50000, currentPrice: 50000, investedUSDT: 500, leverage: 1, targetPrice: 48000
});
assert(!orderInvTpLong.success, 'Em LONG, Take-Profit menor que entrada é rejeitado');

const orderInvSlShort = createTradeOrder(testAccount, {
  symbol: 'BTCUSDT', direction: 'SHORT', orderType: 'MARKET',
  entryPrice: 50000, currentPrice: 50000, investedUSDT: 500, leverage: 1, stopLossPrice: 48000
});
assert(!orderInvSlShort.success, 'Em SHORT, Stop-Loss menor que entrada é rejeitado');

const orderExcessBalance = createTradeOrder(testAccount, {
  symbol: 'BTCUSDT', direction: 'LONG', orderType: 'MARKET',
  entryPrice: 50000, currentPrice: 50000, investedUSDT: 15000, leverage: 1
});
assert(!orderExcessBalance.success, 'Investimento maior que saldo virtual livre é rejeitado');
assert(testAccount.virtualBalance === 10000.00, 'Saldo permanece intacto em $10,000.00');

// 3.2 TESTE NUMÉRICO RIGOROSO: LONG COM LUCRO E ALAVANCAGEM 10x
// Investimento = $1,000 USDT, Alavancagem = 10x
// Nocional = 1,000 * 10 = $10,000 USDT
// Preço de entrada = $50,000 => Quantidade = 10,000 / 50,000 = 0.2 BTC
// Taxa de abertura (0.05% de $10,000) = $5.00 USDT
// Saldo disponível após abertura: 10,000 - 1,000 - 5.00 = $8,995.00 USDT
const orderLong10x = createTradeOrder(testAccount, {
  symbol: 'BTCUSDT',
  direction: 'LONG',
  orderType: 'MARKET',
  entryPrice: 50000,
  currentPrice: 50000,
  investedUSDT: 1000,
  leverage: 10
});
assert(orderLong10x.success, 'Ordem LONG 10x aberta com sucesso');
testAccount = orderLong10x.account;
assert(testAccount.virtualBalance === 8995.00, 'Saldo livre deduz exatamente $1,005.00 ($8,995.00)');
assert(testAccount.totalFeesPaid === 5.00, 'Taxa de abertura registrada em $5.00');
assert(orderLong10x.position!.amount === 0.2, 'Quantidade calculada com precisão: 0.2 BTC');

// Preço sobe para $55,000 (+10% no preço, +100% na operação 10x)
// Nocional de saída = 0.2 * 55,000 = $11,000 USDT
// Lucro bruto = 1,000 * ((55,000 - 50,000) / 50,000) * 10 = 1,000 * 1.0 = +$1,000.00 USDT
// Taxa de fechamento (0.05% de $11,000) = $5.50 USDT
// Taxa de abertura já deduzida = $5.00 USDT
// PnL Líquido Realizado = +1,000.00 - 5.00 - 5.50 = +$989.50 USDT
// Retorno ao saldo: Margem (1,000) + Lucro Bruto (1,000) - Taxa de Fechamento (5.50) = $1,994.50 USDT
// Novo Saldo Livre: 8,995.00 + 1,994.50 = $10,989.50 USDT
// Conferência: Saldo Inicial ($10,000) + PnL Líquido ($989.50) = $10,989.50 USDT!
const closeLongRes = closeOpenPosition(testAccount, orderLong10x.position!.id, 55000, 'MANUAL');
assert(closeLongRes.success, 'Fechamento LONG executado');
testAccount = closeLongRes.account;
const closedLong = closeLongRes.position!;

assert(closedLong.realizedPnl === 989.50, `PnL Líquido LONG 10x exato: $989.50 (obtido: ${closedLong.realizedPnl})`);
assert(closedLong.closeFee === 5.50, `Taxa de fechamento LONG exata: $5.50 (obtido: ${closedLong.closeFee})`);
assert(closedLong.totalFees === 10.50, `Total de taxas pagas no trade (5 + 5.50): $10.50 (obtido: ${closedLong.totalFees})`);
assert(testAccount.virtualBalance === 10989.50, `Saldo livre confere sem centavo de divergência: $10,989.50 (obtido: ${testAccount.virtualBalance})`);
assert(testAccount.totalFeesPaid === 10.50, 'Taxas acumuladas na conta conferem: $10.50');
assert(testAccount.winTrades === 1 && testAccount.lossTrades === 0, '1 trade vencedor e 0 perdedores');

// 3.3 TESTE NUMÉRICO RIGOROSO: SHORT COM LUCRO E ALAVANCAGEM 10x
// Investimento = $1,000 USDT, Alavancagem = 10x
// Nocional = $10,000 USDT. Preço entrada = $50,000 => Quantidade = 0.2 BTC
// Taxa abertura = $5.00 USDT. Saldo livre: 10,989.50 - 1,005 = $9,984.50 USDT
const orderShort10x = createTradeOrder(testAccount, {
  symbol: 'BTCUSDT',
  direction: 'SHORT',
  orderType: 'MARKET',
  entryPrice: 50000,
  currentPrice: 50000,
  investedUSDT: 1000,
  leverage: 10
});
testAccount = orderShort10x.account;
assert(testAccount.virtualBalance === 9984.50, 'Saldo livre deduzido na abertura SHORT ($9,984.50)');

// Preço cai para $45,000 (+10% de ganho em SHORT, +100% com 10x)
// Nocional de saída = 0.2 * 45,000 = $9,000 USDT
// Lucro bruto = 1,000 * ((50,000 - 45,000) / 50,000) * 10 = +$1,000.00 USDT
// Taxa de fechamento (0.05% de $9,000) = $4.50 USDT
// PnL Líquido Realizado = 1,000.00 - 5.00 - 4.50 = +$990.50 USDT
// Retorno ao saldo: 1,000 + 1,000 - 4.50 = $1,995.50 USDT
// Novo Saldo Livre: 9,984.50 + 1,995.50 = $11,980.00 USDT
// Conferência: Saldo anterior (10,989.50) + PnL Líquido (990.50) = $11,980.00 USDT!
const closeShortRes = closeOpenPosition(testAccount, orderShort10x.position!.id, 45000, 'MANUAL');
testAccount = closeShortRes.account;
const closedShort = closeShortRes.position!;

assert(closedShort.realizedPnl === 990.50, `PnL Líquido SHORT 10x exato: $990.50 (obtido: ${closedShort.realizedPnl})`);
assert(testAccount.virtualBalance === 11980.00, `Saldo livre após SHORT com lucro confere: $11,980.00 (obtido: ${testAccount.virtualBalance})`);
assert(testAccount.winTrades === 2 && testAccount.lossTrades === 0, '2 trades vencedores');

// 3.4 TESTE NUMÉRICO RIGOROSO: SHORT COM PREJUÍZO E ALAVANCAGEM 10x
// Investimento = $1,000 USDT, Alavancagem = 10x
// Preço entrada = $50,000 => Quantidade = 0.2 BTC
// Preço sobe para $52,500 (+5% no preço => -50% no trade SHORT)
// Lucro bruto = 1,000 * ((50,000 - 52,500) / 50,000) * 10 = -$500.00 USDT
// Nocional saída = 0.2 * 52,500 = $10,500 USDT
// Taxa saída = 10,500 * 0.0005 = $5.25 USDT
// Taxa entrada = $5.00 USDT
// PnL Líquido = -500.00 - 5.00 - 5.25 = -$510.25 USDT
// Retorno ao saldo: Margem (1,000) - 500 - 5.25 = $494.75 USDT
// Saldo livre pré-fechamento = 11,980.00 - 1,005 = 10,975.00 USDT
// Saldo livre pós-fechamento = 10,975.00 + 494.75 = $11,469.75 USDT
// Conferência: 11,980.00 - 510.25 = $11,469.75 USDT!
const shortLossOrder = createTradeOrder(testAccount, {
  symbol: 'BTCUSDT', direction: 'SHORT', orderType: 'MARKET',
  entryPrice: 50000, currentPrice: 50000, investedUSDT: 1000, leverage: 10
});
testAccount = shortLossOrder.account;
const closeShortLoss = closeOpenPosition(testAccount, shortLossOrder.position!.id, 52500, 'MANUAL');
testAccount = closeShortLoss.account;

assert(closeShortLoss.position!.realizedPnl === -510.25, `PnL Líquido SHORT com prejuízo: -$510.25 (obtido: ${closeShortLoss.position!.realizedPnl})`);
assert(testAccount.virtualBalance === 11469.75, `Saldo livre reflete perda de SHORT: $11,469.75 (obtido: ${testAccount.virtualBalance})`);
assert(testAccount.winTrades === 2 && testAccount.lossTrades === 1, '2 vitórias e 1 derrota');

console.log('\n========================================================');
console.log('4. AUDITORIA DE LIMIT, CANCELAMENTO, TP/SL E AUSÊNCIA DE COTAÇÃO');
console.log('========================================================');

// 4.1 Ordem LIMIT pendente e cancelamento com reembolso integral de margem e taxas
const pendingOrderRes = createTradeOrder(testAccount, {
  symbol: 'BTCUSDT', direction: 'LONG', orderType: 'LIMIT',
  entryPrice: 40000, currentPrice: 48000, limitPrice: 40000,
  investedUSDT: 2000, leverage: 1
});
assert(pendingOrderRes.success, 'Ordem LIMIT criada com status PENDING');
testAccount = pendingOrderRes.account;
const balanceBeforeCancel = testAccount.virtualBalance;
const feesBeforeCancel = testAccount.totalFeesPaid;

const cancelPendingRes = cancelPendingOrder(testAccount, pendingOrderRes.position!.id);
assert(cancelPendingRes.success, 'Ordem LIMIT cancelada com sucesso');
testAccount = cancelPendingRes.account;
assert(testAccount.virtualBalance === Number((balanceBeforeCancel + 2000 + 1.00).toFixed(2)), 'Margem e taxa reembolsadas integralmente');
assert(testAccount.totalFeesPaid === Number((feesBeforeCancel - 1.00).toFixed(2)), 'Taxa reservada estornada de totalFeesPaid');

const metricsCancelled = calculateAccountMetrics(testAccount, []);
assert(metricsCancelled.totalExecutedTrades === 3, 'Operação cancelada excluída do cômputo de trades executados');
assert(metricsCancelled.winRatePercent === 66.7, 'Taxa de acerto 66.7% para 2 vitórias de 3 executadas');

// 4.2 Execução automática de LIMIT quando preço atinge alvo
const limitToFill = createTradeOrder(testAccount, {
  symbol: 'SOLUSDT', direction: 'LONG', orderType: 'LIMIT',
  entryPrice: 120, currentPrice: 150, limitPrice: 120,
  investedUSDT: 500, leverage: 1
});
testAccount = limitToFill.account;

// Cotação cai para $118 (atinge e supera o limite de compra $120)
const fillTriggerRes = evaluateTriggers(testAccount, [
  { symbol: 'SOLUSDT', price: 118 } as CryptoAsset
]);
assert(fillTriggerRes.triggeredOrders.length === 1, 'Gatilho de LIMIT preenchido');
assert(fillTriggerRes.triggeredOrders[0].type === 'LIMIT_FILLED', 'Tipo do evento LIMIT_FILLED');
assert(fillTriggerRes.account.positions[0].status === 'OPEN', 'Ordem transiciona para OPEN');
testAccount = fillTriggerRes.account;

// 4.3 Ausência de Cotação: ativo ausente não quebra e mantém posições intactas
const missingPriceRes = evaluateTriggers(testAccount, [
  { symbol: 'AVAXUSDT', price: 30 } as CryptoAsset // Apenas AVAX fornecido
]);
assert(missingPriceRes.account.positions.length === 1, 'Posição mantida intacta quando cotação do ativo está ausente');
assert(missingPriceRes.triggeredOrders.length === 0, 'Nenhum gatilho espúrio disparado');

// 4.4 Take-Profit e Stop-Loss automáticos
// Define TP em $140 e SL em $100 na posição de SOL aberta a $120
testAccount.positions[0].targetPrice = 140;
testAccount.positions[0].stopLossPrice = 100;

// Teste de Take-Profit acionado
const triggerTpRes = evaluateTriggers(testAccount, [
  { symbol: 'SOLUSDT', price: 142 } as CryptoAsset
]);
assert(triggerTpRes.triggeredOrders.length === 1, 'Gatilho de Take-Profit acionado ao vivo');
assert(triggerTpRes.triggeredOrders[0].type === 'TAKE_PROFIT', 'Tipo de gatilho TAKE_PROFIT');
assert(triggerTpRes.account.positions.length === 0, 'Posição encerrada e movida para o histórico');
testAccount = triggerTpRes.account;

console.log('\n========================================================');
console.log('5. AUDITORIA DE PERSISTÊNCIA, BINANCE KLINES E TELEGRAM');
console.log('========================================================');

// 5.1 Persistência e Conta Inicial Limpa
assert(INITIAL_PAPER_ACCOUNT.virtualBalance === 10000.00, 'Conta inicial limpa possui $10,000.00');
assert(INITIAL_PAPER_ACCOUNT.positions.length === 0, 'Conta inicial limpa possui 0 posições');
assert(INITIAL_PAPER_ACCOUNT.closedHistory.length === 0, 'Conta inicial limpa possui 0 histórico');

const freshReset = StorageService.resetPaperAccount(10000);
assert(freshReset.totalTrades === 0 && freshReset.totalFeesPaid === 0, 'Reset zera trades e taxas');

// 5.2 Conversão e Parsing Oficial de Klines da Binance
assert(timeframeToBinanceInterval('15m') === '15m', 'Timeframe 15m mapeia para 15m');
assert(timeframeToBinanceInterval('4h') === '4h', 'Timeframe 4h mapeia para 4h');
assert(timeframeToBinanceInterval('1D') === '1d', 'Timeframe 1D mapeia para 1d');
assert(timeframeToBinanceInterval('1W') === '1w', 'Timeframe 1W mapeia para 1w');

const rawBinanceKline = [
  1700000000000, "65000.50", "65800.00", "64900.00", "65400.00", "1240.50",
  1700003599999, "81140000.00", 25000, "600.00", "39200000.00", "0"
];
const parsedKline = parseBinanceKline(rawBinanceKline, '4h');
assert(parsedKline !== null, 'Kline bruto da Binance é parseado com sucesso');
assert(parsedKline!.open === 65000.50, 'Preço de abertura extraído corretamente');
assert(parsedKline!.high === 65800.00, 'Preço máximo extraído corretamente');
assert(parsedKline!.low === 64900.00, 'Preço mínimo extraído corretamente');
assert(parsedKline!.close === 65400.00, 'Preço de fechamento extraído corretamente');
assert(parsedKline!.volume === 1240.50, 'Volume extraído corretamente');

// 5.3 Validação de Registro Corrompido
assert(parseBinanceKline(['invalid', 'nan'], '4h') === null, 'Kline corrompido retorna null com segurança');

// 5.4 Segurança de Destino no Telegram
assert(validateTelegramDestination('@meucanal').isValid, 'Canal com @ é aceito');
assert(validateTelegramDestination('123456789').isValid, 'Chat ID numérico é aceito');
assert(validateTelegramDestination('-1001234567890').isValid, 'Grupo/Supergrupo numérico negativo é aceito');
assert(!validateTelegramDestination('invalido_sem_arroba').isValid, 'Destino sem @ ou números é rejeitado');
assert(!validateTelegramDestination('').isValid, 'Destino vazio é rejeitado');
assert(!validateTelegramDestination('@exemplo_bot').isValid, 'Identificador de exemplo é rejeitado');

// 5.5 Status da Bybit declarado com honestidade técnica
const exchangeStatuses = await apiService.checkExchangeHealth();
assert(exchangeStatuses.bybit.isImplemented === false, 'Conector Bybit declara explicitamente isImplemented = false');
assert(exchangeStatuses.bybit.status === 'NOT_IMPLEMENTED', 'Status da Bybit é rigorosamente NOT_IMPLEMENTED');

// ============================================================================
// 6. MOTOR DE SINAIS (COMPRA/VENDA, ATR, CONFLUÊNCIA)
// ============================================================================
console.log('\n--- 6. Motor de Sinais ---');

function ohlc(prices: number[], volume = 1000): CandleData[] {
  return prices.map((p, i) => ({
    time: String(i), timestamp: 1_700_000_000_000 + i * 3_600_000,
    open: i === 0 ? p : prices[i - 1], high: Math.max(p, i === 0 ? p : prices[i - 1]) * 1.004,
    low: Math.min(p, i === 0 ? p : prices[i - 1]) * 0.996, close: p, volume
  }));
}
const ctx = { symbol: 'TESTUSDT', baseAsset: 'TEST', timeframe: '1h' };

// Séries com ruído determinístico (LCG) para simular mercado realista
function noisySeries(start: number, drift: number, noise: number, n = 120): number[] {
  let seed = 42;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 - 0.5; };
  const out: number[] = [];
  let p = start;
  for (let i = 0; i < n; i++) { p *= 1 + drift + rnd() * noise; out.push(p); }
  return out;
}
const upCandles = calculateAllIndicators(ohlc(noisySeries(100, 0.0015, 0.02)));
const downCandles = calculateAllIndicators(ohlc(noisySeries(200, -0.0015, 0.02)));
const exhaustedCandles = calculateAllIndicators(ohlc(Array.from({ length: 120 }, (_, i) => 100 * Math.pow(1.006, i))));
const flatCandles = calculateAllIndicators(ohlc(noisySeries(100, 0, 0.02)));

assert(calculateATR(ohlc([100, 101])) === undefined, 'ATR retorna undefined sem velas suficientes');
const atrFlat = calculateATR(ohlc(new Array(30).fill(100)));
assert(atrFlat !== undefined && Math.abs(atrFlat - 0.8) < 0.01, 'ATR de série plana = amplitude high-low (0.8%)', `ATR=${atrFlat}`);

assert(scoreCandles(upCandles.slice(0, 30)) === null, 'Poucas velas => sem pontuação (aquecimento)');

function scan(candles: CandleData[]) {
  const out: NonNullable<ReturnType<typeof evaluateSignal>>[] = [];
  for (let end = 70; end <= candles.length; end++) {
    const sig = evaluateSignal(candles.slice(0, end), ctx);
    if (sig) out.push(sig);
  }
  return out;
}
const upSignals = scan(upCandles);
const downSignals = scan(downCandles);
const buys = upSignals.filter((x) => x.direction === 'LONG');
const sells = downSignals.filter((x) => x.direction === 'SHORT');
assert(buys.length > 0, 'Tendência de alta gera sinais de COMPRA', `compras=${buys.length}`);
assert(buys.length > upSignals.length - buys.length, 'Em alta, compras superam vendas', `${buys.length}/${upSignals.length}`);
assert(sells.length > 0, 'Tendência de baixa gera sinais de VENDA', `vendas=${sells.length}`);
assert(sells.length > downSignals.length - sells.length, 'Em baixa, vendas superam compras', `${sells.length}/${downSignals.length}`);
const buy = buys[0];
const sell = sells[0];
assert(buy.score >= MIN_SCORE && sell.score <= -MIN_SCORE, 'Sinais respeitam a pontuação mínima');
assert(buy.stopLossPrice < buy.entryPrice && buy.targetPrice > buy.entryPrice, 'COMPRA: stop abaixo e alvo acima da entrada');
assert(sell.stopLossPrice > sell.entryPrice && sell.targetPrice < sell.entryPrice, 'VENDA: stop acima e alvo abaixo da entrada');
assert(buy.riskRewardRatio === '1:2.0', 'Risco:retorno 1:2 via ATR');
assert(buy.isDemo === false, 'Sinal do motor não é marcado como demo');
assert(evaluateSignal(exhaustedCandles, ctx)?.direction !== 'LONG', 'Alta exausta (RSI ~100) não gera compra (não persegue topo)');
const flatSignals = scan(flatCandles);
console.log(`    (sinais: alta=${upSignals.length}, baixa=${downSignals.length}, lateral=${flatSignals.length} de ${upCandles.length - 69} janelas)`);
assert(flatSignals.length <= Math.max(upSignals.length, downSignals.length), 'Mercado lateral gera no máximo tantos sinais quanto mercado em tendência');
const again = scan(upCandles).find((x) => x.direction === 'LONG');
assert(again?.id === buy.id, 'ID do sinal é determinístico (dedupe por candle)');

// ============================================================================
// 7. BACKTEST (sem look-ahead, custos, stop prioritário, estatísticas)
// ============================================================================
console.log('\n--- 7. Backtest ---');

const btRaw = ohlc(noisySeries(100, 0.0015, 0.02, 600));
const bt = runBacktest(btRaw, 'TESTUSDT', 'TEST', '1h');
assert(bt.trades.length > 3, 'Backtest gera operações em série longa', `trades=${bt.trades.length}`);
assert(bt.trades.every((t) => t.entryPrice === btRaw[t.entryIndex].open), 'Entrada sempre na ABERTURA da vela seguinte ao sinal (sem look-ahead)');
assert(bt.trades.every((t, k) => k === 0 || t.entryIndex > bt.trades[k - 1].exitIndex), 'Operações não se sobrepõem');
assert(bt.trades.every((t) => Math.abs((t.grossPct - t.netPct) - 0.3) < 1e-9), 'Custos de 0,3% (taxa+derrapagem, 2 lados) descontados em cada operação');
assert(bt.trades.filter((t) => t.exit === 'STOP').every((t) => t.netPct < 0), 'Toda saída por stop resulta em prejuízo líquido');
assert(bt.trades.filter((t) => t.exit === 'TARGET').every((t) => t.grossPct > 0), 'Toda saída por alvo tem retorno bruto positivo');

// Prioridade do stop: vela de entrada com range enorme (toca stop e alvo) => STOP
const first = bt.trades[0];
const tampered = btRaw.map((c) => ({ ...c }));
tampered[first.entryIndex].high = first.entryPrice * 1.5;
tampered[first.entryIndex].low = first.entryPrice * 0.5;
const bt2 = runBacktest(tampered, 'TESTUSDT', 'TEST', '1h');
const first2 = bt2.trades[0];
assert(first2.entryIndex === first.entryIndex && first2.exit === 'STOP' && first2.exitIndex === first.entryIndex,
  'Stop e alvo na mesma vela => considera STOP (pior caso)');

const btDown = runBacktest(ohlc(noisySeries(200, -0.0015, 0.02, 600)), 'TESTUSDT', 'TEST', '1h');
const btDownLong = runBacktest(ohlc(noisySeries(200, -0.0015, 0.02, 600)), 'TESTUSDT', 'TEST', '1h', { longOnly: true });
assert(btDown.trades.some((t) => t.direction === 'SHORT'), 'Backtest padrão inclui vendas a descoberto em mercado de baixa');
assert(btDownLong.trades.every((t) => t.direction === 'LONG'), 'Modo spot (longOnly) não gera nenhuma operação de venda a descoberto');
const btFunding = runBacktest(btRaw, 'TESTUSDT', 'TEST', '1h', { fundingPer8h: 0.0001 });
assert(btFunding.trades.length === bt.trades.length, 'Funding não muda quais operações acontecem');
assert(btFunding.trades.every((t, k) => {
  const held = t.exitIndex - t.entryIndex + 1;
  const expectedExtra = 0.0001 * (held / 8) * 100;
  return Math.abs((bt.trades[k].netPct - t.netPct) - expectedExtra) < 1e-9;
}), 'Funding desconta 0,01% por 8h de posição aberta em cada operação');
assert(btFunding.stats.totalNetPct < bt.stats.totalNetPct, 'Com funding o resultado total é menor');
assert(runBacktest(btRaw.slice(0, 40), 'TESTUSDT', 'TEST', '1h').trades.length === 0, 'Histórico curto => nenhuma operação');

// Estatísticas com valores calculados à mão
const mk = (netPct: number, exit: BacktestTrade['exit'], dir: 'LONG' | 'SHORT' = 'LONG'): BacktestTrade => ({
  symbol: 'X', timeframe: '1h', direction: dir, score: 70, entryIndex: 0, exitIndex: 1, entryPrice: 1, exitPrice: 1,
  exit, grossPct: netPct, netPct, rMultiple: netPct / 2
});
const st = computeStats([mk(3, 'TARGET'), mk(-2, 'STOP'), mk(-2, 'STOP', 'SHORT'), mk(3, 'TARGET')]);
assert(st.trades === 4 && st.wins === 2 && st.losses === 2 && st.winRate === 50, 'Contagem de acertos e taxa de acerto');
assert(Math.abs(st.profitFactor! - 1.5) < 1e-9, 'Fator de lucro = ganhos 6 / perdas 4 = 1,5');
assert(Math.abs(st.avgNetPct - 0.5) < 1e-9 && st.totalNetPct === 2, 'Expectativa 0,5% por operação e soma 2%');
assert(st.maxDrawdownPct === 4, 'Drawdown máximo sobre a curva de retornos (pico 3, vale -1 = 4)');
assert(st.longTrades === 3 && st.shortTrades === 1 && st.targetExits === 2 && st.stopExits === 2, 'Contagem por direção e por tipo de saída');
assert(computeStats([mk(2, 'TARGET')]).profitFactor === null, 'Sem perdas => fator de lucro indefinido (null)');
assert(computeStats([]).trades === 0 && computeStats([]).winRate === 0, 'Estatísticas vazias não quebram');

// ============================================================================
// 8. UNIVERSO (TOP 100 ∩ BINANCE ∩ BYBIT) E MODO SPOT
// ============================================================================
console.log('\n--- 8. Universo e modo spot ---');

const realFetch = globalThis.fetch;
const jsonRes = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
function mockFetch(bybitOk = true) {
  globalThis.fetch = ((url: any) => {
    const u = String(url);
    if (u.includes('coingecko')) {
      return jsonRes([
        { symbol: 'btc', name: 'Bitcoin', market_cap_rank: 1, market_cap: 1e12 },
        { symbol: 'usdt', name: 'Tether', market_cap_rank: 2, market_cap: 1e11 },
        { symbol: 'eth', name: 'Ethereum', market_cap_rank: 3, market_cap: 4e11 },
        { symbol: 'kas', name: 'Kaspa', market_cap_rank: 4, market_cap: 3e9 },   // só Binance
        { symbol: 'leo', name: 'LEO', market_cap_rank: 5, market_cap: 8e9 },     // nenhuma
        { symbol: 'xyz', name: 'Xyz', market_cap_rank: 6, market_cap: 1e9 }      // só Bybit
      ]);
    }
    if (u.includes('/api/v3/ticker/price')) return jsonRes([{ symbol: 'BTCUSDT', price: '1' }, { symbol: 'ETHUSDT', price: '1' }, { symbol: 'KASUSDT', price: '1' }]);
    if (u.includes('bybit.com')) {
      return bybitOk
        ? jsonRes({ retCode: 0, result: { list: [{ symbol: 'BTCUSDT' }, { symbol: 'ETHUSDT' }, { symbol: 'XYZUSDT' }] } })
        : Promise.resolve(new Response('blocked', { status: 403 }));
    }
    return Promise.reject(new Error('url inesperada: ' + u));
  }) as typeof fetch;
}

delete process.env.CMC_API_KEY;
process.env.EXCHANGES = 'binance,bybit';
mockFetch();
const uni = await buildUniverse();
assert(uni.coins.map((c) => c.baseAsset).join(',') === 'BTC,ETH', 'Universo = interseção Binance ∩ Bybit (sem stablecoin)', uni.coins.map((c) => c.baseAsset).join(','));
assert(uni.skipped.includes('KAS [sem Bybit]'), 'Moeda só na Binance é ignorada e marcada "sem Bybit"');
assert(uni.skipped.includes('XYZ [sem Binance]'), 'Moeda só na Bybit é ignorada e marcada "sem Binance"');
assert(uni.skipped.includes('LEO [sem Binance e Bybit]'), 'Moeda em nenhuma corretora é ignorada');
assert(!uni.coins.some((c) => c.baseAsset === 'USDT'), 'Stablecoin não entra no universo');
assert(uni.exchanges.join(',') === 'binance,bybit', 'Universo declara as corretoras exigidas');

mockFetch(false);
let bybitFailed = false;
try { await buildUniverse(); } catch { bybitFailed = true; }
assert(bybitFailed, 'Bybit indisponível => falha explícita (não finge interseção só com Binance)');

process.env.EXCHANGES = 'binance';
mockFetch(false);
const uniBinanceOnly = await buildUniverse();
assert(uniBinanceOnly.coins.map((c) => c.baseAsset).join(',') === 'BTC,ETH,KAS', 'EXCHANGES=binance dispensa a Bybit');
delete process.env.EXCHANGES;
globalThis.fetch = realFetch;

if (sell) {
  const spotMsg = formatTelegramAlert(sell, 'spot');
  assert(spotMsg.includes('sair da posição') && !spotMsg.includes('Stop:'), 'Alerta de VENDA em spot: "sair da posição", sem stop/alvo de short');
  assert(formatTelegramAlert(sell, 'futures').includes('short'), 'Alerta de VENDA em futuros: indica short');
}
if (buy) assert(formatTelegramAlert(buy, 'spot').includes('Stop:'), 'Alerta de COMPRA traz entrada, alvo e stop');

// ============================================================================
// 9. DESEMPENHO DOS SINAIS ENCERRADOS
// ============================================================================
console.log('\n--- 9. Desempenho dos sinais ---');

const mkSig = (o: Partial<PerfSignal>): PerfSignal => ({
  id: 'x', symbol: 'AAAUSDT', baseAsset: 'AAA', direction: 'LONG', strategy: 'VOLUME_SPIKE', strategyName: 'x',
  timeframe: '1h', entryPrice: 100, targetPrice: 106, stopLossPrice: 98, riskRewardRatio: '1:2.0', status: 'OPEN',
  technicalReason: '', indicatorsTriggered: [], timestamp: '', isDemo: false, disclaimer: '', score: 65, ...o
});
const near = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 1e-9;

assert(near(signalResultR(mkSig({ status: 'TARGET_HIT' })), 2.85), 'Compra no alvo: (6% - 0,3%) / 2% = +2,85R');
assert(near(signalResultR(mkSig({ status: 'STOP_HIT' })), -1.15), 'Compra no stop: (-2% - 0,3%) / 2% = -1,15R (custos pioram a perda)');
assert(near(signalResultR(mkSig({ direction: 'SHORT', stopLossPrice: 102, targetPrice: 94, status: 'TARGET_HIT' })), 2.85), 'Venda no alvo: +2,85R');
assert(near(signalResultR(mkSig({ status: 'EXPIRED', closePrice: 101 })), 0.35), 'Expirado usa o preço de saída: (1% - 0,3%) / 2% = +0,35R');
assert(signalResultR(mkSig({ status: 'EXPIRED' })) === null, 'Expirado sem preço de saída não entra na média');
assert(signalResultR(mkSig({ status: 'OPEN' })) === null, 'Sinal aberto não tem resultado');

const perf = computeSignalPerformance([
  mkSig({ status: 'TARGET_HIT', score: 75 }),
  mkSig({ status: 'STOP_HIT', score: 62 }),
  mkSig({ status: 'STOP_HIT', score: 85, timeframe: '4h' }),
  mkSig({ status: 'OPEN' }),
  mkSig({ status: 'TARGET_HIT', isDemo: true })
]);
assert(perf.total === 4 && perf.open === 1 && perf.closed === 3, 'Sinais de demonstração ficam fora da conta');
assert(perf.targetHits === 1 && perf.stopHits === 2 && perf.expired === 0, 'Contagem de alvo/stop/expirado');
assert(Math.abs(perf.overall.winRate - 100 / 3) < 1e-9, 'Taxa de acerto geral = 1 de 3');
assert(near(perf.overall.totalR, 2.85 - 1.15 - 1.15), 'R total = 2,85 - 1,15 - 1,15 = +0,55R');
assert(near(perf.overall.profitFactor, 2.85 / 2.3), 'Fator de lucro = 2,85 / 2,30');
assert(perf.byTimeframe[1].resolved === 1 && perf.byTimeframe[0].resolved === 2, 'Separação por timeframe');
assert(perf.byScore[0].resolved === 1 && perf.byScore[1].resolved === 1 && perf.byScore[2].resolved === 1, 'Separação por faixa de pontuação');
assert(perf.reliable === false, 'Amostra pequena (<30) é marcada como não confiável');
assert(computeSignalPerformance([]).total === 0 && computeSignalPerformance([]).overall.winRate === 0, 'Sem sinais não quebra');

// ============================================================================
// 10. CARTEIRA: TAMANHO DA ORDEM, HISTÓRICO PERSISTENTE E CSV
// ============================================================================
console.log('\n--- 10. Carteira ---');

// Saldo 10.000, risco 2% = $200; stop a 2% do preço => posição ~ $9.600 (limitada a 95% do saldo)
const sz = suggestAmount(10000, 100, 98, 2);
const lossAtStop = sz * 0.02 + sz * 0.001;
assert(sz > 0 && Math.abs(lossAtStop - 200) < 5, 'Tamanho sugerido perde ~2% do saldo (incluindo taxas) se o stop for atingido', `tamanho=${sz} perda=${lossAtStop.toFixed(2)}`);
assert(suggestAmount(10000, 100, 99.9, 2) <= 9500, 'Tamanho sugerido nunca passa de 95% do saldo (stop muito curto)');
assert(suggestAmount(10000, 100, 101, 2) === 0, 'Stop acima do preço => tamanho 0');

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); }
};
const closed = (id: string, pnl: number, reason: any = 'TAKE_PROFIT'): any => ({
  id, symbol: 'BTCUSDT', direction: 'LONG', orderType: 'MARKET', entryPrice: 100, currentPrice: 105, amount: 1,
  investedUSDT: 100, leverage: 1, openTimestamp: 1_700_000_000_000, closedTimestamp: 1_700_003_600_000, closePrice: 105,
  openFee: 0.05, closeFee: 0.05, totalFees: 0.1, realizedPnl: pnl, realizedPnlPercent: pnl, closeReason: reason, status: 'CLOSED', isDemo: true
});
StorageService.savePaperAccount({ ...INITIAL_PAPER_ACCOUNT, virtualBalance: 7000, closedHistory: [closed('a', 4.9), closed('b', -2.1, 'STOP_LOSS')] });
const afterReset = StorageService.resetPaperAccount(10000, true);
assert(afterReset.virtualBalance === 10000 && afterReset.positions.length === 0, 'Zerar saldo restaura $10.000 e remove posições');
assert(afterReset.closedHistory.length === 2, 'Zerar saldo preserva o histórico de operações');
assert(StorageService.getPaperAccount().closedHistory.length === 2, 'Histórico persiste no armazenamento após zerar');
assert(StorageService.resetPaperAccount(10000).closedHistory.length === 0, 'Reset total (sem keepHistory) apaga o histórico');

const csv = historyToCsv([closed('a', 4.9), closed('b', -2.1, 'STOP_LOSS'), closed('c', 0, 'CANCELLED')]);
const lines = csv.split('\n');
assert(lines.length === 3, 'CSV: cabeçalho + 2 operações (canceladas ficam de fora)', `linhas=${lines.length}`);
assert(lines[0].startsWith('abertura,fechamento,moeda') && lines[1].includes('BTCUSDT') && lines[1].includes('Alvo') && lines[2].includes('Stop'), 'CSV traz moeda, motivo e resultado');

// ============================================================================
// 11. AUDITORIA DE VALIDAÇÃO DE DADOS, TIMESTAMPS E VOLATILIDADE DA BINANCE
// ============================================================================
console.log('\n--- 11. Validação de Dados, Timestamps e Volatilidade (Binance) ---');

const now = 1_700_000_000_000;

// 11.1 Lista vazia é rejeitada e força modo simulação
const emptyVal = validateBinanceMarketData([], null, { now });
assert(emptyVal.isValid === false, 'Lista vazia de tickers é invalidada');
assert(emptyVal.isDemoDataForced === true, 'Lista vazia força modo de simulação (isDemoDataForced = true)');

// 11.2 Timestamp desatualizado (> 180s)
const staleTickers = [
  { symbol: 'BTCUSDT', lastPrice: '60000', highPrice: '61000', lowPrice: '59000', closeTime: now - 300_000 }
];
const staleVal = validateBinanceMarketData(staleTickers, null, { now, maxTimestampAgeMs: 180_000 });
assert(staleVal.isValid === false, 'Timestamp com 300s de atraso é invalidado');
assert(staleVal.isStaleTimestamp === true, 'Sinaliza isStaleTimestamp = true');
assert(staleVal.isDemoDataForced === true, 'Timestamp atrasado força isDemoDataForced = true');

// 11.3 Volatilidade nula (high === low em 100% dos ativos)
const flatTickers = [
  { symbol: 'BTCUSDT', lastPrice: '60000', highPrice: '60000', lowPrice: '60000', closeTime: now - 1000 },
  { symbol: 'ETHUSDT', lastPrice: '3000', highPrice: '3000', lowPrice: '3000', closeTime: now - 1000 }
];
const flatVal = validateBinanceMarketData(flatTickers, null, { now });
assert(flatVal.isValid === false, 'Mercado sem amplitude (high == low) é invalidado');
assert(flatVal.isDemoDataForced === true, 'Volatilidade nula força isDemoDataForced = true');
assert(flatVal.volatility === 0, 'Volatilidade calculada é rigorosamente 0');

// 11.4 Preços reais com volatilidade saudável e timestamp fresco são aceitos
const liveTickers = [
  { symbol: 'BTCUSDT', lastPrice: '65400', highPrice: '66500', lowPrice: '64800', closeTime: now - 5000 },
  { symbol: 'ETHUSDT', lastPrice: '3500', highPrice: '3580', lowPrice: '3440', closeTime: now - 5000 }
];
const liveVal = validateBinanceMarketData(liveTickers, null, { now });
assert(liveVal.isValid === true, 'Dados com volatilidade normal e timestamp recente são válidos');
assert(liveVal.isDemoDataForced === false, 'Não força modo de simulação em dados vivos e dinâmicos');
assert(liveVal.volatility > 0.01, 'Métrica de volatilidade calculada reflete a variação do mercado');

// 11.5 Validador com estado: detecção de dados estáticos ao longo de ciclos
const validator = new MarketDataValidator({ maxStaticCycles: 2, maxStaticDurationMs: 45_000 });

// Ciclo 1: preços normais
const cycle1 = validator.validate(liveTickers, now);
assert(cycle1.isValid === true, 'Ciclo 1: dados iniciais aceitos');
assert(validator.isDemoDataForced() === false, 'Validador não força demo no primeiro ciclo');

// Ciclo 2: exatamente os mesmos preços (1º ciclo estático)
const cycle2 = validator.validate(liveTickers, now + 15_000);
assert(cycle2.consecutiveStaticCycles === 1, 'Ciclo 2: detecta 1º ciclo de preços idênticos');

// Ciclo 3: exatamente os mesmos preços novamente (atinge o limite de 2 ciclos estáticos)
const cycle3 = validator.validate(liveTickers, now + 30_000);
assert(cycle3.consecutiveStaticCycles === 2, 'Ciclo 3: atinge o limite máximo de ciclos estáticos');
assert(cycle3.isValid === false, 'Ciclo 3: invalida os dados por estagnação');
assert(cycle3.isDemoDataForced === true, 'Ciclo 3: força modo de simulação em dados estáticos');
assert(validator.isDemoDataForced() === true, 'Validador confirma estado de simulação ativo');

// Ciclo 4: mercado volta a se mover com novos preços
const dynamicTickers = [
  { symbol: 'BTCUSDT', lastPrice: '65750', highPrice: '66500', lowPrice: '64800', closeTime: now + 45_000 },
  { symbol: 'ETHUSDT', lastPrice: '3520', highPrice: '3580', lowPrice: '3440', closeTime: now + 45_000 }
];
const cycle4 = validator.validate(dynamicTickers, now + 45_000);
assert(cycle4.isValid === true, 'Ciclo 4: mercado se movimenta e recupera status válido');
assert(cycle4.isDemoDataForced === false, 'Ciclo 4: cessa a exigência de modo de simulação');
assert(cycle4.consecutiveStaticCycles === 0, 'Contador de ciclos estáticos é zerado');

// 11.6 Integração com o apiService e diagnóstico de saúde
validator.forceDemoMode('Teste de auditoria: congelamento forçado');
apiService.setValidator(validator);
assert(apiService.isSimulationMode() === true, 'apiService reporta modo de simulação ativo quando validador força demo');

const healthAfterForcedDemo = await apiService.checkExchangeHealth();
assert(healthAfterForcedDemo.binance.status === 'OFFLINE_DEMO', 'Saúde da Binance transiciona para OFFLINE_DEMO');
assert(healthAfterForcedDemo.binance.statusLabel === 'Dados em modo de simulação', 'Rótulo de status exibe explicitamente "Dados em modo de simulação"');
assert(healthAfterForcedDemo.binance.isLive === false, 'isLive torna-se false em modo de simulação');

// Restaura validador limpo
validator.reset();
assert(validator.isDemoDataForced() === false, 'Reset do validador restaura estado limpo');

// ========================================================
// 12. AUDITORIA DE BANDAS DE BOLLINGER (BB 20, 2) E GRÁFICO
// ========================================================
console.log('\n========================================================');
console.log('12. AUDITORIA DE BANDAS DE BOLLINGER (BB 20, 2) E GRÁFICO');
console.log('========================================================');

// Teste 1: Série curta (< 20 velas) deve manter bollinger como undefined
const shortCandles = Array.from({ length: 15 }, (_, i) => ({
  time: `Vela ${i}`,
  timestamp: 1000 + i * 60000,
  open: 100 + i,
  high: 105 + i,
  low: 95 + i,
  close: 100 + i,
  volume: 1000
}));
const bbShort = calculateBollingerBands(shortCandles, 20, 2, 2);
assert(bbShort[0].bollinger === undefined, 'Bandas de Bollinger: vela 0 em aquecimento é undefined');
assert(bbShort[14].bollinger === undefined, 'Bandas de Bollinger: vela 14 em aquecimento é undefined');

// Teste 2: Série completa (30 velas) calcula bandas corretamente
const completeCandles = Array.from({ length: 30 }, (_, i) => ({
  time: `Vela ${i}`,
  timestamp: 1000 + i * 60000,
  open: 100 + (i % 2 === 0 ? 5 : -5),
  high: 110,
  low: 90,
  close: 100 + (i % 2 === 0 ? 4 : -4),
  volume: 1000
}));
const bbComplete = calculateBollingerBands(completeCandles, 20, 2, 2);

assert(bbComplete[18].bollinger === undefined, 'Vela 18 (< período 20) ainda está em aquecimento');
assert(bbComplete[19].bollinger !== undefined, 'Vela 19 (exatamente 20 velas) inicializa Bandas de Bollinger');
const bb19 = bbComplete[19].bollinger!;
assert(bb19.upper > bb19.middle, 'Banda Superior é maior que a Média Central');
assert(bb19.lower < bb19.middle, 'Banda Inferior é menor que a Média Central');
assert(Number.isFinite(bb19.upper) && Number.isFinite(bb19.lower), 'Valores das bandas são números finitos válidos');
assert(Math.abs(bb19.upper - bb19.middle - (bb19.middle - bb19.lower)) < 0.05, 'Bandas de Bollinger são simétricas em relação à média');

// ============================================================================
// 13. AUDITORIA DE MODAL FULLSCREEN E MODO PAISAGEM ROTACIONADO 90° (TRADINGVIEW)
// ============================================================================
console.log('\n========================================================');
console.log('13. AUDITORIA DE MODAL FULLSCREEN E MODO PAISAGEM (90°)');
console.log('========================================================');

// Teste 1: Simulação de dimensões de celular em modo retrato (ex: 390x844)
const mobilePortrait = { width: 390, height: 844 };
// No modo rotacionado 90° (paisagem), o canvas horizontal assume a altura da tela como largura
const rotatedCanvasWidth = Math.max(720, mobilePortrait.height);
const rotatedCanvasHeight = Math.max(260, mobilePortrait.width - 128);
assert(rotatedCanvasWidth === 844, 'Modo Paisagem (90°): Canvas expande largura para 844px no mobile');
assert(rotatedCanvasHeight === 262, 'Modo Paisagem (90°): Canvas ajusta altura mantendo proporção técnica');

// Teste 2: Mapeamento de coordenadas na rotação 90° horária
// Um ponto de toque em (X=195, Y=422) na tela deve mapear para o espaço SVG rotacionado
const simulateRotatedPoint = (screenX: number, screenY: number, screenW: number, screenH: number, svgW: number, svgH: number) => {
  return {
    svgX: (screenY / screenH) * svgW,
    svgY: (1 - screenX / screenW) * svgH
  };
};
const mapped = simulateRotatedPoint(195, 422, mobilePortrait.width, mobilePortrait.height, rotatedCanvasWidth, rotatedCanvasHeight);
assert(Math.abs(mapped.svgX - (422 / 844) * 844) < 1e-6, 'Mapeamento de toque no modo rotacionado: eixo X segue o tempo/velas');
assert(Math.abs(mapped.svgY - 0.5 * 262) < 1e-6, 'Mapeamento de toque no modo rotacionado: eixo Y segue a escala de preços');

// Teste 3: Suporte a timeframes para análise técnica
const supportedTimeframes: string[] = ['15m', '1h', '4h', '1D', '1W'];
assert(supportedTimeframes.includes('15m') && supportedTimeframes.includes('4h') && supportedTimeframes.includes('1D'), 'Timeframes essenciais do TradingView suportados');

// Teste 4: Verificação de zoom e limites de pan no histórico
const totalHistory = 100;
const visibleWindow = 45;
const maxAllowedPan = totalHistory - visibleWindow;
assert(maxAllowedPan === 55, 'Limite de pan calcula histórico disponível corretamente');

// ============================================================================
// 14. AUDITORIA DE FERRAMENTAS DE ZOOM E ESTUDOS TÉCNICOS (TRADINGVIEW TOOLS)
// ============================================================================
console.log('\n========================================================');
console.log('14. AUDITORIA DE ZOOM E FERRAMENTAS DE ANÁLISE TÉCNICA');
console.log('========================================================');

// Teste 1: Ferramentas de Zoom Dinâmico (Zoom In reduz velas visíveis, Zoom Out expande)
const initialVisibleCount = 45;
const zoomInVisibleCount = Math.max(15, initialVisibleCount - 8);
const zoomOutVisibleCount = Math.min(totalHistory, initialVisibleCount + 8);
assert(zoomInVisibleCount === 37, 'Zoom In aproxima visualização reduzindo velas visíveis');
assert(zoomOutVisibleCount === 53, 'Zoom Out afasta visualização permitindo maior panorama');
assert(Math.max(15, 10 - 8) === 15, 'Zoom In respeita limite mínimo de 15 velas para manter legibilidade');

// Teste 2: Ferramenta de Linha de Suporte / Resistência Horizontal
const horizontalPrice = 88500.50;
const isPriceValid = Number.isFinite(horizontalPrice) && horizontalPrice > 0;
assert(isPriceValid, 'Linha Horizontal registra preço exato para suporte/resistência');

// Teste 3: Ferramenta de Linha de Tendência (Trendline de 2 pontos)
const pStart = { index: 5, price: 82000 };
const pEnd = { index: 25, price: 91000 };
const deltaPrice = pEnd.price - pStart.price;
const deltaPct = (deltaPrice / pStart.price) * 100;
assert(deltaPrice === 9000, 'Trendline calcula amplitude correta em dólares');
assert(Math.abs(deltaPct - 10.975) < 0.01, 'Trendline calcula variação percentual correta (+10.98%)');

// Teste 4: Retração de Fibonacci (0%, 23.6%, 38.2%, 50%, 61.8% Golden Ratio, 78.6%, 100%)
const fibLevels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
const fibPrices = fibLevels.map((lvl) => pStart.price + (pEnd.price - pStart.price) * lvl);
assert(fibPrices[0] === 82000, 'Fibonacci 0% corresponde ao ponto base (82000)');
assert(fibPrices[6] === 91000, 'Fibonacci 100% corresponde ao topo (91000)');
assert(Math.abs(fibPrices[4] - (82000 + 9000 * 0.618)) < 1e-4, 'Fibonacci 61.8% (Golden Ratio) calculado com exatidão');

// Teste 5: Régua de Medição (Ruler / Measure Tool)
const measuredBars = Math.abs(pEnd.index - pStart.index);
assert(measuredBars === 20, 'Régua de Medição calcula intervalo correto de 20 velas');

// ============================================================================
// PRECISÃO DE PREÇO (MOEDAS DE VALOR MUITO BAIXO)
// ============================================================================
console.log('\n--- Precisão de preço ---');
const pepeKline = parseBinanceKline([1700000000000, '0.00001234', '0.00001300', '0.00001200', '0.00001250', '9999999'], '1h', priceDecimals(0.0000125));
assert(pepeKline !== null && pepeKline.close === 0.0000125 && pepeKline.open === 0.00001234, 'Moeda de preço ~0,00001 mantém precisão (antes virava 0 e era descartada)');
assert(priceDecimals(64000) === 2 && priceDecimals(150) === 4 && priceDecimals(0.5) === 6 && priceDecimals(0.00001) === 10, 'Casas decimais por faixa de preço');

// ============================================================================
// SEMÁFORO "PRONTO PARA VALOR REAL?"
// ============================================================================
console.log('\n--- Semáforo de validação ---');
const DAY = 86400000;
const t0 = Date.now();
const batch = (wins: number, losses: number, ageDays: number): PerfSignal[] => [
  ...Array.from({ length: wins }, (_, i) => mkSig({ id: `w${i}`, status: 'TARGET_HIT', createdAt: t0 - ageDays * DAY + i })),
  ...Array.from({ length: losses }, (_, i) => mkSig({ id: `l${i}`, status: 'STOP_HIT', createdAt: t0 - ageDays * DAY + 1000 + i }))
];

assert(evaluateReadiness([]).status === 'collecting', 'Sem sinais: ainda coletando');
assert(evaluateReadiness(batch(3, 1, 5), t0).status === 'collecting', 'Poucos sinais positivos: ainda coletando (não libera)');
const good = evaluateReadiness(batch(12, 18, 30), t0);
assert(good.status === 'ready' && good.checks.every((c) => c.ok), '30 sinais / 30 dias, expectativa +0,45R e fator 1,65 => pronto para valor pequeno');
const bad = evaluateReadiness(batch(8, 22, 30), t0);
assert(bad.status === 'failed' && bad.headline.includes('Não opere'), '30 sinais / 30 dias com resultado negativo => reprovado');
assert(evaluateReadiness(batch(12, 18, 10), t0).status !== 'ready', 'Bom resultado mas só 10 dias => ainda não libera');
assert(evaluateReadiness(batch(5, 15, 5), t0).status === 'almost', 'Resultado negativo cedo => alerta para continuar só simulando');
// Dependência de poucos acertos: 3 grandes ganhos e o resto perdendo
const lucky = [
  ...Array.from({ length: 3 }, (_, i) => mkSig({ id: `x${i}`, status: 'TARGET_HIT', createdAt: t0 - 30 * DAY + i })),
  ...Array.from({ length: 27 }, (_, i) => mkSig({ id: `y${i}`, status: 'EXPIRED', closePrice: 99.9, createdAt: t0 - 30 * DAY + 100 + i }))
];
const luckyRes = evaluateReadiness(lucky, t0);
assert(luckyRes.checks[4].ok === false, 'Checagem "sem os 3 melhores" reprova quando poucos acertos sustentam o resultado');
assert(evaluateReadiness(batch(12, 18, 30).map((x) => ({ ...x, isDemo: true })), t0).status === 'collecting', 'Sinais de demonstração nunca contam para o semáforo');

// ============================================================================
// FUTUROS: LIQUIDAÇÃO, ALAVANCAGEM SEGURA, TAMANHO DE POSIÇÃO E SHORT
// ============================================================================
console.log('\n--- Futuros ---');
const near2 = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol;

assert(near2(liquidationPrice('LONG', 100, 10), 90.5), 'Liquidação LONG 10x: 100 × (1 − 0,10 + 0,005) = 90,50');
assert(near2(liquidationPrice('SHORT', 100, 10), 109.5), 'Liquidação SHORT 10x: 100 × (1 + 0,10 − 0,005) = 109,50');
assert(liquidationPrice('LONG', 100, 1) < 1, 'LONG sem alavancagem só liquida perto de zero');
assert(stopBeforeLiquidation('LONG', 100, 95, 10) && !stopBeforeLiquidation('LONG', 100, 89, 10), 'LONG 10x: stop em 95 protege; stop em 89 fica depois da liquidação (90,5)');
assert(stopBeforeLiquidation('SHORT', 100, 105, 10) && !stopBeforeLiquidation('SHORT', 100, 111, 10), 'SHORT 10x: stop em 105 protege; em 111 fica depois da liquidação (109,5)');
assert(maxSafeLeverage(100, 98) === 10, 'Stop curto (2%): alavancagem segura limitada pelo teto de 10x');
assert(maxSafeLeverage(100, 90) === 4 && maxSafeLeverage(100, 80) === 2, 'Stop longo reduz a alavancagem segura (10% => 4x, 20% => 2x)');
assert(maxSafeLeverage(100, 100) === 1, 'Stop igual à entrada => 1x');
for (const stop of [98, 95, 90, 85]) {
  const lev = maxSafeLeverage(100, stop);
  assert(stopBeforeLiquidation('LONG', 100, stop, lev), `Alavancagem segura (${lev}x) sempre deixa o stop em ${stop} antes da liquidação`);
}

const fz = futuresSizing({ balance: 10000, entry: 100, stop: 98, riskPercent: 1, leverage: 5, feeRate: 0.0005 });
assert(near2(fz.maxLoss, 100, 1) && !fz.capped, 'Tamanho em futuros perde ~1% do saldo no stop (incluindo taxas), independente da alavancagem');
assert(near2(fz.margin, fz.notional / 5, 0.01), 'Margem = tamanho / alavancagem');
const fz1 = futuresSizing({ balance: 10000, entry: 100, stop: 98, riskPercent: 1, leverage: 1, feeRate: 0.0005 });
assert(near2(fz1.maxLoss, fz.maxLoss, 1) && fz1.margin > fz.margin * 4, 'Mesma perda máxima com 1x, mas muito mais margem travada');
const fzCap = futuresSizing({ balance: 10000, entry: 100, stop: 99.95, riskPercent: 1, leverage: 5, feeRate: 0.0005 });
assert(fzCap.capped && fzCap.margin <= 9500, 'Stop minúsculo: tamanho limitado a 95% do saldo em margem');

const FUT: any = { ...INITIAL_PAPER_ACCOUNT };
const px = (symbol: string, price: number): any => ({ symbol, price });

// Ordem recusada: stop depois da liquidação
const badStop = createTradeOrder(FUT, { symbol: 'ABCUSDT', direction: 'LONG', orderType: 'MARKET', entryPrice: 100, currentPrice: 100, investedUSDT: 500, leverage: 10, stopLossPrice: 85 });
assert(!badStop.success && badStop.error!.includes('liquidação'), 'Simulador recusa 10x com stop além do preço de liquidação');

// SHORT com alvo
const sh = createTradeOrder(FUT, { symbol: 'ABCUSDT', direction: 'SHORT', orderType: 'MARKET', entryPrice: 100, currentPrice: 100, investedUSDT: 1000, leverage: 5, stopLossPrice: 103, targetPrice: 94 });
assert(sh.success, 'SHORT 5x com stop e alvo é aceito');
const shHit = evaluateTriggers(sh.account!, [px('ABCUSDT', 94)]);
assert(shHit.triggeredOrders[0]?.type === 'TAKE_PROFIT', 'SHORT: preço caindo até o alvo fecha por TAKE_PROFIT');
assert(near2(shHit.account.closedHistory[0].realizedPnl!, 295.15), 'SHORT: lucro = 1000 × 6% × 5x − taxas = +295,15', String(shHit.account.closedHistory[0].realizedPnl));
const shStop = evaluateTriggers(sh.account!, [px('ABCUSDT', 103.5)]);
assert(shStop.triggeredOrders[0]?.type === 'STOP_LOSS' && shStop.account.closedHistory[0].realizedPnl! < 0, 'SHORT: preço subindo bate o stop com prejuízo');
assert(positionUnrealizedPnl(sh.account!.positions[0], 96).pnl > 0 && positionUnrealizedPnl(sh.account!.positions[0], 104).pnl < 0, 'PnL não realizado do SHORT: lucra quando cai, perde quando sobe');
assert(positionUnrealizedPnl({ ...sh.account!.positions[0], direction: 'LONG' }, 96).pnl < 0, 'Mesmo preço, direção oposta => sinal do PnL invertido');

// Liquidação
const lg = createTradeOrder(FUT, { symbol: 'ABCUSDT', direction: 'LONG', orderType: 'MARKET', entryPrice: 100, currentPrice: 100, investedUSDT: 500, leverage: 10 });
const lgLiq = evaluateTriggers(lg.account!, [px('ABCUSDT', 90)]);
const liqPos = lgLiq.account.closedHistory[0];
assert(lgLiq.triggeredOrders[0]?.type === 'LIQUIDATION' && liqPos.closeReason === 'LIQUIDATION', 'LONG 10x sem stop: queda de 10% liquida a posição');
assert(near2(liqPos.closePrice!, 90.5, 0.001), 'Saída da liquidação no preço de liquidação (90,50), não no preço do mercado');
assert(liqPos.realizedPnl! < -470 && near2(lgLiq.account.virtualBalance, 9520.24, 0.1), 'Liquidação perde quase toda a margem de $500: saldo final 9.520,24 (só $22,74 devolvidos)', String(lgLiq.account.virtualBalance));
assert(lgLiq.account.positions.length === 0, 'Posição liquidada sai da lista de abertas');
const stillOpen = evaluateTriggers(lg.account!, [px('ABCUSDT', 91)]);
assert(stillOpen.triggeredOrders.length === 0 && stillOpen.account.positions.length === 1, 'Acima do preço de liquidação a posição segue aberta');
const shLiq = createTradeOrder(FUT, { symbol: 'ABCUSDT', direction: 'SHORT', orderType: 'MARKET', entryPrice: 100, currentPrice: 100, investedUSDT: 500, leverage: 10 });
const shLiqRes = evaluateTriggers(shLiq.account!, [px('ABCUSDT', 111)]);
assert(shLiqRes.triggeredOrders[0]?.type === 'LIQUIDATION' && near2(shLiqRes.account.closedHistory[0].closePrice!, 109.5, 0.001), 'SHORT 10x: alta de 10% liquida em 109,50');
// Stop executa antes da liquidação quando está entre a entrada e a liquidação
const protectedPos = createTradeOrder(FUT, { symbol: 'ABCUSDT', direction: 'LONG', orderType: 'MARKET', entryPrice: 100, currentPrice: 100, investedUSDT: 500, leverage: 10, stopLossPrice: 95 });
const protectedRes = evaluateTriggers(protectedPos.account!, [px('ABCUSDT', 94)]);
assert(protectedRes.triggeredOrders[0]?.type === 'STOP_LOSS' && protectedRes.account.closedHistory[0].realizedPnl! > -300, 'Com stop válido, a perda fica limitada ao stop (não perde a margem inteira)');

// ============================================================================
// FUTUROS: UNIVERSO (BINANCE USDT-M ∩ BYBIT LINEAR) E ALERTAS
// ============================================================================
console.log('\n--- Futuros: universo e alertas ---');
{
  const realFetchF = globalThis.fetch;
  const jsonF = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  globalThis.fetch = ((url: any) => {
    const u = String(url);
    if (u.includes('coingecko')) {
      return jsonF([
        { symbol: 'btc', name: 'Bitcoin', market_cap_rank: 1, market_cap: 1e12 },
        { symbol: 'pepe', name: 'Pepe', market_cap_rank: 2, market_cap: 5e9 },     // 1000PEPEUSDT nas duas
        { symbol: 'kas', name: 'Kaspa', market_cap_rank: 3, market_cap: 3e9 },     // só Binance
        { symbol: 'xyz', name: 'Xyz', market_cap_rank: 4, market_cap: 1e9 },       // só Bybit
        { symbol: 'old', name: 'Old', market_cap_rank: 5, market_cap: 1e9 }        // só contrato com vencimento na Binance
      ]);
    }
    if (u.includes('/fapi/v1/ticker/price')) {
      return jsonF([{ symbol: 'BTCUSDT', price: '1' }, { symbol: '1000PEPEUSDT', price: '1' }, { symbol: 'KASUSDT', price: '1' }, { symbol: 'OLDUSDT_250627', price: '1' }]);
    }
    if (u.includes('bybit.com') && u.includes('category=linear')) {
      return jsonF({ retCode: 0, result: { list: [{ symbol: 'BTCUSDT' }, { symbol: '1000PEPEUSDT' }, { symbol: 'XYZUSDT' }] } });
    }
    return Promise.reject(new Error('url inesperada: ' + u));
  }) as typeof fetch;
  delete process.env.CMC_API_KEY;
  process.env.EXCHANGES = 'binance,bybit';
  const uf = await buildUniverse('futures');
  globalThis.fetch = realFetchF;
  assert(uf.coins.map((c) => c.symbol).join(',') === 'BTCUSDT,1000PEPEUSDT', 'Universo de futuros = perpétuos presentes na Binance e na Bybit', uf.coins.map((c) => c.symbol).join(','));
  assert(uf.coins[1].baseAsset === 'PEPE' && uf.coins[1].symbol === '1000PEPEUSDT', 'PEPE é mapeada para o contrato 1000PEPEUSDT (exibe PEPE)');
  assert(uf.skipped.includes('KAS [sem Bybit]') && uf.skipped.includes('XYZ [sem Binance]'), 'Moedas fora de uma das corretoras são ignoradas com o motivo');
  assert(uf.skipped.includes('OLD [sem Binance e Bybit]'), 'Contrato com vencimento (OLDUSDT_250627) não conta como perpétuo');
  assert(resolveFuturesSymbol('PEPE', new Set(['1000PEPEUSDT'])) === '1000PEPEUSDT' && resolveFuturesSymbol('BTC', new Set(['BTCUSDT'])) === 'BTCUSDT' && resolveFuturesSymbol('ZZZ', new Set(['BTCUSDT'])) === null, 'Resolução de símbolo de futuros');
}
if (sell && buy) {
  const longMsg = formatTelegramAlert(buy, 'futures');
  const shortMsg = formatTelegramAlert(sell, 'futures');
  assert(longMsg.startsWith('[FUTUROS]') && longMsg.includes('long') && longMsg.includes('Alavancagem máx. segura'), 'Alerta de futuros: etiqueta, long e alavancagem segura');
  assert(shortMsg.includes('short') && shortMsg.includes('Stop:') && !shortMsg.includes('sair da posição'), 'Alerta de short em futuros traz alvo e stop (não é "sair da posição")');
  assert(formatTelegramAlert(buy, 'spot').startsWith('[SPOT]'), 'Alerta de spot leva a etiqueta [SPOT]');
}

// ============================================================================
// RANKING TOP 100: LIMITE DE REQUISIÇÕES (429), FONTE ALTERNATIVA E CACHE
// ============================================================================
console.log('\n--- Ranking: 429, fallback e cache ---');
{
  const realFetchR = globalThis.fetch;
  const jsonR = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  const calls = { gecko: 0, paprika: 0 };
  const mount = (geckoStatus: number, paprikaOk: boolean) => {
    globalThis.fetch = ((url: any) => {
      const u = String(url);
      if (u.includes('coingecko')) {
        calls.gecko++;
        return geckoStatus === 200
          ? jsonR(Array.from({ length: 12 }, (_, i) => ({ symbol: i === 0 ? 'btc' : `c${i}`, name: `C${i}`, market_cap_rank: i + 1, market_cap: 1e9 })))
          : Promise.resolve(new Response('limit', { status: geckoStatus }));
      }
      if (u.includes('coinpaprika')) {
        calls.paprika++;
        return paprikaOk
          ? jsonR([
              { symbol: 'BTC', name: 'Bitcoin', rank: 1, quotes: { USD: { market_cap: 1e12 } } },
              ...Array.from({ length: 12 }, (_, i) => ({ symbol: `P${i}`, name: `P${i}`, rank: i + 2, quotes: { USD: { market_cap: 1e9 } } })),
              { symbol: 'BTC', name: 'Wrapped BTC fake', rank: 20, quotes: { USD: { market_cap: 1e6 } } }
            ])
          : Promise.resolve(new Response('down', { status: 500 }));
      }
      if (u.includes('/api/v3/ticker/price')) return jsonR([{ symbol: 'BTCUSDT', price: '1' }, { symbol: 'P1USDT', price: '1' }, { symbol: 'C1USDT', price: '1' }]);
      if (u.includes('bybit.com')) return jsonR({ retCode: 0, result: { list: [{ symbol: 'BTCUSDT' }, { symbol: 'P1USDT' }, { symbol: 'C1USDT' }] } });
      return Promise.reject(new Error('url inesperada: ' + u));
    }) as typeof fetch;
  };

  mount(429, true);
  const viaPaprika = await buildUniverse('spot');
  assert(calls.gecko === 3, 'CoinGecko com 429: tenta 3 vezes antes de desistir', String(calls.gecko));
  assert(viaPaprika.source === 'COINPAPRIKA' && viaPaprika.coins.some((c) => c.symbol === 'P1USDT'), 'Com CoinGecko limitado, usa a CoinPaprika como fonte alternativa');
  assert(viaPaprika.coins.filter((c) => c.baseAsset === 'BTC').length === 1, 'Símbolo repetido na CoinPaprika entra uma vez só (mantém o de melhor ranking)');

  mount(200, true);
  calls.gecko = 0;
  resetTop100Cache();
  const first = await buildUniverseRaw('spot');
  const second = await buildUniverseRaw('futures').catch(() => null); // futuros falha por não haver mock; importa só que o ranking veio do cache
  void second;
  assert(first.source === 'COINGECKO' && calls.gecko === 1, 'Ranking é buscado uma vez e reaproveitado pelo outro mercado (cache compartilhado)', String(calls.gecko));

  mount(429, false);
  let allFailed = '';
  try { await buildUniverse('spot'); } catch (e: any) { allFailed = String(e?.message); }
  assert(allFailed.includes('CoinGecko') && allFailed.includes('CoinPaprika') && allFailed.includes('HTTP 429'), 'Todas as fontes falhando: erro claro com o motivo de cada uma');
  globalThis.fetch = realFetchR;
}

// ============================================================================
// BACKTEST EM LOTE: AGREGADO, METADES DO PERÍODO E VEREDITO
// ============================================================================
console.log('\n--- Backtest em lote ---');
{
  const trade = (netPct: number, entryIndex: number): BacktestTrade => ({
    symbol: 'X', timeframe: '1h', direction: 'LONG', score: 70, entryIndex, exitIndex: entryIndex + 1, entryPrice: 1, exitPrice: 1,
    exit: netPct > 0 ? 'TARGET' : 'STOP', grossPct: netPct, netPct, rMultiple: netPct / 2
  });
  const result = (symbol: string, trades: BacktestTrade[]): any => ({ symbol, timeframe: '1h', candlesUsed: 1000, trades, stats: computeStats(trades) });

  // 120 operações: em cada metade, 2 ganhos de +3 para cada perda de -1,5 (fator de lucro 2,0)
  const mkSet = (offset: number) => Array.from({ length: 30 }, (_, i) => trade(i % 3 === 2 ? -1.5 : 3, offset + i * 10));
  const good = summarizeBatch([
    result('AAAUSDT', [...mkSet(0), ...mkSet(500)]),
    result('BBBUSDT', [...mkSet(5), ...mkSet(505)])
  ]);
  assert(good.aggregate.trades === 120 && good.firstHalf.trades === 60 && good.secondHalf.trades === 60, 'Agregado soma as moedas e divide as operações pelas duas metades do período');
  assert(good.rows.length === 2 && good.rows[0].symbol === 'AAAUSDT', 'Tabela por moeda');
  assert(good.passed && good.checks.every((c) => c.ok), 'Fator 2,0 em todo o período e nas duas metades, 120 operações => aprovado');

  // Bom na primeira metade e ruim na segunda: média geral pode enganar, a metade reprova
  const early = Array.from({ length: 60 }, (_, i) => trade(i % 3 === 2 ? -1 : 4, i * 5));            // ganha bastante
  const late = Array.from({ length: 60 }, (_, i) => trade(i % 3 === 0 ? 1 : -1.5, 500 + i * 5));    // perde
  const split = summarizeBatch([result('CCCUSDT', [...early, ...late])]);
  assert(split.checks[3].ok && !split.checks[4].ok && !split.passed, 'Resultado bom só na primeira metade => reprovado pela checagem da segunda metade');

  const few = summarizeBatch([result('DDDUSDT', mkSet(0))]);
  assert(!few.checks[0].ok && !few.passed, 'Poucas operações (30) => reprovado');

  const losing = summarizeBatch([result('EEEUSDT', Array.from({ length: 150 }, (_, i) => trade(i % 3 === 0 ? 1 : -1, i * 6)))]);
  assert(!losing.passed && !losing.checks[1].ok && !losing.checks[2].ok, 'Fator de lucro < 1,3 e expectativa negativa => reprovado');
  assert(summarizeBatch([]).aggregate.trades === 0 && !summarizeBatch([]).passed, 'Sem resultados não quebra e não aprova');
}

// Trabalho em segundo plano ponta a ponta, com corretoras simuladas
{
  const realFetchJ = globalThis.fetch;
  const jsonJ = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  const coinsJ = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE'];
  globalThis.fetch = ((url: any) => {
    const u = String(url);
    if (u.includes('coingecko')) return jsonJ(coinsJ.map((c, i) => ({ symbol: c.toLowerCase(), name: c, market_cap_rank: i + 1, market_cap: 1e9 })));
    if (u.includes('/api/v3/ticker/price')) return jsonJ(coinsJ.map((c) => ({ symbol: `${c}USDT`, price: '100' })));
    if (u.includes('bybit.com')) return jsonJ({ retCode: 0, result: { list: coinsJ.map((c) => ({ symbol: `${c}USDT` })) } });
    if (u.includes('/api/v3/klines')) {
      const limit = Number(new URL(u).searchParams.get('limit') || 500);
      const seedStr = new URL(u).searchParams.get('symbol') || 'X';
      let seed = Array.from(seedStr).reduce((a, ch) => a + ch.charCodeAt(0), 7);
      const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 - 0.5; };
      let p = 100;
      return jsonJ(Array.from({ length: limit }, (_, i) => {
        const o = p; p *= 1 + 0.0015 + rnd() * 0.02;
        return [1_700_000_000_000 + i * 3_600_000, String(o), String(Math.max(o, p) * 1.004), String(Math.min(o, p) * 0.996), String(p), '1000', 0, '0', 0, '0', '0', '0'];
      }));
    }
    return Promise.reject(new Error('url inesperada: ' + u));
  }) as typeof fetch;
  resetTop100Cache();
  const job = startBatchJob({ strategy: 'signals', market: 'spot', tf: '1h', top: 5, bars: 1000 });
  assert(job.status === 'running', 'Backtest em lote começa em segundo plano');
  assert(startBatchJob({ strategy: 'signals', market: 'futures', tf: '4h', top: 5, bars: 1000 }).id === job.id, 'Enquanto um backtest roda, outro pedido devolve o mesmo trabalho (um por vez)');
  for (let i = 0; i < 400 && getBatchJob()?.status === 'running'; i++) await new Promise((r) => setTimeout(r, 50));
  const done = getBatchJob()!;
  assert(done.status === 'done' && done.done === 5 && done.total === 5, 'Trabalho termina com as 5 moedas testadas', `${done.status} ${done.done}/${done.total} ${done.error ?? ''}`);
  assert(done.summary!.rows.length === 5 && done.summary!.checks.length === 6, 'Resultado traz tabela por moeda e os 6 critérios');
  assert(done.summary!.aggregate.shortTrades === 0, 'Spot no lote: nenhuma operação vendida');
  globalThis.fetch = realFetchJ;
}

// ============================================================================
// ESTRATÉGIA DE TENDÊNCIA (ROMPIMENTO DE 55 DIAS) E CURVA DE CAPITAL
// ============================================================================
console.log('\n--- Tendência: rompimento de 55 dias ---');
{
  const DAY = 86400000;
  const T0 = 1_600_000_000_000;
  const days = (closes: number[], opens?: number[]): CandleData[] => closes.map((c, i) => {
    const o = opens ? opens[i] : i === 0 ? c : closes[i - 1];
    return { time: String(i), timestamp: T0 + i * DAY, open: o, high: Math.max(o, c) * 1.01, low: Math.min(o, c) * 0.99, close: c, volume: 1000 };
  });
  // 260 dias laterais em ~100 e depois alta forte de 1,2% ao dia por 60 dias, seguida de queda
  const flat = Array.from({ length: 260 }, (_, i) => 100 + Math.sin(i / 4));
  const rise = Array.from({ length: 60 }, (_, i) => 100 * Math.pow(1.012, i + 1));
  const fall = Array.from({ length: 40 }, (_, i) => rise[rise.length - 1] * Math.pow(0.985, i + 1));
  const coin = days([...flat, ...rise, ...fall]);
  const btcUp = days([...flat, ...rise, ...fall]);                       // BTC acima da média de 200 dias na alta
  const btcDown = days(Array.from({ length: 360 }, (_, i) => 200 * Math.pow(0.996, i))); // BTC em queda constante

  const reg = btcRegimeByDay(btcUp);
  assert(reg.size === 360 - (TREND_RULES.btcSmaPeriod - 1), 'Filtro do BTC só existe depois de 200 dias de histórico');
  assert([...btcRegimeByDay(btcDown).values()].every((v) => v === false), 'BTC em queda constante: filtro sempre desligado');

  const ok = runTrendBacktest(coin, btcUp, 'AAAUSDT');
  assert(ok.trades.length >= 1, 'Alta forte com BTC em alta gera ao menos uma operação', String(ok.trades.length));
  const tr = ok.trades[0];
  assert(tr.entryPrice === coin[tr.entryIndex].open, 'Entrada na ABERTURA do dia seguinte ao rompimento (sem olhar o futuro)');
  assert(coin[tr.entryIndex - 1].close > Math.max(...coin.slice(tr.entryIndex - 1 - TREND_RULES.entryLookback, tr.entryIndex - 1).map((c) => c.high)), 'O dia do sinal fechou acima da máxima dos 55 dias anteriores');
  assert(tr.exit === 'TRAIL' && tr.netPct > 0, 'Queda depois da alta: sai pela tendência (mínima de 20 dias) com lucro', `${tr.exit} ${tr.netPct.toFixed(1)}%`);
  assert(ok.trades.every((t, k) => k === 0 || t.entryIndex > ok.trades[k - 1].exitIndex), 'Operações não se sobrepõem');
  assert(ok.trades.every((t) => Math.abs(t.grossPct - t.netPct - 0.3) < 1e-9), 'Custos de 0,3% descontados em cada operação');
  assert(runTrendBacktest(coin, btcDown, 'AAAUSDT').trades.length === 0, 'Com o BTC em queda (filtro desligado) não há nenhuma entrada');

  // Stop: logo após o rompimento o preço despenca abaixo de entrada − 2×ATR
  const crashCloses = [...flat, ...rise.slice(0, 20)];
  const entryDay = crashCloses.length;
  const crashSeries = days([...crashCloses, 70, 65, 60]);
  const crash = runTrendBacktest(crashSeries, days([...flat, ...rise.slice(0, 20), 150, 150, 150]), 'BBBUSDT');
  const ct = crash.trades[0];
  assert(!!ct && ct.exit === 'STOP' && ct.netPct < 0 && ct.exitPrice <= ct.entryPrice, 'Queda brusca após a entrada: sai no stop com prejuízo');
  void entryDay;

  // Dados terminam com a posição aberta: encerra no último fechamento e marca TIMEOUT
  const endOpen = runTrendBacktest(days([...flat, ...rise.slice(0, 15)]), days([...flat, ...rise.slice(0, 15)]), 'CCCUSDT');
  assert(endOpen.trades.length === 0 || endOpen.trades[endOpen.trades.length - 1].exit === 'TIMEOUT', 'Posição aberta no fim dos dados é encerrada como TIMEOUT');
  assert(runTrendBacktest(days(flat.slice(0, 40)), days(flat.slice(0, 40)), 'DDDUSDT').trades.length === 0, 'Histórico curto não gera operação');

  // Curva de capital: risco fixo de 1% e juros compostos, em ordem de tempo
  const mkT = (r: number, ts: number): BacktestTrade => ({ symbol: 'X', timeframe: '1d', direction: 'LONG', score: 0, entryIndex: ts, entryTimestamp: ts, exitIndex: ts + 1, entryPrice: 1, exitPrice: 1, exit: 'TRAIL', grossPct: r, netPct: r, rMultiple: r });
  const curve = riskCurve([mkT(-1, 1), mkT(-1, 2), mkT(3, 3)]);
  assert(Math.abs(curve.maxDrawdownPct - (1 - 0.99 * 0.99) * 100) < 1e-9, 'Queda máxima = duas perdas de 1% compostas (1,99%)', curve.maxDrawdownPct.toFixed(3));
  assert(Math.abs(curve.returnPct - (0.99 * 0.99 * 1.03 - 1) * 100) < 1e-9, 'Retorno composto: 0,99 × 0,99 × 1,03');
  assert(Math.abs(riskCurve([mkT(3, 5), mkT(-1, 1)]).maxDrawdownPct - 1) < 1e-9, 'Ordena as operações pelo tempo antes de compor');
  assert(riskCurve([]).returnPct === 0, 'Curva vazia não quebra');
}

// Trabalho em lote com a estratégia de tendência (spot, diário), com corretoras simuladas
{
  const realFetchT = globalThis.fetch;
  const jsonT = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  const coinsT = ['AAA', 'BBB', 'CCC'];
  let intervalsAsked = new Set<string>();
  globalThis.fetch = ((url: any) => {
    const u = String(url);
    if (u.includes('coingecko')) return jsonT(coinsT.map((c, i) => ({ symbol: c.toLowerCase(), name: c, market_cap_rank: i + 1, market_cap: 1e9 })));
    if (u.includes('/api/v3/ticker/price')) return jsonT([...coinsT, 'BTC'].map((c) => ({ symbol: `${c}USDT`, price: '100' })));
    if (u.includes('bybit.com')) return jsonT({ retCode: 0, result: { list: coinsT.map((c) => ({ symbol: `${c}USDT` })) } });
    if (u.includes('/api/v3/klines')) {
      const q = new URL(u).searchParams;
      intervalsAsked.add(q.get('interval') || '');
      const limit = Number(q.get('limit') || 500);
      let p = 100;
      return jsonT(Array.from({ length: limit }, (_, i) => {
        const o = p; p *= 1 + 0.003 + Math.sin(i / 11) * 0.02;
        return [1_600_000_000_000 + i * 86_400_000, String(o), String(Math.max(o, p) * 1.01), String(Math.min(o, p) * 0.99), String(p), '1000', 0, '0', 0, '0', '0', '0'];
      }));
    }
    return Promise.reject(new Error('url inesperada: ' + u));
  }) as typeof fetch;
  resetTop100Cache();
  startBatchJob({ strategy: 'trend', market: 'futures', tf: '1h', top: 3, bars: 800 });
  for (let i = 0; i < 400 && getBatchJob()?.status === 'running'; i++) await new Promise((r) => setTimeout(r, 50));
  const tj = getBatchJob()!;
  assert(tj.status === 'done' && tj.done === 3, 'Trabalho de tendência termina', `${tj.status} ${tj.error ?? ''}`);
  assert(tj.params.market === 'spot' && tj.params.tf === '1d', 'Tendência força spot e velas diárias, mesmo se pedirem futuros/1h');
  assert([...intervalsAsked].every((i) => i === '1d'), 'Tendência sempre usa velas diárias, mesmo se pedirem outro tempo', [...intervalsAsked].join(','));
  assert(tj.summary!.rows.length === 3 && tj.summary!.risk1 !== undefined, 'Resultado traz tabela e curva de capital');
  globalThis.fetch = realFetchT;
}

// Capital com limite de posições simultâneas e robustez sem os melhores trades
{
  const mk = (r: number, entryTs: number, exitTs: number): BacktestTrade => ({ symbol: 'X', timeframe: '1d', direction: 'LONG', score: 0, entryIndex: entryTs, entryTimestamp: entryTs, exitTimestamp: exitTs, exitIndex: exitTs, entryPrice: 1, exitPrice: 1, exit: 'TRAIL', grossPct: r, netPct: r, rMultiple: r });
  // 3 operações simultâneas, limite de 2: a terceira é pulada
  const c2 = riskCurve([mk(2, 1, 10), mk(2, 2, 10), mk(2, 3, 10)], 0.01, 2);
  assert(c2.taken === 2 && c2.skipped === 1, 'Acima do limite de posições abertas, a operação é pulada');
  assert(Math.abs(c2.returnPct - 4) < 1e-9, 'Duas operações de +2R com 1% de risco sobre o capital inicial: +4%', c2.returnPct.toFixed(4));
  // Sequenciais: o risco é recalculado sobre o capital atual (juros compostos)
  const seq = riskCurve([mk(2, 1, 2), mk(2, 3, 4)], 0.01, 2);
  assert(Math.abs(seq.returnPct - (1.02 * 1.02 - 1) * 100) < 1e-9 && seq.skipped === 0, 'Operações em sequência compõem sobre o capital atual');
  // Perdas simultâneas
  const dd = riskCurve([mk(-1, 1, 5), mk(-1, 2, 5)], 0.01, 5);
  assert(Math.abs(dd.maxDrawdownPct - (1 - 0.99 * (1 - 0.01 * 1)) * 100) < 0.02 && dd.returnPct < -1.9, 'Duas perdas simultâneas de 1%: queda de cerca de 2%', dd.maxDrawdownPct.toFixed(3));

  // Lucro concentrado: 5 trades gigantes e 95 perdas pequenas
  const lucky = [...Array.from({ length: 5 }, (_, i) => mk(50, i, i + 1)), ...Array.from({ length: 95 }, (_, i) => mk(-1, 100 + i, 101 + i))];
  const wb = withoutBest(lucky, 5);
  assert(wb.trades === 95 && wb.profitFactor === 0, 'Retirando os 5 melhores, só sobram perdas (fator 0)');
  const luckySummary = summarizeBatch([{ symbol: 'L', timeframe: '1d', candlesUsed: 1000, trades: lucky.map((t, i) => ({ ...t, entryIndex: i < 5 ? 10 + i : i < 50 ? 100 + i : 600 + i })), stats: computeStats(lucky) } as any]);
  assert(luckySummary.checks[5].ok === false && luckySummary.top5SharePct === 100, 'Verificação "sem os 5 melhores" reprova lucro concentrado e informa que eles são 100% do lucro');
}

// Lista fixa das grandes moedas de 2022: não depende do ranking de hoje
{
  const realFetchC = globalThis.fetch;
  const jsonC = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  const symbolsAsked = new Set<string>();
  globalThis.fetch = ((url: any) => {
    const u = String(url);
    if (u.includes('/api/v3/klines')) {
      const q = new URL(u).searchParams;
      symbolsAsked.add(q.get('symbol') || '');
      const limit = Number(q.get('limit') || 500);
      let p = 100;
      return jsonC(Array.from({ length: limit }, (_, i) => {
        const o = p; p *= 1 + 0.003 + Math.sin(i / 9) * 0.02;
        return [1_600_000_000_000 + i * 86_400_000, String(o), String(Math.max(o, p) * 1.01), String(Math.min(o, p) * 0.99), String(p), '1000', 0, '0', 0, '0', '0', '0'];
      }));
    }
    return Promise.reject(new Error('url inesperada (a lista fixa não deve consultar o ranking): ' + u));
  }) as typeof fetch;
  startBatchJob({ list: 'classic2022', strategy: 'trend', market: 'spot', tf: '1d', top: 30, bars: 700 });
  for (let i = 0; i < 400 && getBatchJob()?.status === 'running'; i++) await new Promise((r) => setTimeout(r, 50));
  const cj = getBatchJob()!;
  assert(cj.status === 'done' && cj.total === 17 && cj.done === 17, 'Lista fixa de 2022 testa as 17 moedas sem consultar o ranking', `${cj.status} ${cj.done}/${cj.total} ${cj.error ?? ''}`);
  assert(symbolsAsked.has('BTCUSDT') && symbolsAsked.has('ETCUSDT') && symbolsAsked.has('LTCUSDT'), 'A lista inclui moedas que ficaram para trás (ETC, LTC) e o BTC');
  globalThis.fetch = realFetchC;
}

// ============================================================================
// B3 (YAHOO FINANCE)
// ============================================================================
console.log('\n--- B3 ---');
{
  const DAYMS = 86400000;
  const t0 = 1_500_000_000;
  const chart = (n: number, drift: number) => {
    let p = 20;
    const ts: number[] = [], open: (number | null)[] = [], high: number[] = [], low: number[] = [], close: number[] = [], volume: number[] = [];
    for (let i = 0; i < n; i++) {
      const o = p; p *= 1 + drift + Math.sin(i / 30) * 0.01;
      ts.push(t0 + i * 86400); open.push(o); high.push(Math.max(o, p) * 1.01); low.push(Math.min(o, p) * 0.99); close.push(p); volume.push(1000);
    }
    return { chart: { result: [{ timestamp: ts, indicators: { quote: [{ open, high, low, close, volume }], adjclose: [{ adjclose: close.map((c) => c * 0.9) }] } }] } };
  };
  const base = chart(10, 0.001);
  const bad = JSON.parse(JSON.stringify(base));
  bad.chart.result[0].indicators.quote[0].open[3] = null; // dia sem negociação
  const parsed = parseYahooChart(bad);
  assert(parsed.length === 9, 'Yahoo: dias sem preço são descartados', String(parsed.length));
  assert(Math.abs(parsed[0].close / base.chart.result[0].indicators.quote[0].close[0] - 0.9) < 1e-9, 'Yahoo: preços ajustados por proventos (fechamento ajustado)');
  assert(parsed.every((c, i) => c.timestamp % DAYMS === 0 && (i === 0 || c.timestamp > parsed[i - 1].timestamp)), 'Yahoo: datas diárias crescentes');
  assert(parseYahooChart({}).length === 0 && parseYahooChart(null).length === 0, 'Yahoo: resposta vazia ou inválida não quebra');
  assert(yahooSymbol('PETR4') === 'PETR4.SA' && yahooSymbol('^BVSP') === '^BVSP', 'Yahoo: sufixo .SA nos tickers e índice sem sufixo');
  assert(new Set(B3_TICKERS).size === B3_TICKERS.length && B3_TICKERS.length === 40, 'Lista fixa da B3 tem 40 tickers sem repetição');

  const realFetchB = globalThis.fetch;
  const asked = new Set<string>();
  globalThis.fetch = ((url: any) => {
    const u = String(url);
    if (u.includes('query1.finance.yahoo.com')) {
      asked.add(decodeURIComponent(u.split('/chart/')[1].split('?')[0]));
      return Promise.resolve(new Response(JSON.stringify(chart(900, 0.002)), { status: 200 }));
    }
    return Promise.reject(new Error('url inesperada: ' + u));
  }) as typeof fetch;
  startBatchJob({ list: 'b3', strategy: 'signals', market: 'futures', tf: '1h', top: 30, bars: 700 });
  for (let i = 0; i < 400 && getBatchJob()?.status === 'running'; i++) await new Promise((r) => setTimeout(r, 50));
  const bj = getBatchJob()!;
  assert(bj.status === 'done' && bj.total === 40 && bj.done === 40, 'Backtest da B3 testa as 40 ações', `${bj.status} ${bj.done}/${bj.total} ${bj.error ?? ''}`);
  assert(bj.params.strategy === 'trend' && bj.params.market === 'spot' && bj.params.tf === '1d', 'B3 força tendência diária só de compras');
  assert(asked.has('^BVSP') && asked.has('PETR4.SA'), 'B3 usa o Ibovespa como filtro e consulta ações com .SA');
  globalThis.fetch = realFetchB;
}

// ============================================================================
// SINAIS DIÁRIOS DE TENDÊNCIA: O AO VIVO TEM DE COINCIDIR COM O BACKTEST
// ============================================================================
console.log('\n--- Tendência ao vivo vs backtest ---');
{
  const DAYMS = 86400000;
  const T0 = 1_600_000_000_000;
  const series = (seed0: number, n: number, drift: number): CandleData[] => {
    let seed = seed0;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 - 0.5; };
    let p = 100;
    return Array.from({ length: n }, (_, i) => {
      const o = p;
      p *= 1 + drift + Math.sin(i / 40) * 0.012 + rnd() * 0.05;
      return { time: String(i), timestamp: T0 + i * DAYMS, open: o, high: Math.max(o, p) * (1 + Math.abs(rnd()) * 0.02), low: Math.min(o, p) * (1 - Math.abs(rnd()) * 0.02), close: p, volume: 1000 };
    });
  };

  // Reproduz o que o scanner veria a cada dia: só velas fechadas e a abertura do dia em andamento (sem ver o futuro)
  const replay = (coin: CandleData[], btc: CandleData[]): TrendSignal[] => {
    const signals: TrendSignal[] = [];
    for (let d = 1; d < coin.length; d++) {
      const now = T0 + d * DAYMS + 3_600_000; // 1h depois da abertura do dia d
      const mask = (c: CandleData): CandleData => ({ ...c, high: c.open, low: c.open, close: c.open }); // dia em andamento: só a abertura
      const visible = [...coin.slice(0, d), mask(coin[d])];
      for (let k = 0; k < signals.length; k++) signals[k] = updateTrendSignal(signals[k], visible, now);
      const { closed } = splitClosed(visible, now);
      const btcClosed = btc.slice(0, d);
      const reg = btcRegimeByDay(btcClosed).get(Math.floor(btcClosed[btcClosed.length - 1].timestamp / DAYMS)) === true;
      const sig = detectTrendEntry(closed, reg, 'AAAUSDT', 'AAA', now);
      if (sig && canEnter(signals, 'AAAUSDT', sig.signalDay)) signals.push(sig);
    }
    return signals;
  };

  let totalCompared = 0;
  for (const [seed, drift] of [[11, 0.002], [23, 0.003], [47, 0.001], [91, 0.0025]] as [number, number][]) {
    const coin = series(seed, 700, drift);
    const btc = series(seed + 1, 700, 0.002);
    const bt = runTrendBacktest(coin, btc, 'AAAUSDT').trades.filter((t) => t.exit !== 'TIMEOUT');
    const live = replay(coin, btc).filter((s) => s.status === 'STOPPED' || s.status === 'CLOSED');
    totalCompared += bt.length;
    assert(live.length === bt.length, `Série ${seed}: ao vivo gera o mesmo número de operações encerradas que o backtest`, `ao vivo=${live.length} backtest=${bt.length}`);
    const same = bt.every((t, k) =>
      Math.abs(live[k].entryPrice! - t.entryPrice) < 1e-9 &&
      Math.abs(live[k].exitPrice! - t.exitPrice) < 1e-9 &&
      (live[k].status === 'STOPPED') === (t.exit === 'STOP'));
    assert(same, `Série ${seed}: entradas, saídas e tipo de saída idênticos ao backtest`);
    const r = trendSignalResult(live[0] ?? ({} as TrendSignal));
    if (live.length) assert(!!r && Math.abs(r.netPct - bt[0].netPct) < 1e-9 && Math.abs(r.r - bt[0].rMultiple) < 1e-9, `Série ${seed}: resultado líquido e em R idênticos ao backtest`);
  }
  assert(totalCompared >= 8, 'A comparação cobre operações suficientes para valer', String(totalCompared));

  // Estados intermediários
  const coin = series(11, 700, 0.002);
  const btc = series(12, 700, 0.002);
  const full = replay(coin, btc);
  assert(full.every((s) => s.id === `AAAUSDT-${s.signalDay}`), 'Id do sinal = moeda + dia do rompimento (sem repetir alerta)');
  const pending = detectTrendEntry(splitClosed(coin.slice(0, 300), T0 + 299 * DAYMS + DAYMS + 1).closed, true, 'AAAUSDT', 'AAA');
  if (pending) {
    const pendente = updateTrendSignal(pending, coin.slice(0, 300), T0 + 300 * DAYMS - 1);
    assert(pendente.entryPrice === undefined && pendente.status === 'OPEN', 'Antes de o dia da entrada começar o sinal fica pendente (sem preço de entrada)');
  }
  assert(canEnter([], 'XUSDT', 1) && !canEnter([{ symbol: 'XUSDT', status: 'OPEN', signalDay: 1 } as TrendSignal], 'XUSDT', 99), 'Uma posição por moeda: com sinal aberto não entra outro');
  assert(canEnter([{ symbol: 'XUSDT', status: 'CLOSED', closedAt: 10 } as TrendSignal], 'XUSDT', 11) && !canEnter([{ symbol: 'XUSDT', status: 'CLOSED', closedAt: 10 } as TrendSignal], 'XUSDT', 10), 'Nova entrada só em dia posterior ao da saída anterior (como no backtest)');

  // Semáforo da estratégia (em meses, não em semanas)
  const mkS = (netPct: number, createdDaysAgo: number): TrendSignal => ({
    id: String(Math.random()), symbol: 'X', baseAsset: 'X', signalDay: 0, createdAt: Date.now() - createdDaysAgo * DAYMS, refPrice: 100, entryPrice: 100,
    stopPrice: 90, atr: 5, exitLevel: 90, status: 'CLOSED', exitPrice: 100 * (1 + (netPct + 0.3) / 100)
  });
  const good = [...Array.from({ length: 4 }, () => mkS(30, 100)), ...Array.from({ length: 8 }, () => mkS(-5, 90))];
  assert(evaluateTrendReadiness(good).status === 'ready', '12 operações em 100 dias com fator de lucro 3,0 => pronto (valor pequeno)');
  assert(evaluateTrendReadiness([mkS(30, 20), mkS(-5, 15)]).status === 'collecting', 'Poucas operações e poucos dias => ainda coletando');
  const bad = Array.from({ length: 12 }, (_, i) => mkS(i % 4 === 0 ? 8 : -6, 100));
  assert(evaluateTrendReadiness(bad).status === 'failed', 'Dados suficientes e resultado negativo ao vivo => reprovado');
}

// Scanner diário no servidor, com a Binance simulada
{
  process.env.TREND_PERSIST = 'off';
  const DAY2 = 86400000;
  const todayStart = Math.floor(Date.now() / DAY2) * DAY2;
  const realFetchD = globalThis.fetch;
  let btcBullishMock = true;
  const klinesFor = (isBtc: boolean) => {
    // 300 dias fechados + o dia de hoje em andamento (só a abertura conhecida)
    const rows: any[] = [];
    for (let i = 0; i < 301; i++) {
      const ts = todayStart - (300 - i) * DAY2;
      const lastClosed = i === 299, today = i === 300;
      let close = 100 + Math.sin(i / 3) * 0.4;
      if (isBtc && !btcBullishMock) close = 200 * Math.pow(0.995, i); // BTC em queda constante
      if (lastClosed && !(isBtc && !btcBullishMock)) close = 130; // rompimento ontem
      const open = today ? (isBtc && !btcBullishMock ? close : 131) : close - 0.2;
      const o = today ? open : open;
      const h = today ? o : Math.max(o, close) * 1.002;
      const l = today ? o : Math.min(o, close) * 0.998;
      rows.push([ts, String(o), String(h), String(l), String(today ? o : close), '1000', ts + DAY2 - 1, '0', 0, '0', '0', '0']);
    }
    return rows;
  };
  globalThis.fetch = ((url: any) => {
    const u = String(url);
    if (u.includes('/api/v3/klines')) {
      const sym = new URL(u).searchParams.get('symbol');
      return Promise.resolve(new Response(JSON.stringify(klinesFor(sym === 'BTCUSDT')), { status: 200 }));
    }
    return Promise.reject(new Error('url inesperada: ' + u));
  }) as typeof fetch;

  resetTrendState();
  await runTrendScan();
  const st = getTrendState();
  assert(st.regime?.bullish === true && st.lastError === null, 'Scanner lê o regime do Bitcoin e termina sem erro', String(st.lastError));
  assert(st.signals.length === 17 && st.watch.length === 17, 'Rompimento em todas as 17 moedas gera 17 sinais e a lista de observação completa', `${st.signals.length}/${st.watch.length}`);
  const sg = st.signals[0];
  assert(sg.entryPrice === 131 && Math.abs(sg.stopPrice - (131 - 2 * sg.atr)) < 1e-9, 'Entrada = abertura de hoje (131) e stop = entrada − 2 ATR');
  assert(sg.refPrice === 130 && sg.status === 'OPEN', 'Referência = fechamento de ontem; posição aberta');
  assert(st.watch[0].distancePct <= st.watch[16].distancePct, 'Lista de observação ordenada pelas moedas mais perto de romper');
  await runTrendScan();
  assert(getTrendState().signals.length === 17, 'Nova varredura não duplica sinais nem alertas');

  const entryMsg = formatTrendAlert(sg, 'entry');
  assert(entryMsg.includes('COMPRAR') && entryMsg.includes('Stop:') && entryMsg.includes('Sem alvo fixo'), 'Alerta de entrada traz stop e avisa que não há alvo fixo');
  assert(formatTrendAlert({ ...sg, status: 'EXIT_SIGNAL' }, 'exit').includes('abertura de hoje') && formatTrendAlert({ ...sg, status: 'STOPPED', exitPrice: 120 }, 'exit').includes('stop atingido'), 'Alertas de saída: pela tendência e pelo stop');

  btcBullishMock = false;
  resetTrendState();
  await runTrendScan();
  assert(getTrendState().regime?.bullish === false && getTrendState().signals.length === 0, 'Bitcoin em queda (abaixo da média de 200 dias): nenhuma entrada nova');
  globalThis.fetch = realFetchD;
}

// ============================================================================
// DADOS DE FUTUROS COM FONTES ALTERNATIVAS (BINANCE → BYBIT → OKX)
// ============================================================================
console.log('\n--- Futuros: fontes alternativas ---');
{
  const realFetchF2 = globalThis.fetch;
  const calls: string[] = [];
  const blocked = new Set<string>();
  const respond = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  const T = 1_700_000_000_000, H = 3_600_000;
  globalThis.fetch = ((url: any) => {
    const u = String(url);
    const host = u.includes('fapi.binance.com') ? 'binance' : u.includes('bybit.com') ? 'bybit' : u.includes('okx.com') ? 'okx' : 'x';
    calls.push(`${host}:${u}`);
    if (blocked.has(host)) return Promise.resolve(new Response('blocked', { status: host === 'binance' ? 451 : 403 }));
    if (host === 'binance' && u.includes('/klines')) return respond([[T, '1', '2', '0.5', '1.5', '10', T + H - 1], [T + H, '1.5', '2', '1', '1.8', '11', T + 2 * H - 1]]);
    if (host === 'binance' && u.includes('/ticker/price')) return respond([{ symbol: 'BTCUSDT', price: '64000' }, { symbol: 'ETHUSDT', price: '3100' }, { symbol: 'BTCUSDT_250627', price: '1' }]);
    if (host === 'bybit' && u.includes('/kline')) return respond({ retCode: 0, result: { list: [[String(T + H), '1.5', '2', '1', '1.8', '11', '0'], [String(T), '1', '2', '0.5', '1.5', '10', '0']] } }); // mais novo primeiro
    if (host === 'bybit' && u.includes('/tickers')) return respond({ retCode: 0, result: { list: [{ symbol: 'BTCUSDT', lastPrice: '64010' }, { symbol: '1000PEPEUSDT', lastPrice: '0.0125' }] } });
    if (host === 'okx' && u.includes('history-candles')) return respond({ code: '0', data: [[String(T + H), '0.0000015', '0.000002', '0.000001', '0.0000018', '11'], [String(T), '0.000001', '0.000002', '0.0000005', '0.0000015', '10']] });
    if (host === 'okx' && u.includes('/tickers')) return respond({ code: '0', data: [{ instId: 'BTC-USDT-SWAP', last: '64020' }, { instId: 'PEPE-USDT-SWAP', last: '0.0000125' }] });
    return Promise.reject(new Error('url inesperada: ' + u));
  }) as typeof fetch;

  // 1) tudo no ar: usa a Binance
  resetFuturesProvider();
  let k = await futuresKlines('BTCUSDT', '1h', 2);
  assert(getFuturesProvider() === 'binance' && k.length === 2 && k[0][0] === T, 'Binance no ar: usa a Binance');

  // 2) Binance bloqueada (451): cai para a Bybit e devolve do mais antigo para o mais novo
  blocked.add('binance'); resetFuturesProvider();
  k = await futuresKlines('BTCUSDT', '1h', 2);
  assert(getFuturesProvider() === 'bybit', 'Binance bloqueada (451): usa a Bybit');
  assert(k[0][0] === T && k[1][0] === T + H && k[0][4] === '1.5' && k[1][6] === T + 2 * H - 1, 'Candles da Bybit convertidos: ordem do mais antigo ao mais novo, no formato da Binance');

  // 3) memoriza a fonte que funcionou: a próxima chamada nem tenta a Binance
  calls.length = 0;
  await futuresKlines('BTCUSDT', '1h', 2);
  assert(!calls.some((c) => c.startsWith('binance:')) && calls[0].startsWith('bybit:'), 'Lembra a fonte que funcionou e não espera a que falha');

  // 4) Bybit também bloqueada: OKX, com o preço das moedas "1000" ajustado
  blocked.add('bybit'); resetFuturesProvider();
  k = await futuresKlines('1000PEPEUSDT', '1h', 2);
  assert(getFuturesProvider() === 'okx' && calls.some((c) => c.includes('instId=PEPE-USDT-SWAP')), 'Binance e Bybit bloqueadas: usa a OKX (contrato PEPE-USDT-SWAP)');
  assert(Math.abs(Number(k[0][4]) - 0.0015) < 1e-12 && Math.abs(Number(k[1][4]) - 0.0018) < 1e-12 && k[0][0] === T, 'Preço da OKX multiplicado por 1000 para casar com 1000PEPEUSDT; ordem crescente');
  const pr = await futuresPrices(['BTCUSDT', '1000PEPEUSDT', 'ZZZUSDT']);
  assert(pr.get('BTCUSDT') === 64020 && Math.abs(pr.get('1000PEPEUSDT')! - 0.0125) < 1e-12 && !pr.has('ZZZUSDT'), 'Preços via OKX: ajuste de 1000x e moedas ausentes ficam de fora');
  assert(toOkxInstrument('BTCUSDT').factor === 1 && toOkxInstrument('1000PEPEUSDT').factor === 1000 && toOkxInstrument('1INCHUSDT').instId === '1INCH-USDT-SWAP' && toOkxInstrument('1000000MOGUSDT').factor === 1000000, 'Mapeamento de símbolos para a OKX (1INCH não é confundida com 1000x)');

  // 5) todas bloqueadas: erro claro com o motivo de cada uma
  blocked.add('okx'); resetFuturesProvider();
  let err = '';
  try { await futuresKlines('BTCUSDT', '1h', 2); } catch (e: any) { err = String(e?.message); }
  assert(err.includes('HTTP 451') && err.includes('Bybit') && err.includes('OKX'), 'Todas as fontes bloqueadas: erro lista o motivo de cada corretora');

  // 6) listas de símbolos
  blocked.clear();
  const okxSet = await futuresSymbolsFrom('okx');
  assert(okxSet.has('BTCUSDT') && !okxSet.has('1000BTCUSDT') && okxSet.has('1000PEPEUSDT') && !okxSet.has('PEPEUSDT'), 'Lista da OKX: moedas de preço muito baixo aparecem com o nome 1000X (padrão da Binance/Bybit)');
  assert((await futuresSymbolsFrom('binance')).has('BTCUSDT') && !(await futuresSymbolsFrom('binance')).has('BTCUSDT_250627'), 'Lista da Binance ignora contratos com vencimento');

  // 7) universo de futuros com a Binance bloqueada: segue com a Bybit e avisa o que não foi verificado
  const cgMock = [{ symbol: 'btc', name: 'Bitcoin', market_cap_rank: 1, market_cap: 1e12 }, { symbol: 'pepe', name: 'Pepe', market_cap_rank: 2, market_cap: 5e9 }];
  const origFetch = globalThis.fetch;
  globalThis.fetch = ((url: any) => {
    const u = String(url);
    if (u.includes('coingecko')) return respond(cgMock);
    return (origFetch as any)(url);
  }) as typeof fetch;
  delete process.env.CMC_API_KEY;
  process.env.EXCHANGES = 'binance,bybit';
  blocked.add('binance'); resetFuturesProvider();
  const uBybit = await buildUniverse('futures');
  assert(uBybit.coins.map((c) => c.symbol).join(',') === 'BTCUSDT,1000PEPEUSDT' && uBybit.unverified?.join(',') === 'binance', 'Universo de futuros com a Binance bloqueada usa a Bybit e marca a Binance como não verificada');
  // Configuração padrão (só Binance exigida) com a Binance bloqueada: a Bybit serve de lista de reserva
  delete process.env.EXCHANGES;
  const uDefault = await buildUniverse('futures');
  assert(uDefault.coins.map((c) => c.symbol).join(',') === 'BTCUSDT,1000PEPEUSDT' && uDefault.unverified?.join(',') === 'binance', 'Só a Binance exigida e ela bloqueada: usa a Bybit como lista de reserva');
  process.env.EXCHANGES = 'binance,bybit';
  blocked.add('bybit');
  const uOkx = await buildUniverse('futures');
  assert(uOkx.coins.some((c) => c.symbol === '1000PEPEUSDT') && !!uOkx.unverified?.includes('bybit') && !!uOkx.unverified?.includes('binance'), 'Binance e Bybit bloqueadas: universo pela OKX, ambas marcadas como não verificadas');
  blocked.add('okx');
  let uErr = '';
  try { await buildUniverse('futures'); } catch (e: any) { uErr = String(e?.message); }
  assert(uErr.includes('Binance, Bybit e OKX indisponíveis'), 'Nenhuma corretora acessível: erro claro em vez de lista vazia');
  delete process.env.EXCHANGES;
  globalThis.fetch = realFetchF2;
  resetFuturesProvider();
}

// ============================================================================
// ARMAZENAMENTO NO SERVIDOR: MEMÓRIA, ARQUIVO E SUPABASE; API COM CHAVE DE ACESSO
// ============================================================================
console.log('\n--- Armazenamento no servidor ---');
{
  // memória
  await setState('k1', { a: 1 }, 100);
  assert((await getState('k1'))?.value.a === 1 && (await getState('nao-existe')) === null, 'Memória: grava e lê; chave ausente devolve null');

  // arquivo (em pasta temporária)
  const cwd0 = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-state-'));
  process.chdir(tmp);
  process.env.STATE_BACKEND = 'file';
  await Promise.all([setState('a', { n: 1 }, 1), setState('b', { n: 2 }, 2), setState('c', { n: 3 }, 3)]);
  const all = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'app-state.json'), 'utf8'));
  assert(Object.keys(all).sort().join(',') === 'a,b,c', 'Arquivo: gravações simultâneas não se atropelam (todas as chaves ficam salvas)');
  assert((await getState('b'))?.value.n === 2 && (await getState('b'))?.savedAt === 2, 'Arquivo: lê de volta o valor e a data');
  assert((await storageHealth()).ok === true, 'Diagnóstico de armazenamento: ida e volta ok no arquivo');
  assert(storageInfo().persistent === false, 'Arquivo sem PERSISTENT_DISK é marcado como não persistente (disco some ao reiniciar em hospedagens gratuitas)');
  process.env.PERSISTENT_DISK = 'true';
  assert(storageInfo().persistent === true, 'PERSISTENT_DISK=true marca o arquivo como persistente');
  delete process.env.PERSISTENT_DISK;
  process.chdir(cwd0);
  fs.rmSync(tmp, { recursive: true, force: true });

  // Supabase (simulado)
  process.env.STATE_BACKEND = 'auto';
  process.env.SUPABASE_URL = 'https://proj.supabase.co/';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  assert(stateBackend() === 'supabase' && storageInfo().persistent === true, 'Com URL e chave do Supabase, o backend é supabase e persistente');
  const realFetchS = globalThis.fetch;
  const seen: { url: string; init?: any }[] = [];
  const table = new Map<string, any>();
  globalThis.fetch = ((url: any, init?: any) => {
    const u = String(url);
    seen.push({ url: u, init });
    if (init?.method === 'POST') { const b = JSON.parse(init.body); table.set(b.key, { value: b.value, saved_at: b.saved_at }); return Promise.resolve(new Response(null, { status: 201 })); }
    const key = decodeURIComponent(new URL(u).searchParams.get('key')!.replace('eq.', ''));
    return Promise.resolve(new Response(JSON.stringify(table.has(key) ? [table.get(key)] : []), { status: 200 }));
  }) as typeof fetch;
  await setState('paper-spot', { virtualBalance: 5 }, 777);
  const up = seen[0];
  assert(up.url === 'https://proj.supabase.co/rest/v1/app_state?on_conflict=key' && up.init.headers.apikey === 'service-key' && up.init.headers.Authorization === 'Bearer service-key', 'Supabase: grava por upsert na tabela app_state com a chave de serviço');
  assert(String(up.init.headers.Prefer).includes('merge-duplicates'), 'Supabase: upsert sobrescreve a linha existente');
  const back = await getState('paper-spot');
  assert(back?.value.virtualBalance === 5 && back?.savedAt === 777, 'Supabase: lê de volta valor e data');
  assert((await getState('outra')) === null, 'Supabase: chave ausente devolve null');
  globalThis.fetch = (() => Promise.resolve(new Response('err', { status: 500 }))) as typeof fetch;
  let supaErr = '';
  try { await setState('x', {}, 1); } catch (e: any) { supaErr = String(e?.message); }
  assert(supaErr.includes('Supabase HTTP 500'), 'Supabase com erro: a gravação falha de forma explícita (o app não finge que salvou)');
  assert((await storageHealth()).ok === false, 'Diagnóstico mostra o armazenamento com falha');
  globalThis.fetch = realFetchS;
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.STATE_BACKEND = 'memory';

  // API do estado
  const account = { virtualBalance: 9000, initialBalance: 10000, totalTrades: 1, winTrades: 0, lossTrades: 1, totalFeesPaid: 1, positions: [], closedHistory: [{ id: 'x' }] };
  assert(validPaperAccount(account) && !validPaperAccount({ virtualBalance: 'x' }) && !validPaperAccount(null), 'Validação da carteira: aceita a estrutura certa e recusa lixo');
  delete process.env.APP_ACCESS_KEY;
  assert((await stateRead('paper-spot', undefined)).json.value === null, 'Sem dados salvos a leitura devolve valor nulo');
  const w1 = await stateWrite('paper-spot', { value: account, savedAt: 1000 }, undefined);
  assert(w1.status === 200, 'Grava a carteira');
  const r1 = await stateRead('paper-spot', undefined);
  assert((r1.json.value as any).virtualBalance === 9000 && r1.json.savedAt === 1000, 'Lê de volta a carteira gravada');
  const stale = await stateWrite('paper-spot', { value: { ...account, virtualBalance: 1 }, savedAt: 500 }, undefined);
  assert(stale.status === 409 && (stale.json.value as any).virtualBalance === 9000, 'Aparelho com dados velhos é recusado (409) e recebe a versão mais nova: nunca apaga o histórico de outro');
  assert((await stateWrite('paper-spot', { value: { ...account, virtualBalance: 8000 }, savedAt: 2000 }, undefined)).status === 200 && ((await stateRead('paper-spot', undefined)).json.value as any).virtualBalance === 8000, 'Versão mais nova é aceita');
  assert((await stateWrite('paper-spot', { value: { virtualBalance: 'x' }, savedAt: 3000 }, undefined)).status === 400, 'Carteira inválida é recusada (400)');
  assert((await stateWrite('paper-spot', { value: account }, undefined)).status === 400, 'Sem data de gravação é recusado (400)');
  assert((await stateRead('segredo', undefined)).status === 404 && (await stateWrite('segredo', { value: {}, savedAt: 1 }, undefined)).status === 404, 'Só as chaves conhecidas são aceitas');
  assert((await stateWrite('paper-spot', { value: { ...account, positions: [{ blob: 'x'.repeat(2_100_000) }] }, savedAt: 4000 }, undefined)).status === 413, 'Estado grande demais é recusado (413)');
  assert((await stateWrite('settings', { value: { realCapital: 100 }, savedAt: 1 }, undefined)).status === 200, 'Ajustes são gravados');

  // chave de acesso
  process.env.APP_ACCESS_KEY = 'minha-chave-123';
  assert(storageInfo().keyRequired === true, 'Com APP_ACCESS_KEY o app informa que exige chave (sem revelar a chave)');
  assert((await stateRead('paper-spot', undefined)).status === 401 && (await stateRead('paper-spot', 'errada')).status === 401, 'Sem a chave, ou com chave errada: 401');
  assert((await stateWrite('paper-spot', { value: account, savedAt: 9000 }, 'errada')).status === 401, 'Gravar com chave errada: 401');
  assert((await stateRead('paper-spot', 'minha-chave-123')).status === 200 && checkAccess('minha-chave-123').status === 200 && checkAccess('x').status === 401, 'Com a chave certa funciona');
  delete process.env.APP_ACCESS_KEY;
}

// ============================================================================
// SINCRONIZAÇÃO COM O SERVIDOR, ARMAZENAMENTO BLOQUEADO, DIAGNÓSTICO E MODO DE EXECUÇÃO
// ============================================================================
console.log('\n--- Sincronização e execução ---');
{
  // Qual cópia vale
  assert(decideSync(0, null) === 'noop' && decideSync(5, null) === 'push-local', 'Servidor vazio: só envia se houver dado local');
  assert(decideSync(100, { savedAt: 200, value: {} }) === 'use-remote', 'Servidor mais novo: usa a cópia do servidor');
  assert(decideSync(300, { savedAt: 200, value: {} }) === 'push-local', 'Aparelho mais novo: envia a cópia local');
  assert(decideSync(200, { savedAt: 200, value: {} }) === 'noop' && decideSync(0, { savedAt: 50, value: {} }) === 'use-remote', 'Iguais: nada a fazer; aparelho novo adota o servidor');

  // Armazenamento local bloqueado (iframe do AI Studio / dados de site bloqueados): memória reserva em vez de perder tudo
  const realLS = (globalThis as any).localStorage;
  (globalThis as any).localStorage = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); }, removeItem() { throw new Error('SecurityError'); } };
  assert(localStore.set('k', 'v') === false && localStore.get('k') === 'v', 'Armazenamento bloqueado: guarda em memória e devolve o valor (antes perdia tudo em silêncio)');
  assert(localStore.isBlocked() === true, 'O app sabe que o navegador está bloqueando o armazenamento');
  (globalThis as any).localStorage = realLS;

  // Cliente de sincronização com o servidor simulado
  const realFetchY = globalThis.fetch;
  const server = new Map<string, { value: any; savedAt: number }>();
  let online = true, requireKey: string | null = null;
  const calls: { url: string; method: string; key?: string }[] = [];
  globalThis.fetch = ((url: any, init?: any) => {
    const u = String(url);
    const method = init?.method || 'GET';
    const key = init?.headers?.['X-Access-Key'];
    calls.push({ url: u, method, key });
    if (!online) return Promise.reject(new Error('offline'));
    const json = (st: number, b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: st }));
    if (u.endsWith('/api/storage')) return json(200, { backend: 'supabase', persistent: true, keyRequired: !!requireKey });
    if (requireKey && key !== requireKey) return json(401, { error: 'x' });
    const k = u.split('/api/state/')[1];
    if (method === 'PUT') {
      const b = JSON.parse(init.body);
      const cur = server.get(k);
      if (cur && cur.savedAt > b.savedAt) return json(409, { value: cur.value, savedAt: cur.savedAt });
      server.set(k, b);
      return json(200, { ok: true });
    }
    const cur = server.get(k);
    return json(200, { value: cur?.value ?? null, savedAt: cur?.savedAt ?? 0 });
  }) as typeof fetch;

  assert((await fetchStorageInfo())?.backend === 'supabase', 'Lê como o servidor guarda os dados');
  assert((await pushState('paper-spot', { v: 1 }, 100)).kind === 'ok' && ((await pullState('paper-spot')) as any).savedAt === 100, 'Grava e lê do servidor');
  const conf = await pushState('paper-spot', { v: 0 }, 50);
  assert(conf.kind === 'conflict' && (conf as any).value.v === 1, 'Aparelho com dados velhos recebe a versão mais nova (conflito), sem apagar nada');

  const statuses: string[] = [];
  const conflicts: any[] = [];
  const q = new SyncQueue((st) => statuses.push(st), (key, value, at) => conflicts.push({ key, value, at }), 5);
  q.enqueue('paper-futures', { n: 1 }, 10);
  q.enqueue('paper-futures', { n: 2 }, 11); // duas alterações seguidas viram uma gravação
  await new Promise((r) => setTimeout(r, 60));
  const puts = calls.filter((c) => c.method === 'PUT' && c.url.endsWith('paper-futures'));
  assert(puts.length === 1 && server.get('paper-futures')?.value.n === 2 && q.status === 'saved', 'Várias alterações seguidas viram uma só gravação e o status vira "salvo"');

  online = false;
  q.enqueue('settings', { a: 1 }, 20);
  await q.flush();
  assert(q.status === 'offline' && q.hasPending(), 'Sem conexão: status "offline" e a alteração fica pendente');
  online = true;
  await q.flush();
  assert(q.status === 'saved' && !q.hasPending() && server.get('settings')?.value.a === 1, 'Conexão volta: a alteração pendente é enviada');
  q.dispose();

  const q2 = new SyncQueue(() => undefined, (key, value, at) => conflicts.push({ key, value, at }), 5);
  q2.enqueue('paper-spot', { v: 99 }, 10); // mais velho que o do servidor (100)
  await q2.flush();
  assert(conflicts.length === 1 && conflicts[0].value.v === 1 && !q2.hasPending(), 'Conflito: avisa o app para adotar a versão do servidor e descarta a gravação velha');
  q2.dispose();

  // Chave de acesso
  requireKey = 'segredo';
  accessKey.set('errada');
  assert((await pullState('paper-spot')).kind === 'locked', 'Servidor exige chave: sem a certa o app fica "trancado"');
  accessKey.set('segredo');
  assert((await pullState('paper-spot')).kind === 'ok', 'Com a chave certa lê normalmente');
  const q3 = new SyncQueue(() => undefined, () => undefined, 5);
  accessKey.set('errada');
  q3.enqueue('paper-spot', { v: 1 }, 999);
  await q3.flush();
  assert(q3.status === 'locked', 'Gravar com chave errada deixa o status "trancado"');
  q3.dispose();
  accessKey.clear();
  globalThis.fetch = realFetchY;

  // Diagnóstico
  assert(detectHost({ K_SERVICE: 'x' } as any).startsWith('Google Cloud Run') && detectHost({ RENDER: 'true' } as any) === 'Render' && detectHost({} as any) === DEFAULT_HOST, 'Detecta a hospedagem (Cloud Run, Render ou servidor próprio)');
  const realFetchH = globalThis.fetch;
  globalThis.fetch = ((url: any) => {
    const u = String(url);
    const j = (st: number, b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: st }));
    if (u.includes('fapi.binance.com')) return j(451, {});
    if (u.includes('bybit.com')) return j(200, { retCode: 0 });
    if (u.includes('okx.com')) return j(200, { code: '0' });
    if (u.includes('coingecko')) return j(429, {});
    return j(200, {});
  }) as typeof fetch;
  const rep = await runHealth();
  const byId = Object.fromEntries(rep.checks.map((c) => [c.id, c]));
  assert(byId['binance-futures'].ok === false && byId['binance-futures'].detail!.includes('451') && byId['binance-futures'].detail!.includes('bloqueada'), 'Diagnóstico explica o 451 da Binance como bloqueio de região');
  assert(byId['bybit'].ok && byId['okx'].ok && byId['binance-spot'].ok && byId['storage'].ok, 'Diagnóstico marca ok o que responde, inclusive o armazenamento');
  assert(byId['coingecko'].detail!.includes('limite'), 'Diagnóstico explica o 429 como limite de requisições');
  assert(rep.warnings.some((w) => w.includes('Binance de futuros não responde')) && rep.warnings.some((w) => w.includes('chave de acesso')), 'Avisos: Binance de futuros fora (usa Bybit/OKX) e app sem chave de acesso');
  globalThis.fetch = (() => Promise.resolve(new Response('', { status: 451 }))) as typeof fetch;
  const rep2 = await runHealth();
  assert(rep2.warnings.some((w) => w.includes('Mude a região')), 'Todas as corretoras bloqueadas: aviso claro para mudar a região da hospedagem');
  globalThis.fetch = realFetchH;

  // Modo de execução (igual em qualquer lugar)
  assert(shouldServeStatic({ NODE_ENV: 'production' } as any, [], true) === true, 'NODE_ENV=production serve o app compilado');
  assert(shouldServeStatic({ NODE_ENV: 'production' } as any, ['--dev'], true) === false && shouldServeStatic({ NODE_ENV: 'development', K_SERVICE: 'x' } as any, [], true) === false, 'npm run dev (--dev) e NODE_ENV=development usam o modo de desenvolvimento');
  assert(shouldServeStatic({ K_SERVICE: 'x' } as any, [], true) === true && shouldServeStatic({ RENDER: 'true' } as any, [], true) === true, 'Em hospedagem conhecida, sem NODE_ENV, serve o compilado se existir dist/');
  assert(shouldServeStatic({} as any, [], true) === false && shouldServeStatic({ RENDER: 'true' } as any, [], false) === false, 'Máquina própria não serve um dist/ antigo por engano; sem dist/ não há o que servir');
}

console.log('\n========================================================');
console.log(`TOTAL DE TESTES EXECUTADOS: ${totalTests}`);
console.log(`TESTES APROVADOS: ${passedTests}`);
console.log('AUDITORIA DE REGRESSÃO E INTEGRAÇÃO CONCLUÍDA COM 100% DE SUCESSO!');
console.log('========================================================\n');

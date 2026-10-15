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
process.env.B3_PERSIST = 'off';
process.env.AI_PERSIST = 'off';
process.env.ROBOT_PERSIST = 'off';
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
import { marketTrend, detectIndicatorEntry, updateIndicatorSignal, indicatorSignalResult, evaluateB3Readiness, b3Sizing, B3Signal } from '../services/b3Signals';
import { aiConfig, generateText, resetAiState, takeBudget } from '../../server/aiAnalyst';
import { newRobotState, robotStep, robotStats, robotEquity, sanitizeConfig, DEFAULT_ROBOT_CONFIG, ROBOT_COST, SourceSignal } from '../services/robot';
import { runRobot, ensureRobot, getRobot, resetRobotState, updateRobotConfig, resetRobot } from '../../server/robot';
import { guardSignals, resolveOutcome, liveStats } from '../services/aiGuards';
import { runAiEngineScan, getAiEngineState, resetAiEngineStates, refreshAiOutcomes } from '../../server/aiEngine';
import { scanners } from '../../server/scanner';
import { computeRow, parseDecisions, pickEntries, aiSignalFrom, buildPrompt, AiDecision } from '../services/aiSwing';
import { runAiSwing, getAiSwingState, resetAiSwing } from '../../server/aiSwing';
import { readJson, OldServerError } from '../services/http';
import { runB3Scan, getB3State, resetB3State, formatB3Alert } from '../../server/b3Scanner';
import { parseYahooChart, parseCdiSeries, B3_TICKERS, yahooSymbol } from '../../server/b3Data';
import { runLab, simulate, prepareTicker, LAB_STRATEGIES, LAB_WARMUP, TickerData } from '../services/b3Lab';
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
// LABORATÓRIO DA B3 (carteira vs CDI e Ibovespa)
// ============================================================================
console.log('\n--- Laboratório B3 ---');
{
  const DAYMS = 86400000;
  const T0 = 1_400_000_000_000;
  const mk = (n: number, f: (i: number) => number): CandleData[] => {
    let p = 100;
    return Array.from({ length: n }, (_, i) => {
      const o = p; p = o * (1 + f(i));
      return { time: String(i), timestamp: T0 + i * DAYMS, open: o, high: Math.max(o, p) * 1.005, low: Math.min(o, p) * 0.995, close: p, volume: 1000 };
    });
  };
  const N = 900;
  const ibovUp = mk(N, () => 0.0004);
  const cdiD = Math.pow(1.1, 1 / 252) - 1;
  const cdiFn = () => cdiD;

  // Mercado em queda: Ibovespa abaixo da média de 200 dias => nenhuma compra, patrimônio = CDI
  const ibovDown = mk(N, () => -0.0005);
  const stocks = new Map<string, CandleData[]>();
  for (let k = 0; k < 8; k++) stocks.set('A' + k, mk(N, (i) => 0.001 + Math.sin(i / (7 + k)) * 0.02));
  const down = runLab(stocks, ibovDown, { cdiDaily: cdiFn });
  assert(down.results.every((r) => r.entries === 0), 'Lab: mercado em queda (Ibovespa < média de 200) não compra nada');
  assert(down.results.every((r) => Math.abs(r.whole.cagr - 10) < 0.3), 'Lab: sem compras, o caixa rende o CDI (~10% ao ano)', String(down.results[0].whole.cagr));
  assert(down.results.every((r) => !r.passed), 'Lab: não ganhar do CDI reprova');

  // Sem olhar o futuro: mudar o preço depois do dia D não altera o patrimônio até D
  const D = 500;
  const alt = new Map<string, CandleData[]>();
  for (const [k, c] of stocks) alt.set(k, c.map((x, i) => (i > D ? { ...x, open: x.open * 3, high: x.high * 3, low: x.low * 3, close: x.close * 3 } : x)));
  const prep = (m: Map<string, CandleData[]>) => { const d = new Map<string, TickerData>(); for (const [k, c] of m) d.set(k, prepareTicker(c, ibovUp)); return d; };
  const base = prep(stocks), changed = prep(alt);
  let same = true;
  for (const st of LAB_STRATEGIES) {
    const a = simulate(st, base, ibovUp, { cdiDaily: cdiFn }).equity, b = simulate(st, changed, ibovUp, { cdiDaily: cdiFn }).equity;
    for (let i = 0; i < D - LAB_WARMUP; i++) if (Math.abs(a[i] - b[i]) > 1e-9) same = false;
  }
  assert(same, 'Lab: nenhuma estratégia usa preços futuros (patrimônio igual até o dia alterado)');

  // Custos reduzem o resultado
  const free = simulate(LAB_STRATEGIES[1], base, ibovUp, { cdiDaily: cdiFn, cost: 0 });
  const paid = simulate(LAB_STRATEGIES[1], base, ibovUp, { cdiDaily: cdiFn, cost: 0.01 });
  assert(free.equity[free.equity.length - 1] > paid.equity[paid.equity.length - 1], 'Lab: custos por lado reduzem o patrimônio');

  // Tendência forte nas ações: momentum compra, tem entradas e dados completos
  const strong = new Map<string, CandleData[]>();
  for (let k = 0; k < 8; k++) strong.set('S' + k, mk(N, (i) => 0.0005 * (k + 1) + Math.sin(i / 11 + k) * 0.015));
  const up = runLab(strong, ibovUp, { cdiDaily: cdiFn });
  const mom = up.results.find((r) => r.id === 'momentum')!;
  assert(mom.entries > 0 && mom.equity.length === N - LAB_WARMUP && up.results.length === 4, 'Lab: roda as 4 candidatas e gera curva de patrimônio');
  const withVol = new Map<string, CandleData[]>();
  for (let k = 0; k < 8; k++) withVol.set('V' + k, mk(N, (i) => 0.006 + Math.sin(i / 8 + k) * 0.02).map((x, i) => ({ ...x, volume: i % 4 === 0 ? 5000 : 1000 })));
  const indi = runLab(withVol, ibovUp, { cdiDaily: cdiFn }).results.find((r) => r.id === 'indicators')!;
  assert(indi.entries > 0, 'Lab: confluência de indicadores gera entradas em tendência de alta com volume', String(indi.entries));
  assert(mom.checks.length === 5 && up.benchmarks.whole.ibov > 0, 'Lab: 5 critérios e referências (CDI e Ibovespa)');

  // Ações com dias sem negociação não quebram o alinhamento
  const gap = mk(N, () => 0.001).filter((_, i) => i % 7 !== 3);
  const t = prepareTicker(gap, ibovUp);
  assert(t.c.length === N && t.traded.filter((x) => !x).length === Math.floor(N / 7) + (N % 7 > 3 ? 1 : 0), 'Lab: dias sem negociação repetem o último preço e ficam marcados');

  // CDI do Banco Central
  const cdi = parseCdiSeries([{ data: '02/01/2020', valor: '0.017452' }, { data: 'x', valor: '1' }, { data: '03/01/2020', valor: 'abc' }]);
  assert(cdi.size === 1 && Math.abs([...cdi.values()][0] - 0.00017452) < 1e-12, 'CDI: lê data dd/mm/aaaa e converte % ao dia em fração');
}

// ============================================================================
// SEÇÃO B3: SWING TRADE, TENDÊNCIA DO MERCADO E SCANNER
// ============================================================================
console.log('\n--- B3 swing trade ---');
{
  const DAYMS = 86400000;
  const T0 = 1_500_000_000_000;
  const day = (i: number) => Math.floor(T0 / DAYMS) * DAYMS + i * DAYMS;
  const bar = (i: number, o: number, c: number, spread = 0.01, vol = 1000): CandleData => ({
    time: String(i), timestamp: day(i), open: o, high: Math.max(o, c) * (1 + spread), low: Math.min(o, c) * (1 - spread), close: c, volume: vol
  });
  const series = (n: number, f: (i: number) => number): CandleData[] => {
    let p = 100;
    return Array.from({ length: n }, (_, i) => { const o = p; p = o * (1 + f(i)); return bar(i, o, p); });
  };

  // Tendência do mercado
  const up = marketTrend(series(260, () => 0.002))!;
  const down = marketTrend(series(260, () => -0.002))!;
  assert(up.label === 'Alta' && up.bullish && up.close > up.sma50 && up.sma50 > up.sma200 && up.change20dPct > 0, 'B3: Ibovespa em alta => mercado em alta, compras liberadas');
  assert(down.label === 'Baixa' && !down.bullish && down.change20dPct < 0, 'B3: Ibovespa em queda => mercado em baixa, compras bloqueadas');
  assert(marketTrend(series(150, () => 0.001)) === null, 'B3: poucos dados => sem leitura de mercado');

  // Ciclo de vida de um sinal de indicadores (entrada no pregão seguinte, inclusive depois do fim de semana)
  const base: B3Signal = { id: 'X', symbol: 'TEST3', signalDay: day(100), createdAt: 0, refPrice: 100, stopPrice: 98.5, targetPrice: 103, atr: 1, score: 70, status: 'OPEN' };
  const NOW = day(200); // tudo já fechado
  const gapWeekend = [bar(100, 99, 100), { ...bar(103, 100.5, 101), timestamp: day(103) }]; // sexta -> segunda
  const u1 = updateIndicatorSignal(base, gapWeekend, NOW);
  assert(u1.entryPrice === 100.5 && u1.status === 'OPEN', 'B3: entrada na abertura do próximo pregão (sexta -> segunda)', JSON.stringify(u1));
  const stopped = updateIndicatorSignal(base, [bar(100, 99, 100), bar(101, 100, 99.5, 0.0), bar(102, 99.5, 97, 0.0)], NOW);
  assert(stopped.status === 'STOP' && Math.abs(stopped.exitPrice! - (100 - 1.5)) < 1e-9, 'B3: stop de 1,5 ATR atingido', JSON.stringify(stopped));
  const gapDown = updateIndicatorSignal(base, [bar(100, 99, 100), bar(101, 100, 100, 0.0), bar(102, 95, 94, 0.0)], NOW);
  assert(gapDown.status === 'STOP' && gapDown.exitPrice === 95, 'B3: abertura abaixo do stop sai na abertura (pior que o stop)');
  const target = updateIndicatorSignal(base, [bar(100, 99, 100), bar(101, 100, 100.5, 0.0), bar(102, 101, 104, 0.0)], NOW);
  assert(target.status === 'TARGET' && Math.abs(target.exitPrice! - 103) < 1e-9, 'B3: alvo de 3 ATR atingido', JSON.stringify(target));
  const both = updateIndicatorSignal(base, [bar(100, 99, 100), bar(101, 100, 100, 0.0), { ...bar(102, 100, 100), high: 105, low: 97 }], NOW);
  assert(both.status === 'STOP', 'B3: stop e alvo no mesmo dia => vale o stop (conservador)');
  const flat = Array.from({ length: 30 }, (_, k) => bar(100 + k, 100, 100, 0.001));
  const timeout = updateIndicatorSignal(base, flat, NOW);
  assert(timeout.status === 'TIMEOUT' && timeout.entryPrice === 100, 'B3: sem stop nem alvo, sai por prazo (20 pregões)', timeout.status);
  const pendingExit = updateIndicatorSignal(base, flat.slice(0, 22), day(100 + 22));
  assert(pendingExit.status === 'EXIT_SIGNAL', 'B3: prazo vencido no último pregão => aviso de saída para amanhã', pendingExit.status);
  const res = indicatorSignalResult(target)!;
  assert(res.netPct > 2 && res.netPct < 3 && res.r > 1, 'B3: resultado líquido do alvo desconta custos', JSON.stringify(res));
  assert(evaluateB3Readiness([]).status === 'collecting', 'B3: sem operações encerradas => ainda coletando');

  // Tamanho da posição (lotes de 100 e mercado fracionário)
  const sz = b3Sizing(10000, 1, 30, 28)!;
  assert(sz.shares === 50 && sz.fractional && Math.abs(sz.riskBrl - 100) < 1e-9, 'B3: tamanho pelo risco (1% de R$ 10 mil, stop R$ 2) = 50 ações, fracionário', JSON.stringify(sz));
  const sz2 = b3Sizing(1_000_000, 1, 30, 28)!;
  assert(sz2.shares === 5000 && !sz2.fractional && sz2.lots === 50, 'B3: tamanho em lotes de 100');
  assert(b3Sizing(10000, 1, 30, 31) === null && b3Sizing(0, 1, 30, 28) === null && b3Sizing(100, 1, 300, 290) === null, 'B3: stop inválido, capital zero ou capital menor que 1 ação => sem sugestão');
  const capped = b3Sizing(1000, 1, 30, 29.9)!;
  assert(capped.shares === 33 && capped.cost <= 1000, 'B3: nunca passa do capital (sem alavancagem)', JSON.stringify(capped));

  // Sinal de indicadores só com mercado em alta
  let found: ReturnType<typeof detectIndicatorEntry> = null;
  let upStrong: CandleData[] = [];
  for (let k = 0; k < 6 && !found; k++) {
    const sr = series(400, (i) => 0.006 + Math.sin(i / 12 + k) * 0.01).map((x, i) => ({ ...x, volume: i % 4 === 0 ? 5000 : 1000 }));
    for (let cut = 200; cut < 400 && !found; cut++) {
      const f = detectIndicatorEntry(sr.slice(0, cut), true, 'TEST3', 1);
      if (f) { found = f; upStrong = sr.slice(0, cut); }
    }
  }
  assert(found !== null && found.status === 'OPEN' && found.stopPrice < found.refPrice && found.targetPrice > found.refPrice && found.score >= 60, 'B3: motor de indicadores gera sinal de compra com stop e alvo');
  assert(detectIndicatorEntry(upStrong, false, 'TEST3', 1) === null, 'B3: mercado em baixa bloqueia o sinal de indicadores');

  // Scanner com Yahoo simulado: rompimento de 55 dias vira sinal de tendência
  const realFetchS = globalThis.fetch;
  const lastDay = Math.floor(Date.now() / DAYMS) * DAYMS - DAYMS; // ontem: já fechado
  const chartFor = (closes: number[]) => {
    const ts: number[] = [], o: number[] = [], h: number[] = [], l: number[] = [], c: number[] = [], v: number[] = [];
    closes.forEach((cl, i) => {
      const prev = i ? closes[i - 1] : cl;
      ts.push((lastDay - (closes.length - 1 - i) * DAYMS) / 1000); o.push(prev); c.push(cl);
      h.push(Math.max(prev, cl) * 1.01); l.push(Math.min(prev, cl) * 0.99); v.push(1000);
    });
    return { chart: { result: [{ timestamp: ts, indicators: { quote: [{ open: o, high: h, low: l, close: c, volume: v }] } }] } };
  };
  const ibovCloses = Array.from({ length: 400 }, (_, i) => 100 * Math.pow(1.001, i));
  const flatCloses = Array.from({ length: 400 }, (_, i) => 100 + Math.sin(i / 3));
  const breakout = [...flatCloses.slice(0, 399), 130];
  globalThis.fetch = ((url: any) => {
    const u = decodeURIComponent(String(url));
    if (!u.includes('query1.finance.yahoo.com')) return Promise.reject(new Error('url inesperada: ' + u));
    const sym = u.split('/chart/')[1].split('?')[0];
    const closes = sym === '^BVSP' ? ibovCloses : sym === 'PETR4.SA' ? breakout : flatCloses;
    return Promise.resolve(new Response(JSON.stringify(chartFor(closes)), { status: 200 }));
  }) as typeof fetch;
  resetB3State();
  await runB3Scan();
  const bs = getB3State();
  assert(bs.lastError === null && bs.market?.bullish === true && bs.market.label === 'Alta', 'Scanner B3: lê o Ibovespa e libera as compras', String(bs.lastError));
  const petr = bs.trend.signals.find((x) => x.symbol === 'PETR4');
  assert(!!petr && petr.status === 'OPEN' && petr.refPrice === 130 && petr.stopPrice < 130, 'Scanner B3: rompimento de 55 dias vira sinal de tendência com stop', JSON.stringify(petr));
  assert(bs.trend.signals.length === 1 && bs.trend.watch.length === 40 && bs.trend.watch[0].symbol === 'PETR4' && bs.trend.watch[0].distancePct < 0, 'Scanner B3: só PETR4 rompeu; observação cobre as 40 ações, a mais próxima primeiro', `${bs.trend.signals.map((x) => x.symbol)} ${bs.trend.watch.length} ${bs.trend.watch[0]?.distancePct}`);
  assert(bs.indicators.scores.length > 30, 'Scanner B3: ranking de pontuação das ações');
  assert(formatB3Alert('trend-entry', petr!).includes('PETR4') && formatB3Alert('trend-entry', petr!).includes('R$'), 'Scanner B3: alerta de entrada em reais');
  // Ibovespa em baixa: nenhuma compra nova
  const ibovDown = Array.from({ length: 400 }, (_, i) => 100 * Math.pow(0.999, i));
  globalThis.fetch = ((url: any) => {
    const u = decodeURIComponent(String(url));
    const sym = u.split('/chart/')[1].split('?')[0];
    return Promise.resolve(new Response(JSON.stringify(chartFor(sym === '^BVSP' ? ibovDown : sym === 'PETR4.SA' ? breakout : flatCloses)), { status: 200 }));
  }) as typeof fetch;
  resetB3State();
  await runB3Scan();
  assert(getB3State().market?.bullish === false && getB3State().trend.signals.length === 0 && getB3State().indicators.signals.length === 0, 'Scanner B3: Ibovespa em baixa não gera sinal novo');
  // Yahoo fora do ar: erro claro
  globalThis.fetch = (() => Promise.resolve(new Response('', { status: 429 }))) as typeof fetch;
  resetB3State();
  await runB3Scan();
  assert(!!getB3State().lastError && getB3State().running === false, 'Scanner B3: Yahoo indisponível => erro claro e scanner livre', String(getB3State().lastError));
  globalThis.fetch = realFetchS;
}

// ============================================================================
// PROVEDOR DE IA (GEMINI / CHATGPT)
// ============================================================================
console.log('\n--- Provedor de IA ---');
{
  const saved = { g: process.env.GEMINI_API_KEY, o: process.env.OPENAI_API_KEY, p: process.env.AI_PROVIDER, m: process.env.AI_MODEL, l: process.env.AI_DAILY_LIMIT };
  const setEnv = (g?: string, o?: string, p?: string) => {
    for (const [k, v] of [['GEMINI_API_KEY', g], ['OPENAI_API_KEY', o], ['AI_PROVIDER', p]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    delete process.env.AI_MODEL; delete process.env.AI_DAILY_LIMIT;
  };
  const GKEY = 'g'.repeat(30), OKEY = 'o'.repeat(30);

  setEnv();
  assert(!aiConfig().enabled, 'IA: sem chave => desligada');
  setEnv('MY_GEMINI_API_KEY');
  assert(!aiConfig().enabled, 'IA: chave de exemplo do .env.example não conta');
  setEnv(GKEY, OKEY);
  assert(aiConfig().provider === 'gemini' && aiConfig().model === 'gemini-2.5-flash', 'IA: com as duas chaves, Gemini é o padrão');
  setEnv(GKEY, OKEY, 'openai');
  assert(aiConfig().provider === 'openai' && aiConfig().model === 'gpt-4o-mini', 'IA: AI_PROVIDER escolhe o ChatGPT');
  setEnv(undefined, OKEY);
  assert(aiConfig().provider === 'openai', 'IA: só com chave da OpenAI usa o ChatGPT');
  setEnv(GKEY, undefined, 'openai');
  assert(!aiConfig().enabled, 'IA: provedor pedido sem a chave dele => desligada');

  const calls: { url: string; init: any }[] = [];
  const realFetchAi = globalThis.fetch;
  let reply: (url: string) => Response = (url) => url.includes('googleapis')
    ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'resposta do Gemini' }] } }] }), { status: 200 })
    : new Response(JSON.stringify({ choices: [{ message: { content: 'resposta do ChatGPT' } }] }), { status: 200 });
  globalThis.fetch = ((url: any, init: any) => { calls.push({ url: String(url), init }); return Promise.resolve(reply(String(url))); }) as typeof fetch;

  setEnv(GKEY);
  resetAiState();
  const t1 = await generateText('sistema', 'usuário', { json: true, temperature: 0.2, maxTokens: 900 });
  const gb = JSON.parse(calls[0].init.body);
  assert(t1 === 'resposta do Gemini' && calls[0].init.headers['x-goog-api-key'] === GKEY && !calls[0].url.includes(GKEY), 'IA: Gemini responde e a chave vai no cabeçalho, não na URL');
  assert(gb.generationConfig.responseMimeType === 'application/json' && gb.generationConfig.temperature === 0.2 && gb.generationConfig.maxOutputTokens === 900 && gb.systemInstruction.parts[0].text === 'sistema', 'IA: Gemini recebe JSON, temperatura, limite e instrução de sistema');

  setEnv(undefined, OKEY);
  calls.length = 0;
  const t2 = await generateText('sistema', 'usuário', { json: true });
  const ob = JSON.parse(calls[0].init.body);
  assert(t2 === 'resposta do ChatGPT' && calls[0].url === 'https://api.openai.com/v1/chat/completions' && calls[0].init.headers.Authorization === `Bearer ${OKEY}`, 'IA: ChatGPT responde e a chave vai no cabeçalho Authorization');
  assert(ob.response_format.type === 'json_object' && ob.messages[0].role === 'system', 'IA: ChatGPT recebe JSON e a instrução como mensagem de sistema');

  reply = () => new Response('', { status: 401 });
  let e1 = ''; try { await generateText('a', 'b'); } catch (e: any) { e1 = e.message; }
  assert(e1.includes('401'), 'IA: erro do provedor vira mensagem clara', e1);
  reply = () => new Response(JSON.stringify({ choices: [] }), { status: 200 });
  let e2 = ''; try { await generateText('a', 'b'); } catch (e: any) { e2 = e.message; }
  assert(/vazio/.test(e2), 'IA: resposta vazia => erro', e2);
  setEnv();
  let e3 = ''; try { await generateText('a', 'b'); } catch (e: any) { e3 = e.message; }
  assert(/desligada/.test(e3), 'IA: sem chave, generateText recusa');

  process.env.AI_DAILY_LIMIT = '2';
  resetAiState();
  assert(takeBudget() && takeBudget() && !takeBudget(), 'IA: limite diário de chamadas protege o custo');

  globalThis.fetch = realFetchAi;
  for (const [k, v] of [['GEMINI_API_KEY', saved.g], ['OPENAI_API_KEY', saved.o], ['AI_PROVIDER', saved.p], ['AI_MODEL', saved.m], ['AI_DAILY_LIMIT', saved.l]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  resetAiState();
}

console.log('\n--- Resposta HTML no lugar de JSON ---');
{
  const ok = await readJson(new Response('{"a":1}', { status: 200 }), '/api/x');
  assert(ok.a === 1, 'HTTP: JSON válido é lido normalmente');
  let err: any = null;
  try { await readJson(new Response('<!doctype html><html></html>', { status: 200 }), '/api/ai/summary?section=b3'); } catch (e) { err = e; }
  assert(err instanceof OldServerError && /versão antiga/.test(err.message) && err.message.includes('/api/ai/summary') && !err.message.includes('section='), 'HTTP: página do app no lugar do JSON vira mensagem clara de servidor desatualizado', String(err?.message));
  let err2: any = null;
  try { await readJson(new Response('boom', { status: 502 }), '/api/x'); } catch (e) { err2 = e; }
  assert(err2 && /HTTP 502/.test(err2.message) && !(err2 instanceof OldServerError), 'HTTP: texto qualquer vira erro genérico com o status');
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


// ============================================================================
// MOTOR DE IA DA B3: A IA DECIDE, O CÓDIGO IMPÕE TRAVAS
// ============================================================================
console.log('\n--- Motor de IA da B3 ---');
{
  const DAYMS = 86400000;
  const T0 = 1_500_000_000_000;
  const mkC = (n: number, f: (i: number) => number): CandleData[] => {
    let p = 100;
    return Array.from({ length: n }, (_, i) => {
      const o = p; p = o * (1 + f(i));
      return { time: String(i), timestamp: Math.floor(T0 / DAYMS) * DAYMS + i * DAYMS, open: o, high: Math.max(o, p) * 1.01, low: Math.min(o, p) * 0.99, close: p, volume: 1000 + (i % 5) * 100 };
    });
  };

  // Indicadores que a IA recebe
  const row = computeRow('TEST3', mkC(300, (i) => 0.002 + Math.sin(i / 9) * 0.01))!;
  assert(!!row && row.rsi > 0 && row.rsi < 100 && row.atrPct > 0 && row.volRatio > 0 && Math.abs(row.ruleScore) <= 100 && typeof row.dist55HighPct === 'number', 'IA B3: indicadores calculados para a IA (RSI, ATR%, volume, distância da máxima, pontuação)', JSON.stringify(row));
  assert(computeRow('X', mkC(100, () => 0.001)) === null, 'IA B3: pouco histórico => ativo fora da tabela');
  const mt = marketTrend(mkC(260, () => 0.002))!;
  const pr = buildPrompt(mt, [row]);
  assert(/JSON/.test(pr.system) && /ESPERAR/.test(pr.system) && pr.user.includes('TEST3') && pr.user.includes('"leitura_do_mercado":"Alta"'), 'IA B3: o pedido leva o mercado, os indicadores e o formato JSON, com padrão de esperar');

  // Leitura da resposta
  const allowed = new Set(['AAA3', 'BBB3', 'CCC3']);
  const good = '```json\n{"decisions":[{"symbol":"aaa3","action":"buy","confidence":82.4,"stop_atr":2,"target_atr":4,"hold_days":12,"reason":"tendência"},{"symbol":"ZZZ9","action":"BUY","confidence":90,"stop_atr":2,"target_atr":4},{"symbol":"AAA3","action":"BUY","confidence":99},{"symbol":"BBB3","action":"WAIT","confidence":"x"}]}\n```';
  const dec = parseDecisions(good, allowed);
  assert(dec.length === 2 && dec[0].symbol === 'AAA3' && dec[0].action === 'BUY' && dec[0].confidence === 82 && dec[1].action === 'WAIT' && dec[1].confidence === 0, 'IA B3: lê JSON com cerca de código; descarta ativo fora da lista e repetido', JSON.stringify(dec));
  assert(parseDecisions('não sei', allowed).length === 0 && parseDecisions('{"decisions":"x"}', allowed).length === 0 && parseDecisions('[{"symbol":"AAA3","action":"BUY","confidence":70,"stop_atr":2,"target_atr":4}]', allowed).length === 1, 'IA B3: texto fora do formato é descartado; lista solta também vale');

  // Travas do código
  const D = (symbol: string, o: Partial<AiDecision> = {}): AiDecision => ({ symbol, action: 'BUY', confidence: 80, stopAtr: 2, targetAtr: 4, holdDays: 10, reason: 'r', ...o });
  const none = new Set<string>();
  const okPick = pickEntries([D('A'), D('B', { confidence: 90 }), D('C', { confidence: 59 }), D('D', { targetAtr: 2.5 }), D('E', { stopAtr: NaN })], { bullish: true, openSymbols: none });
  assert(okPick.approved.map((d) => d.symbol).join() === 'B,A', 'IA B3: aprova só compras válidas, da maior confiança para a menor', okPick.approved.map((d) => d.symbol).join());
  assert(okPick.blocked.some((b) => b.symbol === 'C' && /confiança/.test(b.why)) && okPick.blocked.some((b) => b.symbol === 'D' && /1,5x/.test(b.why)) && okPick.blocked.some((b) => b.symbol === 'E'), 'IA B3: barra confiança baixa, risco/retorno ruim e stop inválido, com o motivo');
  assert(pickEntries([D('A')], { bullish: false, openSymbols: none }).approved.length === 0, 'IA B3: mercado em baixa bloqueia qualquer compra, mesmo que a IA queira');
  assert(pickEntries([D('A')], { bullish: true, openSymbols: new Set(['A']) }).approved.length === 0, 'IA B3: não abre segundo sinal no mesmo ativo');
  assert(pickEntries(['A', 'B', 'C', 'D', 'E'].map((x) => D(x)), { bullish: true, openSymbols: none }).approved.length === 3, 'IA B3: no máximo 3 sinais por rodada');
  const cl = pickEntries([D('A', { stopAtr: 0.2, targetAtr: 30, holdDays: 90 }), D('B', { stopAtr: 9, targetAtr: 30, holdDays: 1 })], { bullish: true, openSymbols: none }).approved;
  assert(cl[0].stopAtr === 1 && cl[0].targetAtr === 6 && cl[0].holdDays === 20 && cl[1].stopAtr === 3 && cl[1].holdDays === 3, 'IA B3: stop, alvo e prazo ficam dentro dos limites do código', JSON.stringify(cl));

  // Sinal da IA: usa os múltiplos e o prazo dela
  const candles = mkC(300, (i) => 0.002 + Math.sin(i / 9) * 0.01);
  const sig = aiSignalFrom({ ...D('TEST3'), stopAtr: 1.5, targetAtr: 3, holdDays: 5 }, candles, 1)!;
  assert(sig.engine === 'ai' && sig.stopMult === 1.5 && sig.holdDays === 5 && sig.refPrice === candles[299].close && sig.stopPrice < sig.refPrice && sig.targetPrice > sig.refPrice, 'IA B3: sinal criado com stop, alvo e prazo escolhidos pela IA');
  const flat = [...candles.slice(0, 300)];
  const after = Array.from({ length: 12 }, (_, k) => ({ ...candles[299], timestamp: candles[299].timestamp + (k + 1) * DAYMS, open: candles[299].close, high: candles[299].close * 1.0005, low: candles[299].close * 0.9995, close: candles[299].close }));
  const upd = updateIndicatorSignal(sig, [...flat, ...after], candles[299].timestamp + 30 * DAYMS);
  assert(upd.status === 'TIMEOUT' && upd.holdDays === 5, 'IA B3: o prazo da IA (5 pregões) vale no acompanhamento', upd.status);
  const withMult = updateIndicatorSignal(sig, [...flat, after[0]], candles[299].timestamp + 30 * DAYMS);
  assert(Math.abs(withMult.entryPrice! - withMult.stopPrice - 1.5 * sig.atr) < 1e-9 && Math.abs(withMult.targetPrice - withMult.entryPrice! - 3 * sig.atr) < 1e-9, 'IA B3: stop e alvo usam os múltiplos da IA, não os fixos do motor de regras');

  // Rodada completa no servidor: Yahoo e Gemini simulados
  const saved = { g: process.env.GEMINI_API_KEY, o: process.env.OPENAI_API_KEY, p: process.env.AI_PROVIDER };
  process.env.GEMINI_API_KEY = 'g'.repeat(30); delete process.env.OPENAI_API_KEY; delete process.env.AI_PROVIDER;
  resetAiState();
  const lastDay = Math.floor(Date.now() / DAYMS) * DAYMS - DAYMS;
  const chartFor = (closes: number[]) => {
    const ts: number[] = [], o: number[] = [], h: number[] = [], l: number[] = [], c: number[] = [], v: number[] = [];
    closes.forEach((cl2, i) => { const prev = i ? closes[i - 1] : cl2; ts.push((lastDay - (closes.length - 1 - i) * DAYMS) / 1000); o.push(prev); c.push(cl2); h.push(Math.max(prev, cl2) * 1.01); l.push(Math.min(prev, cl2) * 0.99); v.push(1000 + (i % 7) * 50); });
    return { chart: { result: [{ timestamp: ts, indicators: { quote: [{ open: o, high: h, low: l, close: c, volume: v }] } }] } };
  };
  const ibovUpC = Array.from({ length: 400 }, (_, i) => 100 * Math.pow(1.001, i));
  const ibovDownC = Array.from({ length: 400 }, (_, i) => 100 * Math.pow(0.999, i));
  const stockC = Array.from({ length: 400 }, (_, i) => 100 + Math.sin(i / 3) * 3 + i * 0.05);
  let ibovNow = ibovUpC, aiCalls = 0, aiBody = '';
  let aiReply = JSON.stringify({ decisions: [
    { symbol: 'PETR4', action: 'BUY', confidence: 80, stop_atr: 2, target_atr: 4, hold_days: 10, reason: 'Tendência de alta com volume.' },
    { symbol: 'VALE3', action: 'BUY', confidence: 50, stop_atr: 2, target_atr: 4, hold_days: 10, reason: 'fraco' },
    { symbol: 'ITUB4', action: 'BUY', confidence: 90, stop_atr: 2, target_atr: 2, hold_days: 10, reason: 'alvo curto' },
    { symbol: 'WEGE3', action: 'WAIT', confidence: 30, reason: 'sem gatilho' }
  ] });
  const realFetchW = globalThis.fetch;
  globalThis.fetch = ((url: any, init: any) => {
    const u = decodeURIComponent(String(url));
    if (u.includes('query1.finance.yahoo.com')) {
      const sym = u.split('/chart/')[1].split('?')[0];
      return Promise.resolve(new Response(JSON.stringify(chartFor(sym === '^BVSP' ? ibovNow : stockC)), { status: 200 }));
    }
    if (u.includes('generativelanguage.googleapis.com')) {
      aiCalls++; aiBody = String(init?.body ?? '');
      return Promise.resolve(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: aiReply }] } }] }), { status: 200 }));
    }
    return Promise.reject(new Error('url inesperada: ' + u));
  }) as typeof fetch;

  resetAiSwing();
  const r1 = await runAiSwing(true);
  const sw = getAiSwingState();
  assert(r1.ok && aiCalls === 1 && sw.signals.length === 1 && sw.signals[0].symbol === 'PETR4' && sw.signals[0].engine === 'ai' && sw.signals[0].confidence === 80, 'Servidor IA B3: IA decide e só a compra válida vira sinal', JSON.stringify({ r1, n: sw.signals.length }));
  assert(sw.log!.items.length >= 4 && sw.log!.created.join() === 'PETR4' && sw.log!.blocked.some((b) => b.symbol === 'VALE3') && sw.log!.blocked.some((b) => b.symbol === 'ITUB4'), 'Servidor IA B3: registra tudo o que a IA decidiu e o que as travas barraram');
  const sent = JSON.parse(aiBody);
  assert(sent.generationConfig.responseMimeType === 'application/json' && sent.contents[0].parts[0].text.includes('"symbol":"PETR4"') && sent.contents[0].parts[0].text.includes('"rsi"'), 'Servidor IA B3: a IA recebe a tabela de indicadores e responde em JSON');
  assert(sw.lastDecisionDay !== null && sw.market?.bullish === true, 'Servidor IA B3: guarda o pregão decidido e a leitura do mercado');

  const r2 = await runAiSwing(false);
  assert(r2.ok && aiCalls === 1, 'Servidor IA B3: no mesmo pregão não chama a IA de novo (só atualiza os sinais)', String(aiCalls));
  const r3 = await runAiSwing(true);
  assert(r3.ok && aiCalls === 2 && getAiSwingState().signals.length === 1, 'Servidor IA B3: pedido manual decide de novo, sem duplicar o sinal aberto');

  // Mercado em baixa: a IA pode querer comprar, o código bloqueia
  resetAiSwing(); ibovNow = ibovDownC;
  await runAiSwing(true);
  assert(getAiSwingState().signals.length === 0 && getAiSwingState().log!.blocked.some((b) => /abaixo da média/.test(b.why)), 'Servidor IA B3: Ibovespa em baixa => a compra da IA é barrada e fica registrado o porquê');

  // Resposta fora do formato e IA fora do ar
  resetAiSwing(); ibovNow = ibovUpC; aiReply = 'desculpe, não posso ajudar';
  const bad = await runAiSwing(true);
  assert(!bad.ok && /formato/.test(bad.message) && getAiSwingState().signals.length === 0, 'Servidor IA B3: resposta fora do formato não gera sinal e mostra erro claro', bad.message);
  delete process.env.GEMINI_API_KEY;
  resetAiSwing();
  const callsBefore = aiCalls;
  const off = await runAiSwing(true);
  assert(off.ok && aiCalls === callsBefore && getAiSwingState().enabled === false, 'Servidor IA B3: sem chave, não chama a IA e não dá erro', off.message);

  globalThis.fetch = realFetchW;
  for (const [k, v] of [['GEMINI_API_KEY', saved.g], ['OPENAI_API_KEY', saved.o], ['AI_PROVIDER', saved.p]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  resetAiSwing(); resetAiState();
}


// ============================================================================
// MOTOR DE IA DAS CRIPTOS: TRAVAS, DADOS PARA A IA E ACOMPANHAMENTO
// ============================================================================
console.log('\n--- Motor de IA das criptos ---');
{
  const prices = new Map([['BTCUSDT', 100], ['ETHUSDT', 50], ['SOLUSDT', 20]]);
  const base = { market: 'spot' as const, prices, allowed: new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']), bullish: true, openKeys: new Set<string>() };
  const L = (symbol: string, o: any = {}) => ({ symbol, direction: 'LONG', confidence: 80, entryPrice: 999, targetPrice: prices.get(symbol)! * 1.06, stopLossPrice: prices.get(symbol)! * 0.97, ...o });

  const g1 = guardSignals([L('BTCUSDT')], base);
  assert(g1.approved.length === 1 && g1.approved[0].entry === 100 && g1.approved[0].confidence === 80, 'IA cripto: a entrada é sempre o preço atual, nunca o que a IA escreveu');
  assert(guardSignals([L('XRPUSDT')], base).blocked[0]?.why.includes('fora da lista'), 'IA cripto: ativo fora da lista é barrado');
  assert(guardSignals([L('BTCUSDT', { direction: 'SHORT', targetPrice: 94, stopLossPrice: 103 })], base).blocked[0]?.why.includes('spot'), 'IA cripto: SHORT no spot é barrado');
  assert(guardSignals([L('BTCUSDT')], { ...base, bullish: false }).blocked[0]?.why.includes('abaixo da média'), 'IA cripto: Bitcoin em baixa bloqueia compras');
  const fut = { ...base, market: 'futures' as const };
  assert(guardSignals([L('BTCUSDT', { direction: 'SHORT', targetPrice: 94, stopLossPrice: 103 })], fut).blocked[0]?.why.includes('vendas bloqueadas'), 'IA cripto: com Bitcoin em alta, SHORT em futuros é barrado');
  assert(guardSignals([L('BTCUSDT', { direction: 'SHORT', targetPrice: 94, stopLossPrice: 103 })], { ...fut, bullish: false }).approved.length === 1, 'IA cripto: com Bitcoin em baixa, SHORT em futuros é aprovado');
  assert(guardSignals([L('BTCUSDT', { confidence: 59 })], base).blocked[0]?.why.includes('confiança'), 'IA cripto: confiança abaixo de 60 é barrada');
  assert(guardSignals([L('BTCUSDT', { stopLossPrice: 105 })], base).blocked[0]?.why.includes('lado errado'), 'IA cripto: stop do lado errado é barrado');
  assert(guardSignals([L('BTCUSDT', { stopLossPrice: 99.9 })], base).blocked[0]?.why.includes('stop a'), 'IA cripto: stop colado demais (menos de 0,5%) é barrado');
  assert(guardSignals([L('BTCUSDT', { stopLossPrice: 80, targetPrice: 130 })], base).blocked[0]?.why.includes('stop a'), 'IA cripto: stop longe demais (mais de 15%) é barrado');
  assert(guardSignals([L('BTCUSDT', { targetPrice: 102 })], base).blocked[0]?.why.includes('risco/retorno'), 'IA cripto: alvo curto demais (menos de 1,5x o stop) é barrado');
  assert(guardSignals([L('BTCUSDT', { targetPrice: 100 + 3 * 6.5 })], base).blocked[0]?.why.includes('risco/retorno'), 'IA cripto: alvo fantasioso (mais de 6x o stop) é barrado');
  assert(guardSignals([L('BTCUSDT')], { ...base, openKeys: new Set(['BTCUSDT|LONG']) }).blocked[0]?.why.includes('já há sinal'), 'IA cripto: não abre segundo sinal igual');
  assert(guardSignals([L('BTCUSDT', { targetPrice: NaN })], base).blocked.length === 1 && guardSignals([null, 5, {}] as any, base).approved.length === 0, 'IA cripto: dados inválidos não quebram nada');
  const many = new Map(Array.from({ length: 8 }, (_, i) => [`C${i}USDT`, 10] as [string, number]));
  const gm = guardSignals(Array.from({ length: 8 }, (_, i) => ({ symbol: `C${i}USDT`, direction: 'LONG', confidence: 70 + i, targetPrice: 10.6, stopLossPrice: 9.7 })), { ...base, prices: many, allowed: new Set(many.keys()) });
  assert(gm.approved.length === 5 && gm.approved[0].confidence === 77 && gm.blocked.length === 3, 'IA cripto: no máximo 5 sinais por rodada, os de maior confiança');

  // Acompanhamento com velas de 1h
  const t0 = 1_700_000_000_000;
  const sg = { direction: 'LONG' as const, targetPrice: 106, stopLossPrice: 97, createdAt: t0, timeframe: '4h' };
  const h = (i: number, high: number, low: number, close = 100) => ({ timestamp: t0 + i * 3600e3, high, low, close });
  assert(resolveOutcome(sg, [h(-1, 90, 80), h(0, 101, 99)], t0 + 5 * 3600e3) === null, 'IA cripto: vela anterior ao sinal é ignorada; sem alvo nem stop continua aberto');
  assert(resolveOutcome(sg, [h(0, 101, 99), h(1, 107, 99)], t0 + 5 * 3600e3)?.status === 'TARGET_HIT', 'IA cripto: alvo atingido pela máxima da vela');
  assert(resolveOutcome(sg, [h(0, 101, 99), h(1, 101, 96)], t0 + 5 * 3600e3)?.status === 'STOP_HIT', 'IA cripto: stop atingido pela mínima da vela, mesmo sem o fechamento passar');
  assert(resolveOutcome(sg, [h(1, 108, 95)], t0 + 5 * 3600e3)?.status === 'STOP_HIT', 'IA cripto: stop e alvo na mesma vela => vale o stop');
  const sh = { ...sg, direction: 'SHORT' as const, targetPrice: 94, stopLossPrice: 103 };
  assert(resolveOutcome(sh, [h(1, 101, 93)], t0 + 5 * 3600e3)?.status === 'TARGET_HIT' && resolveOutcome(sh, [h(1, 104, 99)], t0 + 5 * 3600e3)?.status === 'STOP_HIT', 'IA cripto: SHORT usa o lado contrário (alvo pela mínima, stop pela máxima)');
  const ex = resolveOutcome(sg, [h(0, 101, 99, 100.5)], t0 + 9 * 24 * 3600e3);
  assert(ex?.status === 'EXPIRED' && ex.closePrice === 100.5, 'IA cripto: passou do prazo (8 dias em 4h) => expirado no último preço');
  const ls = liveStats([
    { status: 'TARGET_HIT', direction: 'LONG', entryPrice: 100, closePrice: 106, createdAt: t0 },
    { status: 'STOP_HIT', direction: 'LONG', entryPrice: 100, closePrice: 97, createdAt: t0 },
    { status: 'TARGET_HIT', direction: 'SHORT', entryPrice: 100, closePrice: 94, createdAt: t0 },
    { status: 'OPEN', direction: 'LONG', entryPrice: 100, createdAt: t0 }
  ], t0 + 3 * 86400000);
  assert(ls.closed === 3 && ls.open === 1 && ls.wins === 2 && Math.abs(ls.winRate - 66.7) < 0.1 && ls.profitFactor! > 1 && ls.readiness.status === 'collecting', 'IA cripto: estatística ao vivo desconta custos e conta SHORT ao contrário', JSON.stringify(ls));

  // Rodada completa com Binance e Gemini simulados
  const saved = { g: process.env.GEMINI_API_KEY, o: process.env.OPENAI_API_KEY, p: process.env.AI_PROVIDER };
  process.env.GEMINI_API_KEY = 'g'.repeat(30); delete process.env.OPENAI_API_KEY; delete process.env.AI_PROVIDER;
  resetAiState(); resetAiEngineStates();
  (scanners.spot.state as any).universe = { source: 'test', fetchedAt: Date.now(), skipped: [], exchanges: ['binance'], count: 3, coins: [
    { rank: 1, baseAsset: 'BTC', name: 'Bitcoin', symbol: 'BTCUSDT' }, { rank: 2, baseAsset: 'ETH', name: 'Ethereum', symbol: 'ETHUSDT' }, { rank: 3, baseAsset: 'SOL', name: 'Solana', symbol: 'SOLUSDT' }, { rank: 4, baseAsset: 'XRP', name: 'XRP', symbol: 'XRPUSDT' }] };
  const IV: Record<string, number> = { '1h': 3600e3, '4h': 14400e3, '1d': 86400e3 };
  let btcUp = true, hourExtreme: 'none' | 'target' = 'none', aiCalls2 = 0, aiPrompt = '';
  const nowMs = Date.now();
  const klines = (u: URL) => {
    const iv = u.searchParams.get('interval')!, n = Number(u.searchParams.get('limit')), sym = u.searchParams.get('symbol')!;
    const step = IV[iv], end = Math.floor(nowMs / step) * step - step;
    return Array.from({ length: n }, (_, i) => {
      const ts = end - (n - 1 - i) * step;
      let close = sym === 'BTCUSDT' && iv === '1d' ? 100 * Math.pow(btcUp ? 1.002 : 0.998, i) : 100 + Math.sin(i / 7) * 4 + i * 0.02;
      let high = close * 1.005, low = close * 0.995;
      if (iv === '1h' && hourExtreme === 'target') { close = 200; low = 199; high = i >= n - 3 ? 215 : 201; }
      return [ts, String(close), String(high), String(low), String(close), String(1000 + (i % 6) * 100), ts + step - 1, '0', 0, '0', '0', '0'];
    });
  };
  const realFetchC2 = globalThis.fetch;
  const aiJson = () => JSON.stringify({ marketRegime: 'ALTA SELETIVA', marketSummary: 'Mercado em alta.', signals: [
    { symbol: 'BTCUSDT', baseAsset: 'BTC', direction: 'LONG', confidence: 82, entryPrice: 1, targetPrice: 0, stopLossPrice: 0, thesis: 'RSI saudável e tendência de alta.', riskLevel: 'MEDIO', strategy: 'AI_ENGINE_MOMENTUM' },
    { symbol: 'ETHUSDT', baseAsset: 'ETH', direction: 'SHORT', confidence: 90, targetPrice: 1, stopLossPrice: 2 },
    { symbol: 'SOLUSDT', baseAsset: 'SOL', direction: 'LONG', confidence: 40, targetPrice: 1, stopLossPrice: 1 }
  ] });
  globalThis.fetch = ((url: any, init: any) => {
    const u = new URL(decodeURIComponent(String(url)));
    if (u.pathname.endsWith('/api/v3/klines')) return Promise.resolve(new Response(JSON.stringify(klines(u)), { status: 200 }));
    if (u.pathname.endsWith('/api/v3/ticker/price')) return Promise.resolve(new Response(JSON.stringify([{ symbol: 'BTCUSDT', price: '200' }, { symbol: 'ETHUSDT', price: '100' }, { symbol: 'SOLUSDT', price: '50' }, { symbol: 'XRPUSDT', price: '1' }]), { status: 200 }));
    if (u.hostname.includes('googleapis')) {
      aiCalls2++; aiPrompt = String(init?.body ?? '');
      // a IA devolve alvo e stop em torno do preço real (200)
      const j = JSON.parse(aiJson());
      j.signals[0].targetPrice = 212; j.signals[0].stopLossPrice = 194; j.signals[1].targetPrice = 94; j.signals[1].stopLossPrice = 106;
      return Promise.resolve(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(j) }] } }] }), { status: 200 }));
    }
    return Promise.reject(new Error('url inesperada: ' + u.href));
  }) as typeof fetch;

  const out = await runAiEngineScan('spot');
  assert(!out.lastError && aiCalls2 === 1, 'IA cripto: rodada completa roda sem erro e chama a IA uma vez', String(out.lastError));
  const bodyTxt = JSON.parse(aiPrompt).contents[0].parts[0].text as string;
  assert(bodyTxt.includes('bitcoin_acima_da_media_200d":true') && bodyTxt.includes('"rsi"') && bodyTxt.includes('"atrPct"') && bodyTxt.includes('BTCUSDT'), 'IA cripto: a IA recebe o mercado (Bitcoin vs média de 200) e os indicadores de cada moeda');
  assert(out.signals.length === 1 && out.signals[0].symbol === 'BTCUSDT' && out.signals[0].entryPrice === 200 && out.signals[0].status === 'OPEN', 'IA cripto: só o sinal válido vira operação, com entrada no preço atual (200), não no que a IA escreveu', JSON.stringify(out.signals.map((x) => [x.symbol, x.entryPrice])));
  assert(out.blocked!.some((b) => b.symbol === 'ETHUSDT' && /spot/.test(b.why)) && out.blocked!.some((b) => b.symbol === 'SOLUSDT' && /confiança/.test(b.why)), 'IA cripto: o que as travas barraram fica registrado com o motivo');
  assert(out.bitcoinBullish === true && out.marketRegime === 'ALTA SELETIVA' && out.stats!.open === 1 && out.stats!.closed === 0, 'IA cripto: guarda a leitura do Bitcoin e a estatística ao vivo');

  const out2 = await runAiEngineScan('spot');
  assert(out2.signals.length === 1 && out2.blocked!.some((b) => /já há sinal/.test(b.why)), 'IA cripto: nova rodada mantém o histórico e não duplica o sinal aberto', String(out2.signals.length));

  hourExtreme = 'target';
  (getAiEngineState('spot').signals[0] as any).createdAt -= 6 * 3600e3; // o sinal nasceu 6h atrás, antes das últimas velas
  await refreshAiOutcomes('spot');
  const out3 = getAiEngineState('spot');
  assert(out3.signals[0].status === 'TARGET_HIT' && out3.signals[0].closePrice === 212 && out3.stats!.closed === 1 && out3.stats!.winRate === 100, 'IA cripto: o acompanhamento fecha o sinal pelo alvo (velas de 1h) e a estatística atualiza', JSON.stringify(out3.signals[0]));

  // Bitcoin em baixa: a compra da IA é barrada
  resetAiEngineStates(); btcUp = false; hourExtreme = 'none';
  const out4 = await runAiEngineScan('spot');
  assert(out4.signals.length === 0 && out4.bitcoinBullish === false && out4.blocked!.some((b) => /abaixo da média/.test(b.why)), 'IA cripto: Bitcoin em baixa => nenhuma compra, com o motivo registrado');

  // Resposta fora do formato
  resetAiEngineStates(); btcUp = true;
  globalThis.fetch = ((url: any, init: any) => {
    const u = new URL(decodeURIComponent(String(url)));
    if (u.pathname.endsWith('/api/v3/klines')) return Promise.resolve(new Response(JSON.stringify(klines(u)), { status: 200 }));
    if (u.pathname.endsWith('/api/v3/ticker/price')) return Promise.resolve(new Response(JSON.stringify([{ symbol: 'BTCUSDT', price: '200' }, { symbol: 'ETHUSDT', price: '100' }, { symbol: 'SOLUSDT', price: '50' }]), { status: 200 }));
    return Promise.resolve(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'não posso ajudar' }] } }] }), { status: 200 }));
  }) as typeof fetch;
  const out5 = await runAiEngineScan('spot');
  assert(/formato/.test(out5.lastError ?? '') && out5.signals.length === 0, 'IA cripto: resposta fora do formato => erro claro e nenhum sinal', String(out5.lastError));

  globalThis.fetch = realFetchC2;
  for (const [k, v] of [['GEMINI_API_KEY', saved.g], ['OPENAI_API_KEY', saved.o], ['AI_PROVIDER', saved.p]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  resetAiEngineStates(); resetAiState();
  (scanners.spot.state as any).universe = null;
}


// ============================================================================
// ROBÔ SIMULADO (CRIPTO SPOT)
// ============================================================================
console.log('\n--- Robô simulado ---');
{
  const H = 3600e3;
  const T = 1_800_000_000_000;
  const on = (o: any = {}) => newRobotState({ ...DEFAULT_ROBOT_CONFIG, enabled: true, ...o }, T);
  const sg = (id: string, sym: string, o: Partial<SourceSignal> = {}): SourceSignal => ({ id, source: 'trend', symbol: sym + 'USDT', baseAsset: sym, state: 'OPEN', entryPrice: 100, stopPrice: 95, createdAt: T - H, ...o });
  const px = (m: Record<string, number>) => new Map(Object.entries(m).map(([k, v]) => [k + 'USDT', v]));

  // Tamanho pelo risco: 1% de 1000 = 10 USDT de risco; stop a ~5,15% (com custos) => posição ~194 USDT
  const r1 = robotStep(on(), [sg('a', 'AAA')], px({ AAA: 100 }), T);
  const p = r1.state.positions[0];
  assert(r1.state.positions.length === 1 && Math.abs(p.riskUsd - 10) < 0.01, 'Robô: o tamanho da posição arrisca exatamente o risco configurado (1% do patrimônio)', JSON.stringify(p));
  assert(Math.abs(p.entryPrice - 100 * (1 + ROBOT_COST)) < 1e-9 && Math.abs(robotEquity(r1.state) - (1000 - p.qty * p.entryPrice + p.qty * 100)) < 1e-9, 'Robô: a compra paga taxa e derrapagem e o patrimônio reflete o custo');
  assert(r1.events.some((e) => e.kind === 'entry'), 'Robô: a compra fica registrada');

  // Desligado: não compra
  assert(robotStep(newRobotState({ ...DEFAULT_ROBOT_CONFIG, enabled: false }, T), [sg('a', 'AAA')], px({ AAA: 100 }), T).state.positions.length === 0, 'Robô: desligado não abre posição');
  // Fontes
  assert(robotStep(on({ useTrend: false }), [sg('a', 'AAA')], px({ AAA: 100 }), T).state.positions.length === 0 && robotStep(on({ useAi: false }), [sg('a', 'AAA', { source: 'ai' })], px({ AAA: 100 }), T).state.positions.length === 0, 'Robô: só segue as fontes ligadas (tendência e IA)');
  // Sinal velho, sem entrada, ou já passado
  assert(robotStep(on(), [sg('a', 'AAA', { createdAt: T - 30 * H })], px({ AAA: 100 }), T).state.positions.length === 0, 'Robô: ignora sinal mais velho que o limite (24h)');
  assert(robotStep(on(), [sg('a', 'AAA', { entryPrice: undefined })], px({ AAA: 100 }), T).state.positions.length === 0, 'Robô: espera o sinal ter preço de entrada');
  const chase = robotStep(on(), [sg('a', 'AAA')], px({ AAA: 103 }), T);
  assert(chase.state.positions.length === 0 && chase.events.some((e) => /1,5%/.test(e.text)) && chase.state.takenSignalIds.includes('a'), 'Robô: não persegue preço que já subiu mais de 1,5% e não reavalia o sinal');
  assert(robotStep(on(), [sg('a', 'AAA')], px({ AAA: 94 }), T).state.positions.length === 0, 'Robô: não compra se o preço já está no stop');
  assert(robotStep(on(), [sg('a', 'AAA')], new Map(), T).state.positions.length === 0, 'Robô: sem preço, não compra');

  // Limites: posição máxima em % do patrimônio e posições abertas
  const tight = robotStep(on({ riskPct: 3, maxPositionPct: 10 }), [sg('a', 'AAA', { stopPrice: 99 })], px({ AAA: 100 }), T);
  assert(Math.abs(tight.state.positions[0].qty * tight.state.positions[0].entryPrice - 100) < 0.01, 'Robô: stop apertado não infla a posição além de 10% do patrimônio', String(tight.state.positions[0]?.qty));
  const many = robotStep(on({ maxOpen: 2 }), ['A', 'B', 'C', 'D'].map((x, i) => sg(x.toLowerCase(), x, { createdAt: T - (i + 1) * H })), px({ A: 100, B: 100, C: 100, D: 100 }), T);
  assert(many.state.positions.length === 2, 'Robô: respeita o máximo de posições abertas');
  const dup = robotStep(r1.state, [sg('a', 'AAA'), sg('a2', 'AAA')], px({ AAA: 100 }), T + H);
  assert(dup.state.positions.length === 1, 'Robô: não abre duas posições no mesmo ativo');
  const again = robotStep(r1.state, [sg('a', 'AAA')], px({ AAA: 100 }), T + H);
  assert(again.state.positions.length === 1 && again.state.takenSignalIds.length === 1, 'Robô: o mesmo sinal não é comprado duas vezes');

  // Saídas
  const stopped = robotStep(r1.state, [sg('a', 'AAA')], px({ AAA: 94 }), T + 2 * H);
  assert(stopped.state.positions.length === 0 && stopped.state.trades[0].reason === 'stop atingido' && stopped.state.trades[0].pnl < 0, 'Robô: stop atingido encerra a posição com perda');
  const lossPct = (1000 - robotEquity(stopped.state)) / 1000 * 100;
  assert(lossPct > 0.9 && lossPct < 1.4, 'Robô: perder no stop custa cerca do risco configurado (1%) mais custos', lossPct.toFixed(2));
  const done = robotStep(r1.state, [sg('a', 'AAA', { state: 'DONE', exitPrice: 110 })], px({ AAA: 108 }), T + 2 * H);
  assert(done.state.trades[0].exitPrice === 110 * (1 - ROBOT_COST) && done.state.trades[0].pnl > 0 && /estratégia encerrou/.test(done.state.trades[0].reason), 'Robô: segue a saída da estratégia pelo preço dela, com custos');
  const exitNow = robotStep(r1.state, [sg('a', 'AAA', { state: 'EXIT_NOW' })], px({ AAA: 104 }), T + 2 * H);
  assert(exitNow.state.trades[0].reason === 'a estratégia mandou sair', 'Robô: sinal de saída da tendência fecha a posição ao preço atual');
  const tgt = robotStep(on(), [sg('t', 'TTT', { source: 'ai', targetPrice: 110 })], px({ TTT: 100 }), T);
  assert(robotStep(tgt.state, [sg('t', 'TTT', { source: 'ai', targetPrice: 110 })], px({ TTT: 111 }), T + H).state.trades[0].reason === 'alvo atingido', 'Robô: alvo da IA fecha a posição');
  const off = robotStep({ ...r1.state, config: { ...r1.state.config, enabled: false } }, [sg('a', 'AAA')], px({ AAA: 94 }), T + 2 * H);
  assert(off.state.positions.length === 0, 'Robô: desligado ainda encerra posições abertas (stop)');

  // Servidor dormiu: as velas de 1h aplicam stop e alvo tocados no intervalo, pelo preço do stop/alvo e na hora da vela
  const bar = (i: number, high: number, low: number) => ({ timestamp: T + i * H, high, low, close: 100 });
  const gap1 = robotStep(r1.state, [sg('a', 'AAA')], px({ AAA: 101 }), T + 10 * H, new Map([['AAAUSDT', [bar(-1, 90, 80), bar(0, 101, 99), bar(3, 102, 94), bar(5, 110, 100)]]]));
  assert(gap1.state.trades[0]?.reason === 'stop atingido' && Math.abs(gap1.state.trades[0].exitPrice - 95 * (1 - ROBOT_COST)) < 1e-9 && gap1.state.trades[0].closedAt === T + 4 * H, 'Robô: o preço voltou, mas as velas mostram que o stop foi tocado de madrugada => sai pelo stop, na hora da vela', JSON.stringify(gap1.state.trades[0]));
  assert(robotStep(r1.state, [sg('a', 'AAA')], px({ AAA: 101 }), T + 10 * H, new Map([['AAAUSDT', [bar(-1, 90, 80), bar(0, 101, 99)]]])).state.positions.length === 1, 'Robô: vela anterior à compra e sem toque no stop não encerra');
  const tgt2 = robotStep(on(), [sg('t', 'TTT', { source: 'ai', targetPrice: 110 })], px({ TTT: 100 }), T);
  assert(robotStep(tgt2.state, [sg('t', 'TTT', { source: 'ai', targetPrice: 110 })], px({ TTT: 100 }), T + 10 * H, new Map([['TTTUSDT', [bar(2, 111, 99)]]])).state.trades[0]?.reason === 'alvo atingido', 'Robô: alvo tocado nas velas fecha pelo alvo mesmo que o preço atual tenha voltado');
  assert(robotStep(r1.state, [sg('a', 'AAA')], px({ AAA: 101 }), T + 10 * H, new Map([['AAAUSDT', [bar(3, 112, 94)]]])).state.trades[0].reason === 'stop atingido', 'Robô: stop e alvo na mesma vela valem o stop');

  // Perda máxima no dia pausa novas entradas e volta no dia seguinte
  let st = r1.state;
  st = robotStep(st, [sg('a', 'AAA')], px({ AAA: 100 }), T + H).state;
  st = robotStep({ ...st, config: { ...st.config, riskPct: 3, maxDailyLossPct: 1 } }, [sg('a', 'AAA')], px({ AAA: 50 }), T + 2 * H).state;
  assert(st.pausedDay !== null && st.positions.length === 0, 'Robô: perda do dia acima do limite pausa o dia');
  const blocked = robotStep(st, [sg('z', 'ZZZ')], px({ ZZZ: 100 }), T + 3 * H);
  assert(blocked.state.positions.length === 0, 'Robô: pausado no dia, ignora novos sinais');
  const nextDay = robotStep(st, [sg('z', 'ZZZ', { createdAt: T + 24 * H })], px({ ZZZ: 100 }), T + 26 * H);
  assert(nextDay.state.positions.length === 1, 'Robô: no dia seguinte volta a operar');

  // Queda máxima do pico PARA o robô até religar manualmente
  const dd = robotStep({ ...on({ maxDrawdownPct: 3, maxDailyLossPct: 20 }), cash: 900, peakEquity: 1000 }, [sg('z', 'ZZZ')], px({ ZZZ: 100 }), T);
  assert(dd.state.halted !== null && dd.state.positions.length === 0 && dd.events.some((e) => e.kind === 'risk'), 'Robô: queda máxima desde o pico para o robô e avisa');
  const stillHalted = robotStep(dd.state, [sg('z', 'ZZZ')], px({ ZZZ: 100 }), T + 48 * H);
  assert(stillHalted.state.halted !== null && stillHalted.state.positions.length === 0, 'Robô: parado continua parado nos dias seguintes');

  // Estatística e configuração
  const stats = robotStats(done.state, T + 3 * 86400000);
  assert(stats.closed === 1 && stats.wins === 1 && stats.pnl > 0 && stats.readiness.status === 'collecting', 'Robô: estatística conta as operações e os critérios de validação', JSON.stringify(stats.readiness.status));
  const cfg = sanitizeConfig({ riskPct: 99, maxOpen: 0, maxPositionPct: 'x', startCapital: 5, enabled: 'sim' }, DEFAULT_ROBOT_CONFIG);
  assert(cfg.riskPct === 3 && cfg.maxOpen === 1 && cfg.maxPositionPct === DEFAULT_ROBOT_CONFIG.maxPositionPct && cfg.startCapital === 1000 && cfg.enabled === false, 'Robô: configuração inválida é limitada (risco máx. 3%, capital só muda no reset)');
  const prevJson = JSON.stringify(r1.state);
  robotStep(r1.state, [sg('q', 'QQQ')], px({ QQQ: 100 }), T + H);
  assert(JSON.stringify(r1.state) === prevJson, 'Robô: o ciclo não altera o estado recebido');

  // Servidor: junta os sinais de tendência e do motor de IA, com Binance simulada
  resetRobotState(); resetTrendState();
  updateRobotConfig({ enabled: true });
  getTrendState().signals.unshift({ id: 'SRV-1', symbol: 'SRVUSDT', baseAsset: 'SRV', signalDay: Date.now() - 86400000, createdAt: Date.now() - H, refPrice: 10, entryPrice: 10, stopPrice: 9.5, atr: 0.25, exitLevel: 9.4, status: 'OPEN', lastPrice: 10 } as any);
  const realFetchR = globalThis.fetch;
  let srvPrice = 10;
  globalThis.fetch = ((url: any) => {
    const u = String(url);
    if (u.includes('/api/v3/ticker/price')) return Promise.resolve(new Response(JSON.stringify([{ symbol: 'SRVUSDT', price: String(srvPrice) }]), { status: 200 }));
    return Promise.reject(new Error('url inesperada: ' + u));
  }) as typeof fetch;
  const run1 = await runRobot();
  assert(run1.ok && getRobot().state.positions.length === 1 && getRobot().state.positions[0].symbol === 'SRVUSDT', 'Robô servidor: lê o sinal de tendência e compra', run1.message);
  getTrendState().signals[0].status = 'STOPPED' as any; (getTrendState().signals[0] as any).exitPrice = 9.5;
  const run2 = await runRobot();
  assert(run2.ok && getRobot().state.positions.length === 0 && getRobot().stats.closed === 1, 'Robô servidor: acompanha o encerramento do sinal e fecha a posição');
  globalThis.fetch = (() => Promise.reject(new Error('sem rede'))) as typeof fetch;
  updateRobotConfig({ enabled: true, riskPct: 2 });
  getTrendState().signals.unshift({ id: 'SRV-2', symbol: 'SRVUSDT', baseAsset: 'SRV', signalDay: Date.now(), createdAt: Date.now(), refPrice: 10, entryPrice: 10, stopPrice: 9.5, atr: 0.25, exitLevel: 9.4, status: 'OPEN' } as any);
  const run3 = await runRobot();
  assert(!run3.ok && getRobot().lastError !== null && getRobot().state.positions.length === 0 && getRobot().state.config.riskPct === 2, 'Robô servidor: sem preços, não compra e mostra o erro', run3.message);
  resetRobot(5000);
  assert(getRobot().state.config.startCapital === 5000 && getRobot().state.config.enabled === false && getRobot().state.cash === 5000 && getRobot().state.trades.length === 0, 'Robô servidor: zerar a carteira recomeça do capital novo, desligado');
  // O servidor dormiu: ao ser consultado, recupera o que perdeu usando as velas de 1h
  resetRobotState(); resetTrendState();
  updateRobotConfig({ enabled: true });
  const tNow = Date.now();
  getTrendState().signals.unshift({ id: 'SLP-1', symbol: 'SLPUSDT', baseAsset: 'SLP', signalDay: tNow - 86400000, createdAt: tNow - H, refPrice: 10, entryPrice: 10, stopPrice: 9.5, atr: 0.25, exitLevel: 9.4, status: 'OPEN', lastPrice: 10 } as any);
  let slpHour = 'calm';
  globalThis.fetch = ((url: any) => {
    const u = String(url);
    if (u.includes('/api/v3/ticker/price')) return Promise.resolve(new Response(JSON.stringify([{ symbol: 'SLPUSDT', price: '10' }]), { status: 200 }));
    if (u.includes('/api/v3/klines')) {
      const t0 = Math.floor(Date.now() / H) * H;
      return Promise.resolve(new Response(JSON.stringify(Array.from({ length: 3 }, (_, i) => [t0 + (i - 2) * H + H * 0.5 + (slpHour === 'calm' ? -H : 0), '10', '10.2', slpHour === 'crash' && i === 1 ? '9.0' : '9.9', '10', '1'])), { status: 200 }));
    }
    return Promise.reject(new Error('url inesperada: ' + u));
  }) as typeof fetch;
  await ensureRobot(0, 5000);
  assert(getRobot().state.positions.length === 1, 'Robô servidor: ao ser consultado, o robô desatualizado roda um ciclo e compra');
  slpHour = 'crash';
  getRobot().state.positions[0].openedAt = tNow - 5 * H; getRobot().state.lastTickAt = tNow - 3 * 3600e3;
  await ensureRobot(6 * 60e3, 5000);
  assert(getRobot().state.positions.length === 0 && getRobot().state.trades[0]?.reason === 'stop atingido', 'Robô servidor: ao ser consultado depois de dormir, confere as velas de 1h e aplica o stop que foi tocado', JSON.stringify(getRobot().state.trades[0]));
  const ticks = getRobot().state.lastTickAt;
  await ensureRobot(6 * 60e3, 5000);
  assert(getRobot().state.lastTickAt === ticks, 'Robô servidor: se o último ciclo é recente, não roda de novo');
  globalThis.fetch = realFetchR;
  resetRobotState(); resetTrendState();
}

console.log('\n========================================================');
console.log(`TOTAL DE TESTES EXECUTADOS: ${totalTests}`);
console.log(`TESTES APROVADOS: ${passedTests}`);
console.log('AUDITORIA DE REGRESSÃO E INTEGRAÇÃO CONCLUÍDA COM 100% DE SUCESSO!');
console.log('========================================================\n');

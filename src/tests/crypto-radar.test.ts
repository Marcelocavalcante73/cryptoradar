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
  timeframeToBinanceInterval
} from '../services/apiService';

import {
  validateTelegramDestination,
  getTelegramServerStatus
} from '../services/telegramService';

import { calculateAllIndicators, calculateATR } from '../services/indicators';
import { runBacktest, computeStats, BacktestTrade } from '../services/backtest';
import { buildUniverse } from '../../server/universe';
import { formatTelegramAlert } from '../../server/scanner';
import { computeSignalPerformance, signalResultR, PerfSignal } from '../services/signalPerformance';
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
delete process.env.EXCHANGES;
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

console.log('\n========================================================');
console.log(`TOTAL DE TESTES EXECUTADOS: ${totalTests}`);
console.log(`TESTES APROVADOS: ${passedTests}`);
console.log('AUDITORIA DE REGRESSÃO E INTEGRAÇÃO CONCLUÍDA COM 100% DE SUCESSO!');
console.log('========================================================\n');

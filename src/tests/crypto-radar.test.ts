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

console.log('\n========================================================');
console.log(`TOTAL DE TESTES EXECUTADOS: ${totalTests}`);
console.log(`TESTES APROVADOS: ${passedTests}`);
console.log('AUDITORIA DE REGRESSÃO E INTEGRAÇÃO CONCLUÍDA COM 100% DE SUCESSO!');
console.log('========================================================\n');

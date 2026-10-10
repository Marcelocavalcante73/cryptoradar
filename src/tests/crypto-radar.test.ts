/**
 * Suíte de Testes Automatizados e Auditoria Técnica - CryptoRadar
 * Executa as funções reais de negócio da aplicação:
 * - Indicadores Wilder's RSI, EMA e MACD com vetores de referência conhecidos e aquecimento
 * - Contabilidade de Paper Trading: saldo disponível, margem reservada, nocional, alavancagem, taxas e patrimônio total
 * - Ordens MARKET e LIMIT, cancelamento, Stop-Loss, Take-Profit e preço ausente
 * - Transparência de conectores Binance e Bybit
 * - Alertas sonoros e validação segura de Telegram
 */

import {
  calculateWilderRSI,
  calculateEMA,
  calculateMACD,
  calculateFearGreedIndex
} from '../services/indicators';

import {
  createTradeOrder,
  cancelPendingOrder,
  closeOpenPosition,
  evaluateTriggers,
  calculateAccountMetrics,
  TRADING_FEE_RATE
} from '../services/paperTradingService';

import { apiService } from '../services/apiService';
import { maskTelegramToken, isValidTokenFormat, sendTelegramTestMessage } from '../services/telegramService';
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
// Day 1 a 15:
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
console.log('2. AUDITORIA DE EMA E MACD (AQUECIMENTO E VALORES)');
console.log('========================================================');

// 2.1 EMA 20: warm-up e inicialização via SMA
const prices30 = Array.from({ length: 30 }, (_, i) => 100 + i);
const emaCandles = calculateEMA(createCandles(prices30), 20, 2);
assert(emaCandles[0].ema20 === undefined, 'Vela 0 da EMA20 está em warm-up (undefined)');
assert(emaCandles[18].ema20 === undefined, 'Vela 18 (< 20) está em warm-up (undefined)');
// No índice 19 (20 velas), EMA inicial é a média de 100 a 119 = 109.50
assert(emaCandles[19].ema20 === 109.5, 'Vela 19 inicializa EMA20 com a SMA dos primeiros 20 períodos (109.50)');
assert(emaCandles[29].ema20 !== undefined && emaCandles[29].ema20! > 109.5, 'Velas subsequentes aplicam suavização exponencial k=2/21');

// 2.2 MACD: exige 34 períodos para aquecimento completo (26 da EMA lenta + 9 do sinal - 1)
const prices50 = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i) * 5);
const macdCandles = calculateMACD(createCandles(prices50), 12, 26, 9, 2);
assert(macdCandles[0].macd === undefined, 'Vela 0 do MACD está em warm-up (undefined)');
assert(macdCandles[32].macd === undefined, 'Vela 32 (< 34) do MACD está em warm-up (undefined)');
assert(macdCandles[33].macd !== undefined, 'Vela 33 possui MACD completamente inicializado');
assert(
  macdCandles[33].macd!.histogram === Number((macdCandles[33].macd!.macd - macdCandles[33].macd!.signal).toFixed(2)),
  'Histograma do MACD é rigorosamente igual a (Linha MACD - Linha de Sinal)'
);

console.log('\n========================================================');
console.log('3. AUDITORIA CONTÁBIL REAL DO PAPER TRADING SERVICE');
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

// Teste 3.1: Tentativa com saldo insuficiente
const invalidOrder = createTradeOrder(testAccount, {
  symbol: 'BTCUSDT',
  direction: 'LONG',
  orderType: 'MARKET',
  entryPrice: 60000,
  currentPrice: 60000,
  investedUSDT: 15000, // Maior que saldo disponível
  leverage: 1
});
assert(!invalidOrder.success, 'Ordem que excede o saldo disponível é rejeitada');
assert(testAccount.virtualBalance === 10000.00, 'Saldo disponível permanece intacto após rejeição');

// Teste 3.2: Ordem MARKET LONG com alavancagem 2x
// Investe $2,000 com alavancagem 2x a $50,000/BTC
// Nocional = 4,000 USDT. Quantidade = 0.08 BTC.
// Taxa de abertura (0.05%) = 4,000 * 0.0005 = $2.00 USDT.
// Total retido = 2,000 + 2.00 = 2,002.00 USDT.
const marketLong = createTradeOrder(testAccount, {
  symbol: 'BTCUSDT',
  direction: 'LONG',
  orderType: 'MARKET',
  entryPrice: 50000,
  currentPrice: 50000,
  investedUSDT: 2000,
  leverage: 2,
  targetPrice: 55000,
  stopLossPrice: 47500
});

assert(marketLong.success, 'Ordem MARKET LONG criada com sucesso');
testAccount = marketLong.account;
assert(testAccount.virtualBalance === 7998.00, 'Saldo livre deduz margem investida + taxa de abertura ($7,998.00)');
assert(testAccount.totalFeesPaid === 2.00, 'Taxa de abertura registrada em totalFeesPaid ($2.00)');
assert(testAccount.totalTrades === 1, 'Operação a mercado incrementa totalTrades para 1');
assert(marketLong.position!.status === 'OPEN', 'Status da ordem a mercado é OPEN');
assert(marketLong.position!.amount === 0.08, 'Quantidade da moeda calculada com alavancagem: 0.08 BTC');

// Teste 3.3: Auditoria do Patrimônio Total (Total Equity) sem perda de margem
// Imediatamente após a abertura, o preço é o mesmo ($50,000).
// Margem investida = $2,000. Taxa de saída estimada = $2.00.
// Liquidação imediata retornaria: $2,000 - $2.00 = $1,998.00.
// Patrimônio total = Saldo Livre ($7,998) + Liquidação ($1,998) = $9,996.00 (exatamente os $10,000 menos as duas taxas de $2).
const metricsImmediate = calculateAccountMetrics(testAccount, [
  { symbol: 'BTCUSDT', price: 50000 } as CryptoAsset
]);
assert(
  metricsImmediate.totalEquity === 9996.00,
  'Patrimônio Total preserva a margem e deduz taxas sem dupla tributação ($9,996.00)',
  `Obtido: ${metricsImmediate.totalEquity}`
);
assert(metricsImmediate.openPositionsMargin === 2000.00, 'Margem reservada em abertas é $2,000.00');

// Teste 3.4: Ordem LIMIT LONG pendente
// Preço atual é $50,000. Limite estipulado em $45,000.
// Investe $1,000 com alavancagem 1x. Taxa reservada = 1,000 * 0.0005 = $0.50.
const limitLong = createTradeOrder(testAccount, {
  symbol: 'BTCUSDT',
  direction: 'LONG',
  orderType: 'LIMIT',
  entryPrice: 45000,
  currentPrice: 50000,
  limitPrice: 45000,
  investedUSDT: 1000,
  leverage: 1
});
assert(limitLong.success, 'Ordem LIMIT criada com sucesso');
testAccount = limitLong.account;
assert(limitLong.position!.status === 'PENDING', 'Ordem LIMIT inicia como PENDING');
assert(testAccount.totalTrades === 1, 'Ordem LIMIT pendente NÃO incrementa totalTrades prematuramente');
assert(testAccount.virtualBalance === 6997.50, 'Saldo livre retém margem e taxa da ordem pendente ($6,997.50)');

// Teste 3.5: Cancelamento de Ordem LIMIT Pendente com devolução integral
const cancelRes = cancelPendingOrder(testAccount, limitLong.position!.id);
assert(cancelRes.success, 'Cancelamento da ordem pendente realizado');
testAccount = cancelRes.account;
assert(testAccount.virtualBalance === 7998.00, 'Saldo livre restaurado integralmente após cancelamento ($7,998.00)');
assert(testAccount.totalFeesPaid === 2.00, 'Taxa reservada não realizada é estornada de totalFeesPaid ($2.00)');
assert(cancelRes.position!.closeReason === 'CANCELLED', 'Motivo de encerramento registrado como CANCELLED');

// Métricas de taxa de acerto com ordem cancelada no histórico:
const metricsAfterCancel = calculateAccountMetrics(testAccount, [
  { symbol: 'BTCUSDT', price: 50000 } as CryptoAsset
]);
assert(metricsAfterCancel.totalExecutedTrades === 0, 'Ordem cancelada não conta como trade finalizado');
assert(metricsAfterCancel.winRatePercent === 0, 'Ordem cancelada não afeta taxa de acerto negativamente');

console.log('\n========================================================');
console.log('4. AUDITORIA DE TAKE-PROFIT, STOP-LOSS E PREÇOS AUSENTES');
console.log('========================================================');

// Teste 4.1: Preço ausente durante avaliação de gatilhos
// Se o ativo BTCUSDT não estiver no feed de cotações, a posição deve permanecer intacta
const triggerMissing = evaluateTriggers(testAccount, [
  { symbol: 'ETHUSDT', price: 3000 } as CryptoAsset // Apenas ETH na lista
]);
assert(triggerMissing.account.positions.length === 1, 'Posição mantida sem alterações quando preço está ausente');
assert(triggerMissing.triggeredOrders.length === 0, 'Nenhum gatilho disparado para preço ausente');

// Teste 4.2: Take-Profit acionado com sucesso (Cenário de Lucro)
// Posição LONG aberta a $50,000, alvo TP em $55,000.
// Cotação atinge $55,200.
const triggerTP = evaluateTriggers(testAccount, [
  { symbol: 'BTCUSDT', price: 55200 } as CryptoAsset
]);
assert(triggerTP.triggeredOrders.length === 1, 'Gatilho de Take-Profit acionado');
assert(triggerTP.triggeredOrders[0].type === 'TAKE_PROFIT', 'Tipo do gatilho é TAKE_PROFIT');
assert(triggerTP.account.positions.length === 0, 'Posição foi encerrada e removida das abertas');

testAccount = triggerTP.account;
const closedTrade = testAccount.closedHistory[0];
assert(closedTrade.closeReason === 'TAKE_PROFIT', 'Histórico registra fechamento por TAKE_PROFIT');

// Validação matemática do PnL do Take-Profit:
// Entrada: $50,000, Saída: $55,000 (preço do TP).
// Variação: +10%. Alavancagem: 2x => +20%.
// Lucro bruto: 2,000 * 20% = +$400.00.
// Taxa de abertura já paga: $2.00.
// Taxa de fechamento: (0.08 * 55,000) * 0.0005 = 4,400 * 0.0005 = $2.20.
// PnL Líquido Realizado: 400 - 2.00 - 2.20 = $395.80.
assert(closedTrade.realizedPnl === 395.80, `PnL líquido no TP confere com precisão: $395.80 (obtido: ${closedTrade.realizedPnl})`);
assert(testAccount.winTrades === 1, 'Operação vencedora contabilizada');
assert(testAccount.lossTrades === 0, 'Zero operações perdedoras');

// Saldo final após TP:
// Dinheiro devolvido: 2,000 + 400 - 2.20 = 2,397.80.
// Saldo antes era 7,998.00 => Novo saldo = 7,998.00 + 2,397.80 = 10,395.80.
assert(testAccount.virtualBalance === 10395.80, `Saldo livre após TP reflete exatamente o lucro líquido ($10,395.80)`);

// Teste 4.3: Cenário de Prejuízo (Stop-Loss)
// Abre nova posição SHORT com stop loss
const shortTrade = createTradeOrder(testAccount, {
  symbol: 'ETHUSDT',
  direction: 'SHORT',
  orderType: 'MARKET',
  entryPrice: 3000,
  currentPrice: 3000,
  investedUSDT: 1000,
  leverage: 1,
  targetPrice: 2700,
  stopLossPrice: 3150 // +5% de alta = perda em SHORT
});
testAccount = shortTrade.account;

// Cotação sobe para $3,160 atingindo o Stop-Loss
const triggerSL = evaluateTriggers(testAccount, [
  { symbol: 'ETHUSDT', price: 3160 } as CryptoAsset
]);
assert(triggerSL.triggeredOrders.length === 1, 'Gatilho de Stop-Loss acionado');
assert(triggerSL.triggeredOrders[0].type === 'STOP_LOSS', 'Tipo do gatilho é STOP_LOSS');
testAccount = triggerSL.account;

const closedLoss = testAccount.closedHistory[0];
// Entrada: 3,000, Saída: 3,150. Variação SHORT: -5%.
// Lucro bruto: -$50.00.
// Taxa de abertura: 1,000 * 0.0005 = $0.50.
// Qtd: 1,000 / 3,000 = 0.33333 ETH. Nocional saída = 0.33333 * 3,150 = 1,050.
// Taxa de fechamento: 1,050 * 0.0005 = $0.525 -> $0.53.
// PnL Líquido: -50 - 0.50 - 0.53 = -$51.03.
assert(closedLoss.realizedPnl! < 0, 'PnL de Stop-Loss é negativo');
assert(testAccount.lossTrades === 1, 'Operação perdedora contabilizada');

const finalMetrics = calculateAccountMetrics(testAccount, []);
assert(finalMetrics.winTrades === 1, '1 vitória');
assert(finalMetrics.lossTrades === 1, '1 derrota');
assert(finalMetrics.winRatePercent === 50.0, 'Taxa de acerto de 50.0% para 1 vitória e 1 derrota');

console.log('\n========================================================');
console.log('5. AUDITORIA DE FEAR & GREED E CONECTORES');
console.log('========================================================');

const emptySentiment = calculateFearGreedIndex([]);
assert(emptySentiment.score === 50 && emptySentiment.label === 'Neutro', 'Sentimento sem ativos é Neutro 50');

const bullishSentiment = calculateFearGreedIndex([
  { symbol: 'BTCUSDT', change24h: 7.5, high24h: 66000, low24h: 61000, price: 65800 } as CryptoAsset,
  { symbol: 'ETHUSDT', change24h: 6.0, high24h: 3600, low24h: 3300, price: 3580 } as CryptoAsset
]);
assert(bullishSentiment.score >= 70, `Sentimento de alta computa ganância (score: ${bullishSentiment.score})`);

// Auditoria de Status da Bybit
const exchangeStatuses = await apiService.checkExchangeHealth();
assert(exchangeStatuses.bybit.isImplemented === false, 'Conector Bybit declara explicitamente isImplemented = false');
assert(exchangeStatuses.bybit.status === 'NOT_IMPLEMENTED', 'Status da Bybit é rigorosamente NOT_IMPLEMENTED');

console.log('\n========================================================');
console.log('6. AUDITORIA DE MÁSCARA DE CREDENCIAIS E TELEGRAM');
console.log('========================================================');

assert(maskTelegramToken('123456789:ABCdefGHIjklMNOpqr') === '1234...Opqr', 'Mascara de token oculta credenciais intermediárias');
assert(!isValidTokenFormat('712345678:AAH...exemplo'), 'Placeholder do Telegram é rejeitado na validação de formato');

const telegramPlaceholderResult = await sendTelegramTestMessage('712345678:AAH...exemplo', '@meuchat');
assert(!telegramPlaceholderResult.success, 'Envio com placeholder não simula sucesso falso');
assert(telegramPlaceholderResult.message.includes('inválido') || telegramPlaceholderResult.message.includes('real'), 'Mensagem alerta para necessidade de token real');

console.log('\n========================================================');
console.log(`TOTAL DE TESTES EXECUTADOS: ${totalTests}`);
console.log(`TESTES APROVADOS: ${passedTests}`);
console.log('AUDITORIA TÉCNICA E FUNCIONAL CONCLUÍDA COM 100% DE SUCESSO!');
console.log('========================================================\n');

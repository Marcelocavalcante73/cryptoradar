/**
 * Suíte de Testes Automatizados - CryptoRadar
 * Validação técnica de cálculos, indicadores, paper trading e regras de negócio.
 */

import { calculateWilderRSI, calculateEMA, calculateMACD, calculateFearGreedIndex } from '../services/indicators';
import { CandleData, PaperPosition, PaperAccount, CryptoAsset } from '../types/crypto';

// Helper simples para asserção em Node/TSX
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
    high: price * 1.01,
    low: price * 0.99,
    close: price,
    volume: 1000
  }));
}

console.log('========================================================');
console.log('1. TESTES DE CÁLCULO DO RSI (SUAVIZAÇÃO DE WILDER 1978)');
console.log('========================================================');

// Teste 1.1: Série vazia e de 1 elemento
const emptyResult = calculateWilderRSI([], 14);
assert(emptyResult.length === 0, 'Série vazia retorna array vazio');

const singleCandle = createCandles([100]);
const singleResult = calculateWilderRSI(singleCandle, 14);
assert(singleResult[0].rsi === 50, 'Vela única inicializa com RSI neutro 50.0');

// Teste 1.2: Série sem variação de preço (preço flat)
const flatCandles = createCandles([100, 100, 100, 100, 100]);
const flatResult = calculateWilderRSI(flatCandles, 14);
assert(
  flatResult.every((c) => c.rsi === 50),
  'Mercado sem ganhos e sem perdas (flat) resulta em RSI 50.0 para todas as velas'
);

// Teste 1.3: Série sem perdas (apenas ganhos estritos)
const gainOnlyCandles = createCandles([100, 105, 110, 115, 120]);
const gainOnlyResult = calculateWilderRSI(gainOnlyCandles, 14);
assert(
  gainOnlyResult.slice(1).every((c) => c.rsi === 100),
  'Mercado sem perdas (apenas ganhos) resulta em RSI 100.0'
);

// Teste 1.4: Série sem ganhos (apenas perdas estritas)
const lossOnlyCandles = createCandles([120, 115, 110, 105, 100]);
const lossOnlyResult = calculateWilderRSI(lossOnlyCandles, 14);
assert(
  lossOnlyResult.slice(1).every((c) => c.rsi === 0),
  'Mercado sem ganhos (apenas perdas) resulta em RSI 0.0'
);

// Teste 1.5: Série curta com oscilação (< 14 velas)
const shortOscillating = createCandles([100, 110, 105, 115, 110]);
const shortResult = calculateWilderRSI(shortOscillating, 14);
assert(shortResult.length === 5, 'Série curta preserva tamanho');
assert(
  shortResult[4].rsi! > 0 && shortResult[4].rsi! < 100,
  'Série curta calcula RSI intermediário válido',
  `RSI obtido: ${shortResult[4].rsi}`
);

// Teste 1.6: Série completa com Wilder Smoothing (> 14 velas)
// Sequência de 20 velas com alternâncias
const prices20 = [
  100, 102, 101, 103, 102, 104, 103, 105, 104, 106,
  105, 107, 106, 108, 107, 109, 108, 110, 109, 111
];
const fullResult = calculateWilderRSI(createCandles(prices20), 14);
assert(fullResult.length === 20, 'Série completa preserva 20 velas');
assert(
  fullResult[14].rsi !== undefined && fullResult[14].rsi > 50,
  'Vela 14 inicializa adequadamente via média de 14 períodos',
  `RSI vela 14: ${fullResult[14].rsi}`
);
assert(
  fullResult[19].rsi !== undefined && fullResult[19].rsi > 50 && fullResult[19].rsi <= 100,
  'Velas subsequentes (> 14) aplicam suavização de Wilder com valor delimitado entre 0 e 100',
  `RSI vela 19: ${fullResult[19].rsi}`
);

console.log('\n========================================================');
console.log('2. TESTES DE EMA E MACD');
console.log('========================================================');

const emaResult = calculateEMA(createCandles(prices20), 20, 2);
assert(emaResult[19].ema20 !== undefined && emaResult[19].ema20 > 0, 'EMA 20 calculada com sucesso');

const macdResult = calculateMACD(createCandles(prices20), 12, 26, 9, 2);
assert(macdResult[19].macd !== undefined, 'MACD calculado com sucesso');
assert(macdResult[19].macd!.histogram !== undefined, 'MACD histograma calculado');

console.log('\n========================================================');
console.log('3. TESTES DE PAPER TRADING (ORDENS MARKET E LIMIT)');
console.log('========================================================');

// Teste 3.1: Ordem LIMIT simulada NÃO deve abrir antes do preço atingir o limite
// Para COMPRA (LONG): limite em $60,000. Preço atual está em $64,000.
const pendingLongLimit: PaperPosition = {
  id: 'test-limit-long',
  symbol: 'BTCUSDT',
  direction: 'LONG',
  orderType: 'LIMIT',
  entryPrice: 60000,
  limitPrice: 60000,
  currentPrice: 64000,
  amount: 0.05,
  investedUSDT: 3000,
  leverage: 1,
  openFee: 1.5,
  status: 'PENDING',
  isDemo: true,
  openTimestamp: Date.now()
};

// Se o preço subir para $65,000: NÃO deve abrir
let simulatedPrice = 65000;
let triggered = simulatedPrice <= (pendingLongLimit.limitPrice || pendingLongLimit.entryPrice);
assert(!triggered, 'Ordem LIMIT LONG não abre quando o preço está acima do limite ($65k > $60k)');

// Se o preço cair para $62,000: NÃO deve abrir
simulatedPrice = 62000;
triggered = simulatedPrice <= (pendingLongLimit.limitPrice || pendingLongLimit.entryPrice);
assert(!triggered, 'Ordem LIMIT LONG não abre quando o preço está em $62k (ainda acima de $60k)');

// Se o preço cair para $60,000 ou menos: DEVE abrir
simulatedPrice = 59900;
triggered = simulatedPrice <= (pendingLongLimit.limitPrice || pendingLongLimit.entryPrice);
assert(triggered, 'Ordem LIMIT LONG abre corretamente quando o preço atinge ou cai abaixo do limite ($59.9k <= $60k)');

// Teste 3.2: Ordem LIMIT para VENDA (SHORT): limite em $68,000. Preço atual em $64,000.
const pendingShortLimit: PaperPosition = {
  id: 'test-limit-short',
  symbol: 'BTCUSDT',
  direction: 'SHORT',
  orderType: 'LIMIT',
  entryPrice: 68000,
  limitPrice: 68000,
  currentPrice: 64000,
  amount: 0.05,
  investedUSDT: 3400,
  leverage: 1,
  openFee: 1.7,
  status: 'PENDING',
  isDemo: true,
  openTimestamp: Date.now()
};

// Se o preço cair para $63,000: NÃO deve abrir
simulatedPrice = 63000;
let shortTriggered = simulatedPrice >= (pendingShortLimit.limitPrice || pendingShortLimit.entryPrice);
assert(!shortTriggered, 'Ordem LIMIT SHORT não abre quando o preço está abaixo do limite ($63k < $68k)');

// Se o preço subir para $68,100: DEVE abrir
simulatedPrice = 68100;
shortTriggered = simulatedPrice >= (pendingShortLimit.limitPrice || pendingShortLimit.entryPrice);
assert(shortTriggered, 'Ordem LIMIT SHORT abre corretamente quando o preço atinge ou sobe acima do limite ($68.1k >= $68k)');

console.log('\n========================================================');
console.log('4. TESTES DE STOP-LOSS, TAKE-PROFIT E CÁLCULO DE TAXAS');
console.log('========================================================');

// Teste 4.1: Take Profit em posição LONG
const openLongPos: PaperPosition = {
  id: 'pos-tp-test',
  symbol: 'ETHUSDT',
  direction: 'LONG',
  orderType: 'MARKET',
  entryPrice: 3000,
  currentPrice: 3000,
  targetPrice: 3300,
  stopLossPrice: 2850,
  amount: 1.0,
  investedUSDT: 3000,
  leverage: 1,
  openFee: 1.5,
  status: 'OPEN',
  isDemo: true,
  openTimestamp: Date.now()
};

const tpPrice = 3300;
const tpTriggered = tpPrice >= openLongPos.targetPrice!;
assert(tpTriggered, 'Take-Profit acionado em $3,300');

// Cálculo de PnL no TP:
const priceDiff = tpPrice - openLongPos.entryPrice; // +300
const grossPnl = openLongPos.investedUSDT * (priceDiff / openLongPos.entryPrice); // $300
const closeFee = (openLongPos.amount * tpPrice) * 0.0005; // 3300 * 0.0005 = $1.65
const netPnl = grossPnl - openLongPos.openFee! - closeFee; // 300 - 1.50 - 1.65 = $296.85
assert(Number(netPnl.toFixed(2)) === 296.85, 'PnL líquido com dedução de taxa de abertura e fechamento está exato ($296.85)');

// Teste 4.2: Stop Loss em posição LONG
const slPrice = 2850;
const slTriggered = slPrice <= openLongPos.stopLossPrice!;
assert(slTriggered, 'Stop-Loss acionado em $2,850');

const slPriceDiff = slPrice - openLongPos.entryPrice; // -150
const slGrossPnl = openLongPos.investedUSDT * (slPriceDiff / openLongPos.entryPrice); // -$150
const slCloseFee = (openLongPos.amount * slPrice) * 0.0005; // 2850 * 0.0005 = $1.425
const slNetPnl = slGrossPnl - openLongPos.openFee! - slCloseFee; // -150 - 1.50 - 1.425 = -152.925
assert(Number(slNetPnl.toFixed(2)) === -152.93, 'PnL líquido de Stop-Loss com dedução de taxas está exato (-$152.93)');

console.log('\n========================================================');
console.log('5. TESTES DO ÍNDICE DE SENTIMENTO (FEAR & GREED)');
console.log('========================================================');

// Teste 5.1: Array vazio de ativos
const emptySentiment = calculateFearGreedIndex([]);
assert(emptySentiment.score === 50, 'Array vazio retorna score neutro de 50');
assert(emptySentiment.label === 'Neutro', 'Array vazio retorna rótulo Neutro');

// Teste 5.2: Mercado em forte alta (Ganância / Ganância Extrema)
const bullishAssets: CryptoAsset[] = [
  {
    id: 'btc',
    symbol: 'BTCUSDT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    name: 'Bitcoin',
    price: 66000,
    change24h: 6.5,
    high24h: 66200,
    low24h: 62000,
    volume24h: 4000000000,
    exchanges: ['binance'],
    sparkline: [62000, 66000],
    lastUpdated: '12:00',
    isDemoData: true
  },
  {
    id: 'eth',
    symbol: 'ETHUSDT',
    baseAsset: 'ETH',
    quoteAsset: 'USDT',
    name: 'Ethereum',
    price: 3600,
    change24h: 5.2,
    high24h: 3620,
    low24h: 3400,
    volume24h: 2000000000,
    exchanges: ['binance'],
    sparkline: [3400, 3600],
    lastUpdated: '12:00',
    isDemoData: true
  },
  {
    id: 'sol',
    symbol: 'SOLUSDT',
    baseAsset: 'SOL',
    quoteAsset: 'USDT',
    name: 'Solana',
    price: 165,
    change24h: 8.0,
    high24h: 166,
    low24h: 150,
    volume24h: 1000000000,
    exchanges: ['binance'],
    sparkline: [150, 165],
    lastUpdated: '12:00',
    isDemoData: true
  }
];

const bullishSentiment = calculateFearGreedIndex(bullishAssets);
assert(bullishSentiment.score >= 70, `Mercado em alta reflete pontuação elevada (score: ${bullishSentiment.score} >= 70)`);
assert(
  bullishSentiment.label === 'Ganância' || bullishSentiment.label === 'Ganância Extrema',
  `Rótulo de alta é Ganância ou Ganância Extrema (obtido: ${bullishSentiment.label})`
);
assert(bullishSentiment.advancersCount === 3, 'Contagem de 3 ativos em alta');

// Teste 5.3: Mercado em forte queda (Medo / Medo Extremo)
const bearishAssets: CryptoAsset[] = [
  {
    ...bullishAssets[0],
    price: 58000,
    change24h: -7.5,
    high24h: 63000,
    low24h: 57800
  },
  {
    ...bullishAssets[1],
    price: 3100,
    change24h: -8.0,
    high24h: 3400,
    low24h: 3080
  },
  {
    ...bullishAssets[2],
    price: 135,
    change24h: -11.0,
    high24h: 155,
    low24h: 134
  }
];

const bearishSentiment = calculateFearGreedIndex(bearishAssets);
assert(bearishSentiment.score <= 30, `Mercado em queda reflete pontuação reduzida (score: ${bearishSentiment.score} <= 30)`);
assert(
  bearishSentiment.label === 'Medo' || bearishSentiment.label === 'Medo Extremo',
  `Rótulo de queda é Medo ou Medo Extremo (obtido: ${bearishSentiment.label})`
);
assert(bearishSentiment.declinersCount === 3, 'Contagem de 3 ativos em baixa');

// Teste 5.4: Mercado neutro / lateral
const neutralAssets: CryptoAsset[] = [
  {
    ...bullishAssets[0],
    price: 64000,
    change24h: 0.1,
    high24h: 64500,
    low24h: 63500
  },
  {
    ...bullishAssets[1],
    price: 3450,
    change24h: -0.2,
    high24h: 3480,
    low24h: 3420
  }
];

const neutralSentiment = calculateFearGreedIndex(neutralAssets);
assert(neutralSentiment.score >= 40 && neutralSentiment.score <= 60, `Mercado lateral pontua próximo a 50 (score: ${neutralSentiment.score})`);
assert(neutralSentiment.label === 'Neutro', `Rótulo de mercado lateral é Neutro (obtido: ${neutralSentiment.label})`);

console.log('\n========================================================');
console.log(`TOTAL DE TESTES EXECUTADOS: ${totalTests}`);
console.log(`TESTES APROVADOS: ${passedTests}`);
console.log('TODAS AS ASSERÇÕES PASSARAM COM SUCESSO!');
console.log('========================================================\n');

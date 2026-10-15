/**
 * Travas e acompanhamento do motor de IA das criptos (server/aiEngine.ts). A IA decide; o código só aprova o que respeita:
 *  - o ativo está na lista analisada; spot só compra (LONG); venda (SHORT) só em futuros;
 *  - LONG só com o Bitcoin acima da média de 200 dias; SHORT (futuros) só com ele abaixo;
 *  - confiança mínima 60; no máximo 5 sinais por rodada; um sinal aberto por ativo e direção;
 *  - a entrada é SEMPRE o preço atual (a IA pode sugerir, mas não escolhe um preço longe do mercado);
 *  - stop do lado certo, a 0,5%–15% da entrada; alvo do lado certo; alvo entre 1,5x e 6x o stop.
 * O acompanhamento usa velas de 1 hora (máxima e mínima), com o stop valendo primeiro se os dois caírem na mesma vela.
 */

import { DEFAULT_BACKTEST_OPTIONS } from './backtest';
import { readinessFromResults, TrendReadiness } from './trendSignals';

export const AI_CRYPTO_RULES = {
  minConfidence: 60,
  maxNew: 5,
  stopPct: [0.5, 15] as const,
  minRewardRisk: 1.5,
  maxRewardRisk: 6
};

export interface GuardContext {
  market: 'spot' | 'futures';
  prices: Map<string, number>;
  allowed: Set<string>;
  bullish: boolean;                 // Bitcoin acima da média de 200 dias
  openKeys: Set<string>;            // `${symbol}|${direction}` dos sinais já abertos
}

export interface ApprovedSignal {
  raw: any;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  confidence: number;
  entry: number;
  target: number;
  stop: number;
}

export function guardSignals(raws: any[], ctx: GuardContext): { approved: ApprovedSignal[]; blocked: { symbol: string; why: string }[] } {
  const approved: ApprovedSignal[] = [];
  const blocked: { symbol: string; why: string }[] = [];
  const R = AI_CRYPTO_RULES;
  const list = raws
    .filter((r) => r && typeof r.symbol === 'string')
    .sort((a, b) => (Number(b.confidence) || 0) - (Number(a.confidence) || 0));
  for (const raw of list) {
    const symbol = String(raw.symbol).trim().toUpperCase();
    const no = (why: string) => { blocked.push({ symbol, why }); };
    const direction: 'LONG' | 'SHORT' = String(raw.direction).toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
    const price = ctx.prices.get(symbol);
    const confidence = Number(raw.confidence);
    const target = Number(raw.targetPrice), stop = Number(raw.stopLossPrice);

    if (!ctx.allowed.has(symbol) || !(price && price > 0)) { no('ativo fora da lista analisada ou sem preço'); continue; }
    if (direction === 'SHORT' && ctx.market === 'spot') { no('venda a descoberto não existe no spot'); continue; }
    if (direction === 'LONG' && !ctx.bullish) { no('Bitcoin abaixo da média de 200 dias: compras bloqueadas'); continue; }
    if (direction === 'SHORT' && ctx.bullish) { no('Bitcoin acima da média de 200 dias: vendas bloqueadas'); continue; }
    if (ctx.openKeys.has(`${symbol}|${direction}`)) { no('já há sinal aberto neste ativo e direção'); continue; }
    if (!Number.isFinite(confidence) || confidence < R.minConfidence) { no(`confiança ${Number.isFinite(confidence) ? Math.round(confidence) : '—'} abaixo de ${R.minConfidence}`); continue; }
    if (!Number.isFinite(target) || !Number.isFinite(stop)) { no('sem stop ou alvo válidos'); continue; }
    const long = direction === 'LONG';
    if (long ? !(stop < price && target > price) : !(stop > price && target < price)) { no('stop ou alvo do lado errado do preço'); continue; }
    const stopPct = (Math.abs(price - stop) / price) * 100;
    if (stopPct < R.stopPct[0] || stopPct > R.stopPct[1]) { no(`stop a ${stopPct.toFixed(1)}% do preço (limite ${R.stopPct[0]}% a ${R.stopPct[1]}%)`); continue; }
    const rr = Math.abs(target - price) / Math.abs(price - stop);
    if (rr < R.minRewardRisk || rr > R.maxRewardRisk) { no(`risco/retorno 1:${rr.toFixed(1)} fora de 1:${R.minRewardRisk} a 1:${R.maxRewardRisk}`); continue; }
    if (approved.length >= R.maxNew) { no(`limite de ${R.maxNew} sinais por rodada`); continue; }
    approved.push({ raw, symbol, direction, confidence: Math.min(100, Math.round(confidence)), entry: price, target, stop });
  }
  return { approved, blocked };
}

export interface HourCandle { timestamp: number; high: number; low: number; close: number }
export const EXPIRE_MS: Record<string, number> = { '1h': 48 * 3600e3, '4h': 8 * 24 * 3600e3 };

/** Resultado de um sinal aberto, a partir das velas de 1h posteriores à criação. null = continua aberto. */
export function resolveOutcome(
  s: { direction: 'LONG' | 'SHORT'; targetPrice: number; stopLossPrice: number; createdAt: number; timeframe: string },
  candles: HourCandle[],
  now: number = Date.now()
): { status: 'TARGET_HIT' | 'STOP_HIT' | 'EXPIRED'; closePrice: number; closedAt: number } | null {
  const long = s.direction === 'LONG';
  for (const c of candles) {
    if (c.timestamp < s.createdAt) continue; // a vela em que o sinal nasceu mistura preços de antes dele
    const stopHit = long ? c.low <= s.stopLossPrice : c.high >= s.stopLossPrice;
    const targetHit = long ? c.high >= s.targetPrice : c.low <= s.targetPrice;
    if (stopHit) return { status: 'STOP_HIT', closePrice: s.stopLossPrice, closedAt: c.timestamp + 3600e3 };
    if (targetHit) return { status: 'TARGET_HIT', closePrice: s.targetPrice, closedAt: c.timestamp + 3600e3 };
  }
  if (now - s.createdAt > (EXPIRE_MS[s.timeframe] ?? 48 * 3600e3)) {
    const last = candles[candles.length - 1];
    return last ? { status: 'EXPIRED', closePrice: last.close, closedAt: now } : null;
  }
  return null;
}

export interface AiLiveStats {
  closed: number;
  open: number;
  wins: number;
  winRate: number;
  profitFactor: number | null;
  avgNetPct: number;
  readiness: TrendReadiness;
}

/** Resultado líquido (taxa e derrapagem dos dois lados) dos sinais encerrados e critérios de validação ao vivo. */
export function liveStats(signals: { status: string; direction: 'LONG' | 'SHORT'; entryPrice: number; closePrice?: number; createdAt: number }[], now = Date.now()): AiLiveStats {
  const cost = 2 * (DEFAULT_BACKTEST_OPTIONS.feeRate + DEFAULT_BACKTEST_OPTIONS.slippageRate) * 100;
  const done = signals.filter((s) => s.status !== 'OPEN' && s.closePrice !== undefined && s.entryPrice > 0);
  const nets = done.map((s) => (s.direction === 'LONG' ? 1 : -1) * ((s.closePrice! - s.entryPrice) / s.entryPrice) * 100 - cost);
  const gains = nets.filter((x) => x > 0).reduce((a, x) => a + x, 0);
  const losses = Math.abs(nets.filter((x) => x <= 0).reduce((a, x) => a + x, 0));
  const days = signals.length ? (now - Math.min(...signals.map((s) => s.createdAt))) / 86400000 : 0;
  return {
    closed: done.length,
    open: signals.filter((s) => s.status === 'OPEN').length,
    wins: nets.filter((x) => x > 0).length,
    winRate: nets.length ? (nets.filter((x) => x > 0).length / nets.length) * 100 : 0,
    profitFactor: losses > 0 ? gains / losses : gains > 0 ? null : 0,
    avgNetPct: nets.length ? nets.reduce((a, x) => a + x, 0) / nets.length : 0,
    readiness: readinessFromResults(nets, days)
  };
}

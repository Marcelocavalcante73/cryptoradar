/**
 * Motor de IA da B3 (swing trade, velas diárias, só compras). A IA RECEBE o mercado e os indicadores de cada ativo e DECIDE
 * quais comprar, com stop, alvo e prazo. O código só põe TRAVAS que a IA não pode passar:
 *  - nunca compra com o mercado em baixa (Ibovespa abaixo da média de 200 dias);
 *  - stop entre 1 e 3 ATR, alvo entre 1,5 e 6 ATR, alvo pelo menos 1,5x o stop, prazo de 3 a 20 pregões;
 *  - confiança mínima de 60 e no máximo 3 sinais novos por rodada; um sinal aberto por ativo;
 *  - só ativos da lista fixa; qualquer resposta fora do formato é descartada.
 * A IA não vê o futuro e não pode ser testada no passado (ela "conhece" o passado), por isso a validação é AO VIVO,
 * com os mesmos critérios das outras estratégias, lado a lado com o motor de regras.
 */

import { CandleData } from '../types/crypto';
import { calculateAllIndicators, calculateATR } from './indicators';
import { scoreCandles } from './signalEngine';
import { B3Signal, MarketTrend } from './b3Signals';
import { donchianHigh, donchianLow } from './trendBacktest';

export const AI_RULES = {
  minConfidence: 60,
  maxNew: 3,
  stopAtr: [1, 3] as const,
  targetAtr: [1.5, 6] as const,
  minRewardRisk: 1.5,
  holdDays: [3, 20] as const
};

export interface AiRow {
  symbol: string;
  close: number;
  ret5: number; ret20: number; ret60: number;       // variação % em 5, 20 e 60 pregões
  rsi: number;
  macdHistPct: number;                              // histograma do MACD em % do preço
  emaGapAtr: number;                                // (EMA20 - EMA50) em ATR
  sma200GapPct: number;                             // distância do fechamento até a média de 200 dias, %
  atrPct: number;                                   // ATR(14) em % do preço
  volRatio: number;                                 // volume do dia / média de 20 dias
  dist55HighPct: number;                            // quanto falta (+) ou já passou (−) da máxima de 55 pregões anteriores, %
  dist20LowPct: number;                             // distância até a mínima de 20 pregões, %
  ruleScore: number;                                // pontuação do motor de regras (−100 a 100), só como referência
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Indicadores de um ativo a partir das velas FECHADAS. null se faltar histórico. */
export function computeRow(symbol: string, closed: CandleData[]): AiRow | null {
  if (closed.length < 210) return null;
  const w = calculateAllIndicators(closed.slice(-220), 10);
  const last = w[w.length - 1];
  const atr = calculateATR(w);
  if (!atr || atr <= 0 || last.rsi === undefined || !last.macd || last.ema20 === undefined || last.ema50 === undefined) return null;
  const n = closed.length, c = last.close;
  const pct = (k: number) => (c / closed[n - 1 - k].close - 1) * 100;
  const sma200 = closed.slice(-200).reduce((a, x) => a + x.close, 0) / 200;
  const avgVol = closed.slice(-21, -1).reduce((a, x) => a + x.volume, 0) / 20;
  const score = scoreCandles(w);
  return {
    symbol, close: c,
    ret5: r1(pct(5)), ret20: r1(pct(20)), ret60: r1(pct(60)),
    rsi: r1(last.rsi),
    macdHistPct: r2((last.macd.histogram / c) * 100),
    emaGapAtr: r2((last.ema20 - last.ema50) / atr),
    sma200GapPct: r1((c / sma200 - 1) * 100),
    atrPct: r2((atr / c) * 100),
    volRatio: avgVol > 0 ? r2(last.volume / avgVol) : 1,
    dist55HighPct: r1(((donchianHigh(closed, n - 1) - c) / c) * 100),
    dist20LowPct: r1(((c - donchianLow(closed, n - 1)) / c) * 100),
    ruleScore: score ? score.total : 0
  };
}

const SYSTEM = [
  'Você é o motor de decisão de um sistema de swing trade (velas diárias, só compras, prazo de dias a poucas semanas).',
  'Receberá o estado do MERCADO e uma tabela de indicadores por ativo. Decida quais ativos comprar agora e, para cada compra, o stop e o alvo em múltiplos de ATR e o prazo.',
  'Use SOMENTE os números fornecidos. Não use notícias, conhecimento do passado dos ativos nem previsão de preço: é uma decisão estatística sobre risco e probabilidade.',
  'O padrão é ESPERAR. Compre só quando o conjunto (mercado, tendência, momentum, volume, RSI, distância da máxima, relação risco/retorno) justificar. Poucas compras boas valem mais que muitas.',
  `Limites (o sistema descarta o que passar deles): stop de ${AI_RULES.stopAtr[0]} a ${AI_RULES.stopAtr[1]} ATR; alvo de ${AI_RULES.targetAtr[0]} a ${AI_RULES.targetAtr[1]} ATR e pelo menos ${AI_RULES.minRewardRisk}x o stop; prazo de ${AI_RULES.holdDays[0]} a ${AI_RULES.holdDays[1]} pregões; no máximo ${AI_RULES.maxNew} compras.`,
  'Responda APENAS com JSON no formato: {"decisions":[{"symbol":"XXX","action":"BUY"|"WAIT","confidence":0-100,"stop_atr":número,"target_atr":número,"hold_days":número,"reason":"frase curta em português"}]}.',
  'Inclua uma entrada para CADA ativo da tabela (WAIT para os que não comprar, com motivo curto). A confiança é sua estimativa de que o alvo vem antes do stop.'
].join(' ');

export function buildPrompt(mkt: MarketTrend, rows: AiRow[]): { system: string; user: string } {
  const ctx = {
    mercado: 'B3 (ações brasileiras; referência: Ibovespa)',
    leitura_do_mercado: mkt.label, acima_da_media_200d: mkt.bullish,
    referencia_vs_media_50d_pct: r1((mkt.close / mkt.sma50 - 1) * 100), referencia_vs_media_200d_pct: r1((mkt.close / mkt.sma200 - 1) * 100),
    referencia_variacao_20_pregoes_pct: r1(mkt.change20dPct)
  };
  const legenda = 'ret5/ret20/ret60 = variação % em 5/20/60 pregões; rsi = RSI(14); macdHistPct = histograma do MACD em % do preço; emaGapAtr = (EMA20-EMA50) em ATR; sma200GapPct = distância da média de 200 dias; atrPct = ATR em % do preço; volRatio = volume/média de 20; dist55HighPct = quanto falta (+) ou já passou (−) da máxima de 55 pregões; dist20LowPct = distância da mínima de 20 pregões; ruleScore = pontuação do motor de regras (referência).';
  return { system: SYSTEM, user: `Mercado:\n${JSON.stringify(ctx)}\n\nLegenda: ${legenda}\n\nAtivos:\n${JSON.stringify(rows)}` };
}

export interface AiDecision {
  symbol: string;
  action: 'BUY' | 'WAIT';
  confidence: number;
  stopAtr: number;
  targetAtr: number;
  holdDays: number;
  reason: string;
}

const clamp = (n: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, n));

/** Lê a resposta da IA (aceita cerca de código ```json). Descarta tudo que não for do formato esperado. */
export function parseDecisions(text: string, allowed: Set<string>): AiDecision[] {
  const cleaned = text.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/i, '').trim();
  let obj: any;
  try { obj = JSON.parse(cleaned); } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    try { obj = m ? JSON.parse(m[0]) : null; } catch { obj = null; }
  }
  const arr: any[] = Array.isArray(obj) ? obj : Array.isArray(obj?.decisions) ? obj.decisions : [];
  const seen = new Set<string>();
  const out: AiDecision[] = [];
  for (const d of arr) {
    const symbol = typeof d?.symbol === 'string' ? d.symbol.trim().toUpperCase() : '';
    if (!allowed.has(symbol) || seen.has(symbol)) continue;
    const action = String(d?.action).toUpperCase() === 'BUY' ? 'BUY' : 'WAIT';
    const conf = Number(d?.confidence);
    seen.add(symbol);
    out.push({
      symbol, action,
      confidence: Number.isFinite(conf) ? Math.min(100, Math.max(0, Math.round(conf))) : 0,
      stopAtr: Number(d?.stop_atr), targetAtr: Number(d?.target_atr), holdDays: Number(d?.hold_days),
      reason: typeof d?.reason === 'string' ? d.reason.trim().slice(0, 240) : ''
    });
  }
  return out;
}

export interface PickedEntry extends AiDecision { rejected?: string }

/** Aplica as travas do código. Devolve só as compras aprovadas, da maior confiança para a menor. */
export function pickEntries(decisions: AiDecision[], opts: { bullish: boolean; openSymbols: Set<string> }): { approved: AiDecision[]; blocked: { symbol: string; why: string }[] } {
  const approved: AiDecision[] = [];
  const blocked: { symbol: string; why: string }[] = [];
  const buys = decisions.filter((d) => d.action === 'BUY').sort((a, b) => b.confidence - a.confidence);
  for (const d of buys) {
    if (!opts.bullish) { blocked.push({ symbol: d.symbol, why: 'mercado abaixo da média de 200 dias: compras bloqueadas' }); continue; }
    if (opts.openSymbols.has(d.symbol)) { blocked.push({ symbol: d.symbol, why: 'já há sinal aberto neste ativo' }); continue; }
    if (d.confidence < AI_RULES.minConfidence) { blocked.push({ symbol: d.symbol, why: `confiança ${d.confidence} abaixo de ${AI_RULES.minConfidence}` }); continue; }
    if (!Number.isFinite(d.stopAtr) || !Number.isFinite(d.targetAtr)) { blocked.push({ symbol: d.symbol, why: 'sem stop ou alvo válidos' }); continue; }
    if (approved.length >= AI_RULES.maxNew) { blocked.push({ symbol: d.symbol, why: `limite de ${AI_RULES.maxNew} sinais por rodada` }); continue; }
    const stopAtr = clamp(d.stopAtr, AI_RULES.stopAtr);
    const targetAtr = clamp(d.targetAtr, AI_RULES.targetAtr);
    if (targetAtr < stopAtr * AI_RULES.minRewardRisk) { blocked.push({ symbol: d.symbol, why: 'alvo menor que 1,5x o stop' }); continue; }
    approved.push({ ...d, stopAtr, targetAtr, holdDays: Math.round(clamp(Number.isFinite(d.holdDays) ? d.holdDays : 10, AI_RULES.holdDays)) });
  }
  return { approved, blocked };
}

/** Cria o sinal rastreável (mesmo ciclo de vida dos sinais de regras, com stop/alvo/prazo da IA). */
export function aiSignalFrom(d: AiDecision, closed: CandleData[], now: number): B3Signal | null {
  const w = calculateAllIndicators(closed.slice(-120), 10);
  const atr = calculateATR(w);
  const c = closed[closed.length - 1];
  if (!atr || atr <= 0) return null;
  return {
    id: `${d.symbol}-ai-${c.timestamp}`, symbol: d.symbol, signalDay: c.timestamp, createdAt: now, refPrice: c.close,
    stopPrice: c.close - d.stopAtr * atr, targetPrice: c.close + d.targetAtr * atr, atr,
    score: d.confidence, status: 'OPEN', lastPrice: c.close,
    engine: 'ai', stopMult: d.stopAtr, targetMult: d.targetAtr, holdDays: d.holdDays, confidence: d.confidence, reason: d.reason
  };
}

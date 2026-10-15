/**
 * Motor de Sinais por Inteligência Artificial (Gemini):
 * A IA atua ativamente como motor quantitativo de decisão, analisando os ativos,
 * avaliando médias, fluxo, volatilidade (ATR) e momentum (RSI/MACD) para
 * gerar sinais com tese técnica, confiança (%) e preços de entrada, alvo e stop.
 */

import { CandleData, MarketType, SignalDirection } from '../src/types/crypto';
import { getStateSafe, setStateSafe } from './stateStore';
import { aiConfig, takeBudget, generateText } from './aiAnalyst';
import { getScanState, sendTelegram, StoredSignal } from './scanner';
import { futuresPrices, futuresKlines } from './futuresData';
import { binanceGet } from './universe';
import { parseBinanceKline } from '../src/services/apiService';
import { marketTrend } from '../src/services/b3Signals';
import { splitClosed } from '../src/services/trendSignals';
import { computeRow, AiRow } from '../src/services/aiSwing';
import { guardSignals, resolveOutcome, liveStats, AiLiveStats, AI_CRYPTO_RULES, HourCandle } from '../src/services/aiGuards';

export interface AiEngineSignal {
  id: string;
  market: MarketType;
  symbol: string;
  baseAsset: string;
  direction: SignalDirection;
  strategy: 'AI_ENGINE_MOMENTUM' | 'AI_ENGINE_BREAKOUT' | 'AI_ENGINE_REVERSAL';
  strategyName: string;
  timeframe: string;
  entryPrice: number;
  targetPrice: number;
  stopLossPrice: number;
  riskRewardRatio: string;
  status: 'OPEN' | 'TARGET_HIT' | 'STOP_HIT' | 'EXPIRED';
  technicalReason: string;
  indicatorsTriggered: string[];
  timestamp: string;
  createdAt: number;
  closedAt?: number;
  closePrice?: number;
  alerted?: boolean;
  isDemo: false;
  isAiGenerated: true;
  disclaimer: string;
  aiEngine: {
    isAiGenerated: true;
    confidence: number; // 0 - 100
    verdict: string;
    thesis: string;
    riskLevel: 'BAIXO' | 'MEDIO' | 'ALTO';
    analyzedAt: number;
  };
}

export interface AiEngineState {
  market: MarketType;
  running: boolean;
  lastScanAt: number | null;
  lastError: string | null;
  marketRegime: string;
  marketSummary: string;
  bitcoinBullish?: boolean | null;
  blocked?: { symbol: string; why: string }[];
  stats?: AiLiveStats;
  signals: AiEngineSignal[];
}

const aiEngineStates: Record<MarketType, AiEngineState> = {
  spot: {
    market: 'spot',
    running: false,
    lastScanAt: null,
    lastError: null,
    marketRegime: 'ANALISANDO',
    marketSummary: 'O Motor de IA analisa múltiplos ativos buscando assimetrias de alta probabilidade.',
    signals: []
  },
  futures: {
    market: 'futures',
    running: false,
    lastScanAt: null,
    lastError: null,
    marketRegime: 'ANALISANDO',
    marketSummary: 'O Motor de IA de Futuros rastreia contratos perpétuos com stop técnico e projeção de alvo.',
    signals: []
  }
};

/** Restaura estado salvo do motor de IA */
export async function loadAiEngineState(): Promise<void> {
  for (const m of ['spot', 'futures'] as const) {
    const saved = await getStateSafe(`ai-engine-${m}`);
    if (saved?.value && Array.isArray(saved.value.signals)) {
      aiEngineStates[m] = {
        ...aiEngineStates[m],
        ...saved.value,
        running: false
      };
    }
  }
}

export function getAiEngineState(market: MarketType = 'spot'): AiEngineState {
  const st = aiEngineStates[market] || aiEngineStates.spot;
  return { ...st, stats: liveStats(st.signals) };
}

/** Só para testes. */
export function resetAiEngineStates() {
  for (const m of ['spot', 'futures'] as const) {
    aiEngineStates[m] = { ...aiEngineStates[m], running: false, lastScanAt: null, lastError: null, signals: [], blocked: [], bitcoinBullish: null };
  }
}

/** Chama Gemini com suporte a fallback de modelos caso haja sobrecarga temporária */
async function callGeminiEngine(prompt: string, timeoutMs = 28000): Promise<string> {
  const cfg = aiConfig();
  if (!cfg.enabled) throw new Error('IA desligada: defina GEMINI_API_KEY ou OPENAI_API_KEY no servidor');
  if (cfg.provider === 'openai') {
    return generateText('Responda apenas com JSON válido, sem texto fora do JSON.', prompt, { json: true, temperature: 0.2, maxTokens: 2500, timeoutMs });
  }
  if (!process.env.GEMINI_API_KEY) throw new Error('Chave GEMINI_API_KEY não configurada no servidor');

  const candidates = Array.from(new Set([
    'gemini-3.5-flash-lite',
    cfg.model,
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-3.8-flash',
    'gemini-flash-latest'
  ])).filter(Boolean) as string[];

  let lastErr: Error | null = null;
  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${process.env.GEMINI_API_KEY.trim()}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2500,
            responseMimeType: 'application/json'
          }
        }),
        signal: AbortSignal.timeout(timeoutMs)
      });

      const raw = await res.text();
      let j: any = null;
      try {
        j = raw ? JSON.parse(raw) : null;
      } catch {
        throw new Error(`Resposta inválida da IA (HTTP ${res.status})`);
      }

      if (!res.ok) {
        const msg = j?.error?.message || `Gemini HTTP ${res.status}`;
        if ((res.status === 404 || res.status === 503 || res.status === 429) && i < candidates.length - 1) {
          lastErr = new Error(msg);
          continue;
        }
        throw new Error(msg);
      }

      const text = j?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        if (i < candidates.length - 1) {
          lastErr = new Error('Resposta vazia');
          continue;
        }
        throw new Error('IA respondeu vazio');
      }

      return text;
    } catch (err: any) {
      lastErr = err;
      if (i < candidates.length - 1) continue;
      throw err;
    }
  }

  throw lastErr || new Error('Nenhum modelo da IA respondeu');
}

const H4 = 4 * 3600e3;
const fmtP = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 2 : 6 });

async function klinesFor(market: MarketType, symbol: string, interval: string, limit: number): Promise<CandleData[]> {
  const raw: any[] = market === 'futures'
    ? await futuresKlines(symbol, interval, limit)
    : (await binanceGet(`/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, 8000, 'spot')) as any[];
  const out: CandleData[] = [];
  for (const k of raw) { const c = parseBinanceKline(k, interval as any, 10); if (c) out.push(c); }
  return out;
}

async function pool<T>(items: T[], n: number, worker: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await worker(items[i++]); }));
}

const alertAi = (s: AiEngineSignal, kind: 'entry' | 'exit'): string => {
  const tag = s.market === 'futures' ? 'FUTUROS' : 'SPOT';
  if (kind === 'entry') {
    return [
      `🤖 *[IA · ${tag}] ${s.direction === 'LONG' ? 'COMPRAR' : 'VENDER (short)'}* ${s.symbol}`,
      `Confiança ${s.aiEngine.confidence}/100. ${s.aiEngine.thesis}`,
      `Entrada: ${fmtP(s.entryPrice)}  ·  Stop: ${fmtP(s.stopLossPrice)}  ·  Alvo: ${fmtP(s.targetPrice)}  (${s.riskRewardRatio})`,
      '', '_Decisão automática de IA, em validação: só simulação. Não é recomendação de investimento._'
    ].join('\n');
  }
  const why = s.status === 'TARGET_HIT' ? 'alvo atingido' : s.status === 'STOP_HIT' ? 'stop atingido' : 'prazo vencido';
  return [`🔔 *[IA · ${tag}] ENCERRADO* ${s.symbol}`, `Motivo: ${why}${s.closePrice !== undefined ? ` em ${fmtP(s.closePrice)}` : ''}.`, '', '_Não é recomendação de investimento._'].join('\n');
};

/**
 * Acompanha os sinais abertos da IA com velas de 1h (máxima e mínima), como nos outros motores.
 * Roda ao fim de cada decisão e a cada 15 minutos (sem chamar a IA).
 */
export async function refreshAiOutcomes(market: MarketType): Promise<void> {
  const state = aiEngineStates[market];
  const open = state.signals.filter((s) => s.status === 'OPEN');
  if (open.length === 0) return;
  const now = Date.now();
  const candles = new Map<string, HourCandle[]>();
  await pool([...new Set(open.map((s) => s.symbol))], 3, async (sym) => {
    try { candles.set(sym, (await klinesFor(market, sym, '1h', 200)).map((c) => ({ timestamp: c.timestamp, high: c.high, low: c.low, close: c.close }))); } catch { /* tenta no próximo ciclo */ }
  });
  const alerts: string[] = [];
  for (const s of open) {
    const c = candles.get(s.symbol);
    if (!c) continue;
    const r = resolveOutcome(s, c, now);
    if (!r) continue;
    s.status = r.status; s.closePrice = r.closePrice; s.closedAt = r.closedAt;
    if (!s.alerted) { alerts.push(alertAi(s, 'exit')); s.alerted = true; }
  }
  if (alerts.length) { persist(market); for (const a of alerts) await sendTelegram(a); }
}

function persist(market: MarketType) {
  const state = aiEngineStates[market];
  void setStateSafe(`ai-engine-${market}`, {
    market, lastScanAt: state.lastScanAt, marketRegime: state.marketRegime, marketSummary: state.marketSummary,
    bitcoinBullish: state.bitcoinBullish ?? null, blocked: state.blocked ?? [], signals: state.signals
  });
}

/** Acompanhamento automático dos sinais abertos (15 min). Desligue com AI_ENGINE_TRACK=false. */
export function startAiEngineTracker(intervalMinutes = 15) {
  if (process.env.AI_ENGINE_TRACK === 'false') return;
  setTimeout(() => {
    const tick = () => { for (const m of ['spot', 'futures'] as const) void refreshAiOutcomes(m).catch(() => {}); };
    tick();
    setInterval(tick, intervalMinutes * 60e3);
  }, 120000);
}

/**
 * Executa a varredura ativa do MOTOR DE IA. A IA recebe o mercado (Bitcoin vs média de 200 dias) e os indicadores de cada
 * moeda (velas de 4h) e decide; as travas de src/services/aiGuards.ts aprovam só o que respeita os limites de risco.
 */
export async function runAiEngineScan(market: MarketType = 'spot'): Promise<AiEngineState> {
  const state = aiEngineStates[market];
  if (state.running) return state;

  state.running = true;
  state.lastError = null;

  try {
    // 1. Moedas e cotações atuais
    const scanState = getScanState(market);
    const coins = (scanState.universe?.coins || []).slice(0, 30);

    let priceMap = new Map<string, number>();
    if (market === 'futures') {
      priceMap = await futuresPrices(coins.map((c) => c.symbol));
    } else {
      try {
        const raw = await binanceGet('/api/v3/ticker/price', 6000, 'spot') as any[];
        priceMap = new Map<string, number>(raw.map((p) => [p.symbol, parseFloat(p.price)]));
      } catch {
        scanState.signals.forEach((s) => priceMap.set(s.symbol, s.entryPrice));
      }
    }
    const top = coins.slice(0, 15).filter((c) => (priceMap.get(c.symbol) ?? 0) > 0);
    if (top.length === 0) throw new Error('Não foi possível obter cotações para alimentar o Motor de IA.');

    // 2. Mercado: Bitcoin (spot, diário) acima ou abaixo da média de 200 dias
    const btcDaily = await klinesFor('spot', 'BTCUSDT', '1d', 320);
    const mkt = marketTrend(splitClosed(btcDaily, Date.now()).closed);
    if (!mkt) throw new Error('Histórico do Bitcoin insuficiente para ler o mercado.');
    state.bitcoinBullish = mkt.bullish;

    // 3. Indicadores de cada moeda (velas fechadas de 4h)
    const rows: (AiRow & { regraExistente: any })[] = [];
    await pool(top, 3, async (c) => {
      try {
        const now = Date.now();
        const closed = (await klinesFor(market, c.symbol, '4h', 300)).filter((k) => k.timestamp + H4 <= now);
        const row = computeRow(c.symbol, closed);
        if (!row) return;
        const ex = scanState.signals.find((x) => x.symbol === c.symbol && x.status === 'OPEN');
        rows.push({ ...row, close: priceMap.get(c.symbol) ?? row.close, regraExistente: ex ? { direcao: ex.direction, estrategia: ex.strategyName, pontuacao: ex.score } : null });
      } catch { /* moeda sem velas nesta rodada */ }
    });
    if (rows.length < 3) throw new Error('Poucas moedas com histórico suficiente para a IA analisar.');

    const ctx = {
      mercado: market === 'futures' ? 'Criptomoedas, futuros perpétuos' : 'Criptomoedas, spot',
      bitcoin_acima_da_media_200d: mkt.bullish, leitura_do_mercado: mkt.label,
      bitcoin_vs_media_200d_pct: Math.round((mkt.close / mkt.sma200 - 1) * 1000) / 10,
      bitcoin_variacao_20_dias_pct: Math.round(mkt.change20dPct * 10) / 10
    };
    const R = AI_CRYPTO_RULES;
    const prompt = `Você é o MOTOR DE DECISÃO de um sistema de trading de criptomoedas (${ctx.mercado}). Decida com base SOMENTE nos números abaixo (mercado e indicadores em velas de 4h), sem notícias nem previsão de preço.

MERCADO:
${JSON.stringify(ctx)}

INDICADORES POR MOEDA (ret5/ret20/ret60 = variação % em 5/20/60 velas de 4h; rsi = RSI(14); macdHistPct = histograma do MACD em % do preço; emaGapAtr = (EMA20-EMA50) em ATR; sma200GapPct = distância da média de 200 velas; atrPct = ATR em % do preço; volRatio = volume/média de 20; dist55HighPct = quanto falta (+) ou já passou (−) da máxima de 55 velas; dist20LowPct = distância da mínima de 20 velas; ruleScore = pontuação do motor de regras; regraExistente = sinal aberto do motor de regras, se houver):
${JSON.stringify(rows)}

REGRAS (o sistema descarta o que passar delas): ${market === 'spot' ? 'só LONG (compra)' : 'LONG só com o Bitcoin acima da média de 200 dias e SHORT só com ele abaixo'}; confiança mínima ${R.minConfidence}; no máximo ${R.maxNew} sinais; stop de ${R.stopPct[0]}% a ${R.stopPct[1]}% do preço; alvo de ${R.minRewardRisk}x a ${R.maxRewardRisk}x a distância do stop; use preços próximos ao atual. O padrão é NÃO operar: devolva lista vazia se nada justificar. Confiança = sua estimativa de que o alvo vem antes do stop.

Responda ESTRITAMENTE em JSON:
{"marketRegime":"texto curto","marketSummary":"1 a 2 frases","signals":[{"symbol":"BTCUSDT","baseAsset":"BTC","direction":"LONG","confidence":75,"timeframe":"4h","entryPrice":0,"targetPrice":0,"stopLossPrice":0,"thesis":"até 3 frases em português citando os indicadores","riskLevel":"BAIXO|MEDIO|ALTO","strategy":"AI_ENGINE_MOMENTUM|AI_ENGINE_BREAKOUT|AI_ENGINE_REVERSAL"}]}`;

    if (!takeBudget()) throw new Error('Limite diário de chamadas à IA atingido');
    const jsonText = await callGeminiEngine(prompt);
    let parsed: any;
    try { parsed = JSON.parse(jsonText.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/i, '').trim()); } catch { throw new Error('A IA respondeu fora do formato esperado'); }

    state.marketRegime = String(parsed?.marketRegime || (mkt.bullish ? 'MERCADO EM ALTA' : 'MERCADO EM BAIXA')).slice(0, 60);
    state.marketSummary = String(parsed?.marketSummary || 'Motor de IA atualizado com a leitura do mercado.').slice(0, 300);

    // 4. Travas do código
    const now = Date.now();
    const rawSignals: any[] = Array.isArray(parsed?.signals) ? parsed.signals : [];
    const openKeys = new Set(state.signals.filter((s) => s.status === 'OPEN').map((s) => `${s.symbol}|${s.direction}`));
    const { approved, blocked } = guardSignals(rawSignals, {
      market, prices: priceMap, allowed: new Set(rows.map((r) => r.symbol)), bullish: mkt.bullish, openKeys
    });
    state.blocked = blocked;

    const created: AiEngineSignal[] = approved.map((a, idx) => {
      const s = a.raw;
      const diffTarget = Math.abs(a.target - a.entry);
      const diffStop = Math.abs(a.entry - a.stop);
      const rr = (diffTarget / diffStop).toFixed(1);
      const strategy: AiEngineSignal['strategy'] = s.strategy === 'AI_ENGINE_BREAKOUT' || s.strategy === 'AI_ENGINE_REVERSAL' ? s.strategy : 'AI_ENGINE_MOMENTUM';
      const thesis = String(s.thesis || 'Confluência de tendência e risco/retorno favorável detectada pelo modelo.').slice(0, 400);
      const level = s.riskLevel === 'BAIXO' || s.riskLevel === 'ALTO' ? s.riskLevel : 'MEDIO';
      return {
        id: `${a.symbol}-ai-${market}-${now}-${idx}`,
        market, symbol: a.symbol,
        baseAsset: String(s.baseAsset || a.symbol.replace('USDT', '')).toUpperCase(),
        direction: a.direction, strategy,
        strategyName: strategy === 'AI_ENGINE_BREAKOUT' ? 'Motor IA: Rompimento' : strategy === 'AI_ENGINE_REVERSAL' ? 'Motor IA: Reversão' : 'Motor IA: Momentum',
        timeframe: '4h', entryPrice: a.entry, targetPrice: a.target, stopLossPrice: a.stop, riskRewardRatio: `1:${rr}`,
        status: 'OPEN', technicalReason: thesis,
        indicatorsTriggered: ['Motor IA', `Confiança ${a.confidence}%`, `R:R 1:${rr}`],
        timestamp: 'agora', createdAt: now, isDemo: false, isAiGenerated: true,
        disclaimer: 'Sinal decidido por IA a partir do mercado e dos indicadores, dentro de travas de risco. Em validação: só simulação.',
        aiEngine: { isAiGenerated: true, confidence: a.confidence, verdict: a.direction === 'SHORT' ? 'SHORT APROVADO' : 'LONG APROVADO', thesis, riskLevel: level, analyzedAt: now }
      };
    });

    // 5. O histórico é mantido (antes cada rodada apagava o anterior), para medir o resultado ao vivo
    state.signals = [...created, ...state.signals].slice(0, 200);
    state.lastScanAt = now;
    persist(market);
    for (const s of created) await sendTelegram(alertAi(s, 'entry'));
    await refreshAiOutcomes(market);
    persist(market);
  } catch (err: any) {
    state.lastError = err?.message || 'Falha ao executar Motor de IA';
    console.error('Erro no runAiEngineScan:', err);
  } finally {
    state.running = false;
  }

  return getAiEngineState(market);
}

/**
 * Avalia um sinal específico sob demanda através do Motor de IA.
 */
export async function evaluateSignalWithAiEngine(signal: StoredSignal): Promise<{
  confidence: number;
  verdict: string;
  thesis: string;
  riskLevel: 'BAIXO' | 'MEDIO' | 'ALTO';
}> {
  const prompt = `Você é o MOTOR DE INTELIGÊNCIA ARTIFICIAL de trading de criptomoedas.
Avalie tecnicamente o seguinte sinal como motor decisório:

Ativo: ${signal.symbol} (${signal.timeframe})
Direção proposta: ${signal.direction}
Preço de Entrada: ${signal.entryPrice}
Alvo Projetado: ${signal.targetPrice}
Stop Loss: ${signal.stopLossPrice}
Estratégia base: ${signal.strategyName}
Motivo técnico: ${signal.technicalReason}
Indicadores: ${signal.indicatorsTriggered.join(', ')}

SUA TAREFA COMO MOTOR:
1. Valide a viabilidade da operação considerando a assimetria risco x retorno.
2. Atribua uma pontuação de confiança (0 a 100).
3. Emita o veredito do motor: "LONG APROVADO", "SHORT APROVADO", "ALERTA DE RUÍDO" ou "NEUTRO".
4. Redija a tese concisa (2 a 3 frases em português) do porquê o motor valida ou questiona esta entrada.
5. Indique o nível de risco ("BAIXO", "MEDIO", "ALTO").

Responda SOMENTE o JSON:
{
  "confidence": 85,
  "verdict": "SHORT APROVADO",
  "thesis": "Tese concisa do motor...",
  "riskLevel": "MEDIO"
}`;

  const jsonText = await callGeminiEngine(prompt, 18000);
  const parsed = JSON.parse(jsonText);
  return {
    confidence: Number(parsed.confidence) || 80,
    verdict: parsed.verdict || (signal.direction === 'LONG' ? 'LONG APROVADO' : 'SHORT APROVADO'),
    thesis: parsed.thesis || 'Operação validada com base na confluência de médias e risco controlado.',
    riskLevel: parsed.riskLevel || 'MEDIO'
  };
}

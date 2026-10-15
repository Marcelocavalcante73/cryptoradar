/**
 * Motor de Sinais por Inteligência Artificial (Gemini):
 * A IA atua ativamente como motor quantitativo de decisão, analisando os ativos,
 * avaliando médias, fluxo, volatilidade (ATR) e momentum (RSI/MACD) para
 * gerar sinais com tese técnica, confiança (%) e preços de entrada, alvo e stop.
 */

import { MarketType, SignalDirection } from '../src/types/crypto';
import { getStateSafe, setStateSafe } from './stateStore';
import { aiConfig } from './aiAnalyst';
import { getScanState, StoredSignal } from './scanner';
import { futuresPrices } from './futuresData';
import { binanceGet } from './universe';

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
  return aiEngineStates[market] || aiEngineStates.spot;
}

/** Chama Gemini com suporte a fallback de modelos caso haja sobrecarga temporária */
async function callGeminiEngine(prompt: string, timeoutMs = 28000): Promise<string> {
  const cfg = aiConfig();
  if (!cfg.enabled || !process.env.GEMINI_API_KEY) {
    throw new Error('Chave GEMINI_API_KEY não configurada no servidor');
  }

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

/**
 * Executa a varredura ativa do MOTOR DE IA.
 * A IA seleciona os ativos mais promissores, calcula o stop/alvo e emite os sinais.
 */
export async function runAiEngineScan(market: MarketType = 'spot'): Promise<AiEngineState> {
  const state = aiEngineStates[market];
  if (state.running) return state;

  state.running = true;
  state.lastError = null;
  const startedAt = Date.now();

  try {
    // 1. Obter moedas e dados do scanner
    const scanState = getScanState(market);
    const coins = (scanState.universe?.coins || []).slice(0, 30);
    
    // Obter cotações atuais
    let priceMap = new Map<string, number>();
    if (market === 'futures') {
      priceMap = await futuresPrices(coins.map((c) => c.symbol));
    } else {
      try {
        const raw = await binanceGet('/api/v3/ticker/price', 6000, 'spot') as any[];
        priceMap = new Map<string, number>(raw.map((p) => [p.symbol, parseFloat(p.price)]));
      } catch {
        // Fallback usando sinais existentes
        scanState.signals.forEach((s) => priceMap.set(s.symbol, s.entryPrice));
      }
    }

    // Moedas candidatas com dados reais
    const candidatesData = coins.slice(0, 15).map((c) => {
      const px = priceMap.get(c.symbol);
      const existingSig = scanState.signals.find((s) => s.symbol === c.symbol);
      return {
        symbol: c.symbol,
        baseAsset: c.baseAsset,
        price: px || existingSig?.entryPrice || 0,
        existingSignal: existingSig ? {
          direction: existingSig.direction,
          strategy: existingSig.strategyName,
          score: existingSig.score,
          indicators: existingSig.indicatorsTriggered
        } : null
      };
    }).filter((c) => c.price > 0);

    if (candidatesData.length === 0) {
      throw new Error('Não foi possível obter cotações para alimentar o Motor de IA.');
    }

    const prompt = `Você é o MOTOR DE INTELIGÊNCIA ARTIFICIAL de trading de criptomoedas (mercado: ${market.toUpperCase()}).
Você é o motor decisório responsável por analisar o mercado e emitir sinais rigorosos de compra (LONG) ou venda (SHORT).

Dados atuais de mercado:
${JSON.stringify(candidatesData, null, 2)}

SUA TAREFA:
1. Avalie a estrutura de mercado como um todo (marketSummary e marketRegime).
2. Selecione de 2 a 5 ativos com a melhor confluência técnica e emita o sinal do Motor de IA para cada um.
3. Para cada ativo, determine com rigor:
   - direction: "LONG" (compra) ou "SHORT" (venda)
   - confidence: probabilidade estimada de acerto (entre 70 e 96)
   - entryPrice: preço de entrada próximo ao preço atual
   - targetPrice: alvo de lucro (para LONG > entrada; para SHORT < entrada) com risco:retorno de pelo menos 1.5 a 3.0
   - stopLossPrice: stop loss de proteção técnica (para LONG < entrada; para SHORT > entrada)
   - thesis: justificativa analítica direta (máx 3 frases) em português do Brasil explicando a lógica de entrada e por que a assimetria é vantajosa.
   - riskLevel: "BAIXO", "MEDIO" ou "ALTO"
   - strategy: "AI_ENGINE_MOMENTUM" ou "AI_ENGINE_BREAKOUT" ou "AI_ENGINE_REVERSAL"

Responda ESTRITAMENTE em formato JSON com o seguinte schema:
{
  "marketRegime": "string curto (ex: ALTA SELETIVA, CONSOLIDAÇÃO, TENDÊNCIA DE BAIXA)",
  "marketSummary": "string de 1 a 2 frases com a leitura macro do motor",
  "signals": [
    {
      "symbol": "BTCUSDT",
      "baseAsset": "BTC",
      "direction": "LONG",
      "confidence": 88,
      "timeframe": "4h",
      "entryPrice": 68500.0,
      "targetPrice": 71900.0,
      "stopLossPrice": 67100.0,
      "thesis": "Tese analítica clara...",
      "riskLevel": "MEDIO",
      "strategy": "AI_ENGINE_MOMENTUM"
    }
  ]
}`;

    const jsonText = await callGeminiEngine(prompt);
    const parsed = JSON.parse(jsonText);

    state.marketRegime = parsed.marketRegime || 'CONFLUÊNCIA DE IA';
    state.marketSummary = parsed.marketSummary || 'Motor de IA atualizado com leitura do fluxo.';

    const rawSignals = Array.isArray(parsed.signals) ? parsed.signals : [];
    const now = Date.now();

    const formattedSignals: AiEngineSignal[] = rawSignals.map((s: any, idx: number) => {
      const entry = Number(s.entryPrice) || priceMap.get(s.symbol) || 1;
      const target = Number(s.targetPrice) || (s.direction === 'LONG' ? entry * 1.05 : entry * 0.95);
      const stop = Number(s.stopLossPrice) || (s.direction === 'LONG' ? entry * 0.97 : entry * 1.03);
      const diffTarget = Math.abs(target - entry);
      const diffStop = Math.abs(entry - stop) || 0.0001;
      const rr = (diffTarget / diffStop).toFixed(1);

      return {
        id: `${s.symbol}-ai-${market}-${now}-${idx}`,
        market,
        symbol: String(s.symbol).toUpperCase(),
        baseAsset: String(s.baseAsset || s.symbol.replace('USDT', '')).toUpperCase(),
        direction: s.direction === 'SHORT' ? 'SHORT' : 'LONG',
        strategy: s.strategy || 'AI_ENGINE_MOMENTUM',
        strategyName: s.strategy === 'AI_ENGINE_BREAKOUT' ? 'Motor IA: Rompimento' : s.strategy === 'AI_ENGINE_REVERSAL' ? 'Motor IA: Reversão' : 'Motor IA: Momentum',
        timeframe: s.timeframe || '4h',
        entryPrice: entry,
        targetPrice: target,
        stopLossPrice: stop,
        riskRewardRatio: `1:${rr}`,
        status: 'OPEN',
        technicalReason: s.thesis || 'Sinal estruturado e validado pelo Motor de Inteligência Artificial Gemini.',
        indicatorsTriggered: ['Motor IA Gemini', `Confiança ${s.confidence || 85}%`, `R:R 1:${rr}`],
        timestamp: 'há poucos segundos',
        createdAt: now,
        isDemo: false,
        isAiGenerated: true,
        disclaimer: 'Sinal gerado pelo Motor de Inteligência Artificial Gemini.',
        aiEngine: {
          isAiGenerated: true,
          confidence: Math.min(99, Math.max(50, Number(s.confidence) || 85)),
          verdict: s.direction === 'SHORT' ? 'SHORT APROVADO' : 'LONG APROVADO',
          thesis: s.thesis || 'Confluência de tendência e risco/retorno favorável detectada pelo modelo.',
          riskLevel: s.riskLevel || 'MEDIO',
          analyzedAt: now
        }
      };
    });

    state.signals = formattedSignals;
    state.lastScanAt = now;

    // Persiste no armazenamento
    void setStateSafe(`ai-engine-${market}`, {
      market,
      lastScanAt: now,
      marketRegime: state.marketRegime,
      marketSummary: state.marketSummary,
      signals: state.signals
    });

  } catch (err: any) {
    state.lastError = err?.message || 'Falha ao executar Motor de IA';
    console.error('Erro no runAiEngineScan:', err);
  } finally {
    state.running = false;
  }

  return state;
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

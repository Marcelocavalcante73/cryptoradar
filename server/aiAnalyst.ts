/**
 * Analista de IA (Gemini ou ChatGPT): EXPLICA e RESUME o que o scanner já calculou. Nunca cria nem altera sinais,
 * nunca prevê preço e nunca recomenda compra ou venda. O texto enviado ao modelo é montado aqui, no servidor,
 * a partir do estado dos scanners (o navegador só diz QUAL sinal quer explicar), e a resposta é guardada em cache.
 *
 * Configuração (variáveis de ambiente, só no servidor):
 *   GEMINI_API_KEY  (o AI Studio já injeta)  ou  OPENAI_API_KEY
 *   AI_PROVIDER     gemini | openai (padrão: o que tiver chave, Gemini primeiro)
 *   AI_MODEL        padrão gemini-2.5-flash / gpt-4o-mini
 *   AI_DAILY_LIMIT  máximo de chamadas ao modelo por dia (padrão 150), para limitar custo
 */

import { getScanState } from './scanner';
import { getTrendState } from './trendScanner';
import { getB3State } from './b3Scanner';

export type AiProvider = 'gemini' | 'openai';
export type ExplainKind = 'crypto-signal' | 'crypto-trend' | 'b3-signal' | 'b3-trend';

const validKey = (k: string | undefined) => !!k && k.trim().length >= 20 && !/^MY_/i.test(k.trim());

export function aiConfig(env: NodeJS.ProcessEnv = process.env): { enabled: boolean; provider: AiProvider | null; model: string | null } {
  const want = (env.AI_PROVIDER || '').toLowerCase();
  const hasG = validKey(env.GEMINI_API_KEY), hasO = validKey(env.OPENAI_API_KEY);
  const provider: AiProvider | null =
    want === 'openai' ? (hasO ? 'openai' : null) : want === 'gemini' ? (hasG ? 'gemini' : null) : hasG ? 'gemini' : hasO ? 'openai' : null;
  if (!provider) return { enabled: false, provider: null, model: null };
  const model = env.AI_MODEL?.trim() || (provider === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4o-mini');
  return { enabled: true, provider, model };
}

const SYSTEM = [
  'Você é um analista que EXPLICA, em português do Brasil e em linguagem simples, sinais de swing trade calculados por um sistema automático.',
  'Use SOMENTE os dados fornecidos em JSON. Não invente notícias, números, resultados de empresas nem datas.',
  'Não preveja preços, não diga que algo vai subir ou cair, e não recomende comprar ou vender: descreva o que o sistema detectou, o que o stop e o alvo significam e quais são os riscos.',
  'Lembre, em uma frase, que a estratégia está em validação (só simulação) quando o JSON indicar isso.',
  'Seja curto: no máximo 120 palavras para um sinal e 160 para um resumo. Sem títulos, sem markdown pesado; pode usar frases curtas ou até 4 marcadores.'
].join(' ');

interface AiResult { status: number; json: any }
const cache = new Map<string, { text: string; at: number }>();
let usage = { day: '', n: 0 };

const dailyLimit = () => Math.max(1, Number(process.env.AI_DAILY_LIMIT) || 150);

export function takeBudget(): boolean {
  const day = new Date().toISOString().slice(0, 10);
  if (usage.day !== day) usage = { day, n: 0 };
  if (usage.n >= dailyLimit()) return false;
  usage.n++;
  return true;
}

/** Só para testes. */
export function resetAiState() { cache.clear(); usage = { day: '', n: 0 }; }

export interface GenOptions { json?: boolean; temperature?: number; maxTokens?: number; timeoutMs?: number }

export async function generateText(system: string, user: string, opts: GenOptions | number = {}): Promise<string> {
  const o: GenOptions = typeof opts === 'number' ? { timeoutMs: opts } : opts;
  const timeoutMs = o.timeoutMs ?? 25000;
  const temperature = o.temperature ?? 0.3;
  const cfg = aiConfig();
  if (!cfg.enabled || !cfg.provider || !cfg.model) throw new Error('IA desligada');
  if (cfg.provider === 'gemini') {
    const candidates = Array.from(new Set([cfg.model, 'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-flash-latest'])).filter(Boolean);
    let lastErr: Error | null = null;
    for (let i = 0; i < candidates.length; i++) {
      const modelName = candidates[i];
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY!.trim() },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: user }] }],
            generationConfig: { temperature, maxOutputTokens: o.maxTokens ?? 1500, ...(o.json ? { responseMimeType: 'application/json' } : {}) }
          }),
          signal: AbortSignal.timeout(timeoutMs)
        });
        const raw = await r.text();
        let j: any = null;
        try {
          j = raw ? JSON.parse(raw) : null;
        } catch {
          if (/^\s*<(!doctype|html)/i.test(raw)) {
            throw new Error(`Gemini respondeu com página HTML (HTTP ${r.status})`);
          }
          throw new Error(`Resposta inválida do Gemini (HTTP ${r.status})`);
        }
        if (!r.ok) {
          const errMsg = j?.error?.message || `Gemini HTTP ${r.status}`;
          if ((r.status === 404 || r.status === 503 || r.status === 429) && i < candidates.length - 1) {
            lastErr = new Error(errMsg);
            continue;
          }
          throw new Error(errMsg);
        }
        const text = (j?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('').trim();
        if (!text) {
          if (i < candidates.length - 1) {
            lastErr = new Error('Gemini respondeu vazio');
            continue;
          }
          throw new Error('Gemini respondeu vazio');
        }
        return text;
      } catch (err: any) {
        lastErr = err;
        if (i < candidates.length - 1) {
          continue;
        }
        throw err;
      }
    }
    throw lastErr || new Error('Nenhum modelo Gemini respondeu');
  }
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY!.trim()}` },
    body: JSON.stringify({
      model: cfg.model, temperature, max_completion_tokens: o.maxTokens ?? 700, ...(o.json ? { response_format: { type: 'json_object' } } : {}),
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const raw = await r.text();
  let j: any = null;
  try {
    j = raw ? JSON.parse(raw) : null;
  } catch {
    if (/^\s*<(!doctype|html)/i.test(raw)) {
      throw new Error(`A OpenAI respondeu com página HTML (HTTP ${r.status}) em vez de JSON.`);
    }
    throw new Error(`Resposta inválida da OpenAI (HTTP ${r.status}).`);
  }
  if (!r.ok) throw new Error(j?.error?.message || `OpenAI HTTP ${r.status}`);
  const text = String(j?.choices?.[0]?.message?.content ?? '').trim();
  if (!text) throw new Error('OpenAI respondeu vazio');
  return text;
}

const round = (n: unknown, d = 2) => (typeof n === 'number' && Number.isFinite(n) ? Number(n.toFixed(d)) : n);

/** Dados (já filtrados) que o modelo pode ver sobre um sinal. null = sinal não existe. */
export function explainContext(kind: ExplainKind, id: string): { subject: string; data: any } | null {
  if (kind === 'crypto-signal') {
    for (const m of ['spot', 'futures'] as const) {
      let s: any = getScanState(m).signals.find((x) => x.id === id);
      if (!s) {
        const prefix = id.split('-').slice(0, 2).join('-');
        s = getScanState(m).signals.find((x) => x.id.startsWith(prefix));
      }
      if (s) return {
        subject: `Sinal de ${s.direction === 'LONG' ? 'compra' : 'venda'} em ${s.baseAsset} (${m === 'futures' ? 'futuros' : 'spot'}, ${s.timeframe})`,
        data: {
          mercado: m, direcao: s.direction, estrategia: s.strategyName, entrada: s.entryPrice, alvo: s.targetPrice, stop: s.stopLossPrice,
          risco_retorno: s.riskRewardRatio, status: s.status, motivo: s.technicalReason, indicadores: s.indicatorsTriggered,
          estrategia_em_validacao: true, observacao: 'Nos backtests o motor de indicadores das criptos NÃO mostrou vantagem (fator de lucro abaixo de 1).'
        }
      };
    }
    return null;
  }
  if (kind === 'crypto-trend') {
    const t = getTrendState();
    const s: any = t.signals.find((x) => x.id === id);
    if (!s) return null;
    return {
      subject: `Sinal de tendência (rompimento de 55 dias) em ${s.baseAsset}`,
      data: {
        status: s.status, referencia: s.refPrice, entrada: s.entryPrice, stop: s.stopPrice, sair_se_fechar_abaixo_de: s.exitLevel,
        ultimo_preco: s.lastPrice, atr: round(s.atr, 6), bitcoin_acima_da_media_200d: t.regime?.bullish,
        regras: 'Compra rompimento da máxima de 55 dias com o Bitcoin acima da média de 200 dias; stop de 2 ATR; sai ao fechar abaixo da mínima de 20 dias; sem alvo fixo.',
        estrategia_em_validacao: true, observacao: 'Passou no backtest em 17 moedas (fator de lucro 2,2), mas ainda precisa de validação ao vivo.'
      }
    };
  }
  const b = getB3State();
  const mkt = b.market && { ibovespa: round(b.market.close), media_50: round(b.market.sma50), media_200: round(b.market.sma200), variacao_20_pregoes_pct: round(b.market.change20dPct), leitura: b.market.label };
  if (kind === 'b3-signal') {
    const s: any = b.indicators.signals.find((x) => x.id === id);
    if (!s) return null;
    return {
      subject: `Sinal de compra (indicadores) em ${s.symbol}, swing trade`,
      data: {
        acao: s.symbol, pontuacao: s.score, status: s.status, referencia: s.refPrice, entrada: s.entryPrice, stop: s.stopPrice, alvo: s.targetPrice,
        ultimo_preco: s.lastPrice, mercado: mkt, prazo_maximo_pregoes: 20,
        regras: 'Médias EMA 20/50, MACD, RSI e volume somam pontuação; compra com 60 ou mais e Ibovespa acima da média de 200 dias; stop 1,5 ATR; alvo 3 ATR.',
        estrategia_em_validacao: true, observacao: 'Ainda sem resultado ao vivo; nas criptos esse mesmo motor não mostrou vantagem.'
      }
    };
  }
  const s: any = b.trend.signals.find((x) => x.id === id);
  if (!s) return null;
  return {
    subject: `Sinal de tendência (rompimento de 55 dias) em ${s.symbol}, swing trade`,
    data: {
      acao: s.symbol, status: s.status, referencia: s.refPrice, entrada: s.entryPrice, stop: s.stopPrice, sair_se_fechar_abaixo_de: s.exitLevel,
      ultimo_preco: s.lastPrice, mercado: mkt,
      regras: 'Compra rompimento da máxima de 55 pregões com Ibovespa acima da média de 200 dias; stop de 2 ATR; sai ao fechar abaixo da mínima de 20 pregões.',
      estrategia_em_validacao: true, observacao: 'No backtest da B3 o retorno foi próximo ou abaixo do CDI e a segunda metade do período foi mais fraca.'
    }
  };
}

export function summaryContext(section: 'crypto' | 'b3'): { subject: string; data: any } {
  if (section === 'b3') {
    const b = getB3State();
    const open = (arr: any[]) => arr.filter((s) => s.status === 'OPEN' || s.status === 'EXIT_SIGNAL');
    return {
      subject: 'Resumo do dia na B3 (swing trade)',
      data: {
        mercado: b.market && { ibovespa: round(b.market.close), media_200: round(b.market.sma200), variacao_20_pregoes_pct: round(b.market.change20dPct), leitura: b.market.label, compras_liberadas: b.market.bullish },
        sinais_indicadores_abertos: open(b.indicators.signals).slice(0, 6).map((s) => ({ acao: s.symbol, pontuacao: s.score, status: s.status, entrada: s.entryPrice ?? s.refPrice, stop: s.stopPrice, alvo: s.targetPrice })),
        posicoes_tendencia_abertas: open(b.trend.signals).slice(0, 6).map((s) => ({ acao: s.symbol, status: s.status, entrada: s.entryPrice ?? s.refPrice, stop: s.stopPrice })),
        perto_de_romper: b.trend.watch.slice(0, 5).map((w) => ({ acao: w.symbol, falta_pct: round(w.distancePct) })),
        mais_fortes_por_pontuacao: b.indicators.scores.slice(0, 5).map((r) => ({ acao: r.symbol, pontuacao: r.score })),
        estrategia_em_validacao: true
      }
    };
  }
  const t = getTrendState();
  const sp = getScanState('spot'), fu = getScanState('futures');
  const open = (a: any[]) => a.filter((s) => s.status === 'OPEN');
  return {
    subject: 'Resumo do dia nas criptomoedas',
    data: {
      bitcoin_acima_da_media_200d: t.regime?.bullish,
      sinais_spot_abertos: open(sp.signals).slice(0, 5).map((s: any) => ({ moeda: s.baseAsset, direcao: s.direction, estrategia: s.strategyName, entrada: s.entryPrice, stop: s.stopLossPrice, alvo: s.targetPrice })),
      sinais_futuros_abertos: open(fu.signals).slice(0, 5).map((s: any) => ({ moeda: s.baseAsset, direcao: s.direction, entrada: s.entryPrice, stop: s.stopLossPrice, alvo: s.targetPrice })),
      posicoes_tendencia_abertas: t.signals.filter((s) => s.status === 'OPEN' || s.status === 'EXIT_SIGNAL').slice(0, 5).map((s) => ({ moeda: s.baseAsset, status: s.status, entrada: s.entryPrice ?? s.refPrice, stop: s.stopPrice })),
      perto_de_romper: t.watch.slice(0, 5).map((w) => ({ moeda: w.baseAsset, falta_pct: round(w.distancePct) })),
      estrategia_em_validacao: true,
      observacao: 'Os sinais por indicadores não passaram no backtest; a estratégia de tendência passou, mas ainda precisa de validação ao vivo.'
    }
  };
}

async function answer(key: string, ttlMs: number, ctx: { subject: string; data: any }, ask: string): Promise<AiResult> {
  const cfg = aiConfig();
  if (!cfg.enabled) return { status: 503, json: { error: 'A análise com IA está desligada. Defina GEMINI_API_KEY ou OPENAI_API_KEY no servidor.' } };
  const payload = JSON.stringify(ctx.data);
  const ck = `${key}|${payload.length}|${payload.slice(0, 2000)}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < ttlMs) return { status: 200, json: { text: hit.text, provider: cfg.provider, model: cfg.model, cached: true, at: hit.at } };
  if (!takeBudget()) return { status: 429, json: { error: 'Limite diário de análises com IA atingido. Tente amanhã.' } };
  try {
    const text = await generateText(SYSTEM, `${ask}\n\nAssunto: ${ctx.subject}\nDados (JSON):\n${payload}`);
    const at = Date.now();
    cache.set(ck, { text, at });
    if (cache.size > 300) cache.delete(cache.keys().next().value as string);
    return { status: 200, json: { text, provider: cfg.provider, model: cfg.model, cached: false, at } };
  } catch (e: any) {
    return { status: 502, json: { error: `A IA não respondeu (${e?.message ?? 'erro'}).` } };
  }
}

const KINDS: ExplainKind[] = ['crypto-signal', 'crypto-trend', 'b3-signal', 'b3-trend'];

export async function aiExplain(kind: unknown, id: unknown): Promise<AiResult> {
  if (typeof kind !== 'string' || !KINDS.includes(kind as ExplainKind) || typeof id !== 'string' || id.length > 80) {
    return { status: 400, json: { error: 'Pedido inválido.' } };
  }
  const ctx = explainContext(kind as ExplainKind, id);
  if (!ctx) return { status: 404, json: { error: 'Sinal não encontrado (pode ter sido atualizado).' } };
  return answer(`explain:${kind}:${id}`, 30 * 60e3, ctx,
    'Explique este sinal para um investidor iniciante: o que o sistema detectou, onde ficam o stop e o alvo (e o que significam em % de risco), e 2 ou 3 riscos concretos.');
}

export async function aiSummary(section: unknown): Promise<AiResult> {
  if (section !== 'crypto' && section !== 'b3') return { status: 400, json: { error: 'Pedido inválido.' } };
  return answer(`summary:${section}`, 15 * 60e3, summaryContext(section),
    'Faça um resumo curto da situação de hoje: como está o mercado (filtro de tendência), o que há de sinal aberto, o que está perto de romper e o que merece cuidado. Se não houver sinais, diga isso com naturalidade.');
}

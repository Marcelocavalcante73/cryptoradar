/**
 * Configuração e chamada ao provedor de IA (Gemini ou ChatGPT), usadas pelos motores de IA (server/aiEngine.ts e aiSwing.ts).
 * Chaves só no servidor:
 *   GEMINI_API_KEY  (o AI Studio já injeta)  ou  OPENAI_API_KEY
 *   AI_PROVIDER     gemini | openai (padrão: o que tiver chave, Gemini primeiro)
 *   AI_MODEL        padrão gemini-2.5-flash / gpt-4o-mini
 *   AI_DAILY_LIMIT  máximo de chamadas ao modelo por dia (padrão 150), para limitar custo
 */

export type AiProvider = 'gemini' | 'openai';

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
export function resetAiState() { usage = { day: '', n: 0 }; }

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

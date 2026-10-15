/**
 * Motor de IA da B3 no servidor (swing trade): uma decisão por dia, quando fecha um pregão novo, mais a atualização dos
 * sinais abertos (stop, alvo, prazo) a cada 30 minutos. A decisão pode ser pedida na hora pelo botão.
 * Os sinais ficam guardados e são medidos pelos mesmos critérios das outras estratégias (aba Resultados).
 * (O motor de IA das criptos é outro: server/aiEngine.ts.)
 */

import { CandleData } from '../src/types/crypto';
import { B3Signal, MarketTrend, marketTrend, updateIndicatorSignal, isB3Done } from '../src/services/b3Signals';
import { AiRow, AiDecision, computeRow, buildPrompt, parseDecisions, pickEntries, aiSignalFrom } from '../src/services/aiSwing';
import { splitClosed } from '../src/services/trendSignals';
import { B3_TICKERS, IBOV_SYMBOL, fetchB3Daily } from './b3Data';
import { aiConfig, generateText, takeBudget } from './aiAnalyst';
import { sendTelegram } from './scanner';
import { getStateSafe, setStateSafe } from './stateStore';

const MAX_HISTORY = 200;
const MAX_LOG = 40;

export interface DecisionLog {
  day: number; at: number; provider: string | null; model: string | null;
  items: { symbol: string; action: 'BUY' | 'WAIT'; confidence: number; reason: string }[];
  blocked: { symbol: string; why: string }[];
  created: string[];
}

export interface MarketAi {
  running: boolean;
  lastRunAt: number | null;
  lastDecisionDay: number | null;
  lastError: string | null;
  market: MarketTrend | null;
  signals: B3Signal[];
  log: DecisionLog | null;       // última rodada de decisões (inclui o que a IA decidiu esperar)
}

export interface AiSwingState extends MarketAi { enabled: boolean; provider: string | null; model: string | null }

const blank = (): MarketAi => ({ running: false, lastRunAt: null, lastDecisionDay: null, lastError: null, market: null, signals: [], log: null });
let st: MarketAi = blank();

const money = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function getAiSwingState(): AiSwingState {
  const c = aiConfig();
  return { enabled: c.enabled, provider: c.provider, model: c.model, ...st };
}

export async function loadAiSwing() {
  if (process.env.AI_PERSIST === 'off') return;
  const snap = await getStateSafe('ai-swing-b3');
  if (snap?.value && Array.isArray(snap.value.signals)) st = { ...blank(), ...snap.value, running: false };
}

function save() {
  if (process.env.AI_PERSIST === 'off') return;
  void setStateSafe('ai-swing-b3', { ...st, running: false });
}

export function resetAiSwing() { st = blank(); busy = false; }

async function loadSet(symbols: string[]): Promise<Map<string, CandleData[]>> {
  const out = new Map<string, CandleData[]>();
  let i = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (i < symbols.length) {
      const sym = symbols[i++];
      try { out.set(sym, await fetchB3Daily(sym)); } catch { /* ativo sem dados nesta rodada */ }
    }
  }));
  return out;
}

const alertText = (kind: 'entry' | 'exit', s: B3Signal): string => {
  const tag = 'B3';
  if (kind === 'entry') {
    return [
      `🤖 *[IA · ${tag}] COMPRAR* ${s.symbol} (swing, diário)`,
      `Confiança ${s.confidence}/100. ${s.reason ?? ''}`.trim(),
      `Entrada: ${money(s.entryPrice ?? s.refPrice)} (abertura do próximo pregão)`,
      `Stop: ${money(s.stopPrice)} (${s.stopMult} ATR)  ·  Alvo: ${money(s.targetPrice)} (${s.targetMult} ATR)`,
      `Prazo máximo: ${s.holdDays} pregões.`,
      '', '_Decisão automática de IA, em validação: só simulação. Não é recomendação de investimento._'
    ].join('\n');
  }
  const why = s.status === 'STOP' ? 'stop atingido' : s.status === 'TARGET' ? 'alvo atingido' : 'prazo vencido';
  return [`🔔 *[IA · ${tag}] SAIR* ${s.symbol}`, `Motivo: ${why}.`, s.status === 'EXIT_SIGNAL' ? 'Saia na abertura do próximo pregão.' : `Saída em ${money(s.exitPrice ?? s.lastPrice ?? 0)}.`, '', '_Não é recomendação de investimento._'].join('\n');
};

let busy = false;

/**
 * Uma rodada: atualiza os sinais abertos e, se houver vela diária nova (ou force), pede à IA as decisões.
 * Devolve uma mensagem curta de resultado (para o botão da tela).
 */
export async function runAiSwing(force = false): Promise<{ ok: boolean; message: string }> {
  if (busy) return { ok: true, message: 'Já está rodando.' };
  busy = true;
  st.running = true;
  try {
    const cfg = aiConfig();
    const now = Date.now();
    const alerts: string[] = [];
    const openSyms = () => st.signals.filter((s) => !isB3Done(s)).map((s) => s.symbol);

    // 1) vela de referência (Ibovespa): mercado e dia fechado mais recente
    const refAll = await fetchB3Daily(IBOV_SYMBOL);
    const { closed: refClosed } = splitClosed(refAll, now);
    const mkt = marketTrend(refClosed);
    if (!mkt) throw new Error('histórico da referência insuficiente');
    st.market = mkt;
    const refDay = refClosed[refClosed.length - 1].timestamp;
    const newDay = st.lastDecisionDay === null || refDay > st.lastDecisionDay;
    const decide = cfg.enabled && (force || newDay);

    // 2) candles: todos se vai decidir; senão só os dos sinais abertos
    const need = decide ? B3_TICKERS : [...new Set(openSyms())];
    if (!decide && need.length === 0) { st.lastRunAt = now; st.lastError = null; return { ok: true, message: 'Nada a atualizar.' }; }
    const data = await loadSet(need);

    // 3) atualiza sinais abertos
    for (let k = 0; k < st.signals.length; k++) {
      const s = st.signals[k];
      const candles = data.get(s.symbol);
      if (isB3Done(s) || !candles) continue;
      const before = s.status;
      const upd = updateIndicatorSignal(s, candles, now);
      if (upd.status !== before && upd.status !== 'OPEN' && !upd.alertedExit) { alerts.push(alertText('exit', upd)); upd.alertedExit = true; }
      st.signals[k] = upd;
    }

    let message = 'Sinais atualizados.';
    if (decide) {
      const closedBy = new Map<string, CandleData[]>();
      const rows: AiRow[] = [];
      for (const sym of B3_TICKERS) {
        const c = data.get(sym);
        if (!c) continue;
        const cl = splitClosed(c, now).closed;
        const row = computeRow(sym, cl);
        if (row) { rows.push(row); closedBy.set(sym, cl); }
      }
      if (rows.length < 5) throw new Error('Poucos ativos com dados suficientes');
      if (!takeBudget()) throw new Error('Limite diário de chamadas à IA atingido');
      const { system, user } = buildPrompt(mkt, rows);
      const text = await generateText(system, user, { json: true, temperature: 0.2, maxTokens: 6000, timeoutMs: 60000 });
      const decisions: AiDecision[] = parseDecisions(text, new Set(rows.map((r) => r.symbol)));
      if (decisions.length === 0) throw new Error('A IA respondeu fora do formato esperado');
      const { approved, blocked } = pickEntries(decisions, { bullish: mkt.bullish, openSymbols: new Set(openSyms()) });
      const created: string[] = [];
      for (const d of approved) {
        const sig = aiSignalFrom(d, closedBy.get(d.symbol)!, now);
        if (!sig || st.signals.some((x) => x.id === sig.id)) continue;
        const withEntry = updateIndicatorSignal(sig, data.get(d.symbol)!, now);
        st.signals.unshift(withEntry);
        created.push(d.symbol);
        alerts.push(alertText('entry', withEntry));
      }
      st.log = {
        day: refDay, at: now, provider: cfg.provider, model: cfg.model,
        items: decisions.map((d) => ({ symbol: d.symbol, action: d.action, confidence: d.confidence, reason: d.reason })).slice(0, MAX_LOG),
        blocked, created
      };
      st.lastDecisionDay = refDay;
      message = created.length ? `${created.length} sinal(is) novo(s): ${created.join(', ')}.` : 'A IA decidiu esperar: nenhum sinal novo.';
    } else if (!cfg.enabled) {
      message = 'IA desligada: só os sinais abertos foram atualizados.';
    }

    st.signals = st.signals.slice(0, MAX_HISTORY);
    st.lastError = null;
    st.lastRunAt = now;
    save();
    for (const a of alerts) await sendTelegram(a);
    return { ok: true, message };
  } catch (e: any) {
    st.lastError = e?.message || 'Erro desconhecido no motor de IA';
    st.lastRunAt = Date.now();
    return { ok: false, message: st.lastError! };
  } finally {
    st.running = false;
    busy = false;
  }
}

/** Roda a cada 30 minutos: atualiza sinais abertos e decide quando surge pregão novo. Desligue com AI_SWING_AUTO=false. */
export function startAiSwing(intervalMinutes = 30) {
  if (process.env.AI_SWING_AUTO === 'false') return;
  setTimeout(() => { void runAiSwing(); setInterval(() => { void runAiSwing(); }, intervalMinutes * 60e3); }, 90000);
}

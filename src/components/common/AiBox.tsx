import React, { useEffect, useState } from 'react';
import { accessKey } from '../../services/remoteState';
import { fetchJson, safeReadJson } from '../../services/http';

type Status = { enabled: boolean; provider: string | null } | null;
let statusPromise: Promise<Status> | null = null;

/** Se a IA está ligada no servidor (uma consulta por abertura do app). */
const loadStatus = (): Promise<Status> => {
  if (!statusPromise) {
    statusPromise = fetch('/api/ai/status', { signal: AbortSignal.timeout(6000) })
      .then((r) => safeReadJson<any>(r, null, '/api/ai/status')).then((j) => (j && typeof j.enabled === 'boolean' ? j : null)).catch(() => { statusPromise = null; return null; });
  }
  return statusPromise;
};

const useAiStatus = () => {
  const [s, setS] = useState<Status>(null);
  useEffect(() => { let on = true; loadStatus().then((v) => { if (on) setS(v); }); return () => { on = false; }; }, []);
  return s;
};

const headers = (): Record<string, string> => {
  const k = accessKey.get();
  return { 'Content-Type': 'application/json', ...(k ? { 'X-Access-Key': k } : {}) };
};

const label = (p: string | null) => (p === 'openai' ? 'ChatGPT' : p === 'gemini' ? 'Gemini' : 'IA');

const Answer: React.FC<{ text: string; provider: string | null }> = ({ text, provider }) => (
  <div className="mt-3 bg-[#0f1115] border border-[#23272f] rounded-lg p-3">
    <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-line">{text}</p>
    <p className="text-[11px] text-slate-500 mt-2">Explicação gerada por {label(provider)} a partir dos dados do sinal. Não prevê preço nem é recomendação de investimento.</p>
  </div>
);

/** Botão "Explicar" de um sinal. Não aparece se a IA estiver desligada no servidor. */
export const AiExplain: React.FC<{ kind: 'crypto-signal' | 'crypto-trend' | 'b3-signal' | 'b3-trend'; id: string }> = ({ kind, id }) => {
  const status = useAiStatus();
  const [state, setState] = useState<{ loading: boolean; text?: string; error?: string; provider?: string | null }>({ loading: false });
  if (!status?.enabled) return null;

  const ask = async () => {
    setState({ loading: true, error: undefined });
    try {
      const { ok, status, json: j } = await fetchJson('/api/ai/explain', { method: 'POST', headers: headers(), body: JSON.stringify({ kind, id }), signal: AbortSignal.timeout(35000) });
      if (!ok || j?.error) throw new Error(j?.error || `Erro ${status}`);
      setState({ loading: false, text: j.text, provider: j.provider });
    } catch (e: any) {
      const msg = e?.name === 'OldServerError' || /versão antiga|não reconhece/i.test(e?.message)
        ? 'O servidor foi atualizado com novos recursos. Recarregue a página para sincronizar.'
        : e?.message || 'Não foi possível explicar agora.';
      setState({ loading: false, error: msg });
    }
  };

  return (
    <div className="mt-3">
      {!state.text && (
        <button onClick={ask} disabled={state.loading} className="text-sm text-slate-300 underline underline-offset-4 disabled:opacity-50">
          {state.loading ? 'Analisando…' : `Explicar com ${label(status.provider)}`}
        </button>
      )}
      {state.error && <p className="text-xs text-rose-400 mt-1">{state.error}</p>}
      {state.text && <Answer text={state.text} provider={state.provider ?? status.provider} />}
    </div>
  );
};

/** Resumo do dia da seção (cripto ou B3), gerado sob demanda. */
export const AiSummary: React.FC<{ section: 'crypto' | 'b3' }> = ({ section }) => {
  const status = useAiStatus();
  const [state, setState] = useState<{ loading: boolean; text?: string; error?: string; provider?: string | null }>({ loading: false });
  if (!status?.enabled) return null;

  const ask = async () => {
    setState((s) => ({ ...s, loading: true, error: undefined }));
    try {
      const { ok, status, json: j } = await fetchJson(`/api/ai/summary?section=${section}`, { headers: headers(), signal: AbortSignal.timeout(35000) });
      if (!ok || j?.error) throw new Error(j?.error || `Erro ${status}`);
      setState({ loading: false, text: j.text, provider: j.provider });
    } catch (e: any) {
      const msg = e?.name === 'OldServerError' || /versão antiga|não reconhece/i.test(e?.message)
        ? 'O servidor foi atualizado com novos recursos. Recarregue a página para sincronizar.'
        : e?.message || 'Não foi possível resumir agora.';
      setState({ loading: false, error: msg });
    }
  };

  return (
    <section className="bg-[#161920] border border-[#23272f] rounded-xl p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-200">Resumo do dia</span>
        <button onClick={ask} disabled={state.loading} className="text-sm text-slate-300 underline underline-offset-4 disabled:opacity-50">
          {state.loading ? 'Analisando…' : state.text ? 'Atualizar' : `Gerar com ${label(status.provider)}`}
        </button>
      </div>
      {state.error && <p className="text-xs text-rose-400 mt-2">{state.error}</p>}
      {state.text && <Answer text={state.text} provider={state.provider ?? status.provider} />}
    </section>
  );
};

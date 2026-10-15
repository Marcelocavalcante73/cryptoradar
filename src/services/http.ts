/**
 * fetch + JSON com erro claro. Se o servidor publicado está numa versão antiga (sem a rota nova), ele devolve a página
 * do app (HTML) em vez de JSON, e o navegador mostra "Unexpected token '<'". Aqui isso vira uma mensagem que explica o que fazer.
 */

export class OldServerError extends Error {
  constructor(url: string) {
    super(`O servidor não reconhece ${url.split('?')[0]}: a publicação está numa versão antiga. Atualize o código no AI Studio, publique de novo e recarregue a página.`);
    this.name = 'OldServerError';
  }
}

export async function readJson<T = any>(r: Response, url: string = ''): Promise<T> {
  const text = await r.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    if (/^\s*<(!doctype|html)/i.test(text)) throw new OldServerError(url || r.url || 'servidor');
    throw new Error(`Resposta inesperada do servidor (HTTP ${r.status}).`);
  }
}
export async function safeReadJson<T = any>(r: Response, fallback: T, url: string = ''): Promise<T> {
  try {
    const text = await r.text();
    if (!text || /^\s*<(!doctype|html|\?xml)/i.test(text)) return fallback;
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export async function fetchJson<T = any>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; json: T }> {
  const r = await fetch(url, init);
  const json = await readJson<T>(r, url);
  return { ok: r.ok, status: r.status, json };
}

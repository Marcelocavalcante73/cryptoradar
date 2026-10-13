/**
 * Armazenamento local seguro. Em páginas dentro de um quadro (ex.: pré-visualização do AI Studio) ou com dados de site
 * bloqueados, o navegador lança erro ao usar localStorage. Antes isso era engolido e NADA era salvo, sem aviso.
 * Aqui há uma memória reserva (vale enquanto a página estiver aberta) e um indicador de que o armazenamento está bloqueado.
 */

const mem = new Map<string, string>();
let blocked = false;

function backing(): Storage | null {
  try {
    const s = (globalThis as any).localStorage as Storage | undefined;
    if (!s) return null;
    const probe = '__cryptoradar_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export const localStore = {
  get(key: string): string | null {
    const s = backing();
    if (!s) { blocked = true; return mem.get(key) ?? null; }
    try { return s.getItem(key) ?? mem.get(key) ?? null; } catch { blocked = true; return mem.get(key) ?? null; }
  },

  set(key: string, value: string): boolean {
    mem.set(key, value); // sempre mantém a cópia em memória
    const s = backing();
    if (!s) { blocked = true; return false; }
    try { s.setItem(key, value); return true; } catch { blocked = true; return false; }
  },

  remove(key: string): void {
    mem.delete(key);
    try { backing()?.removeItem(key); } catch { /* ignora */ }
  },

  /** true se o navegador está bloqueando o armazenamento local (os dados só valem até fechar a página). */
  isBlocked(): boolean {
    if (!blocked && !backing()) blocked = true;
    return blocked;
  }
};

import React, { useState } from 'react';
import { accessKey, verifyAccessKey } from '../../services/remoteState';

/** Tela de entrada quando o servidor exige chave de acesso (APP_ACCESS_KEY). Protege a sua carteira e o seu histórico. */
export const AccessGate: React.FC<{ onUnlocked: () => void }> = ({ onUnlocked }) => {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const ok = await verifyAccessKey(value.trim());
    setBusy(false);
    if (!ok) return setError('Chave incorreta (ou o servidor não respondeu). Tente de novo.');
    accessKey.set(value.trim());
    onUnlocked();
  };

  return (
    <div className="min-h-screen bg-[#0B0E11] text-[#EAECEF] flex items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-sm bg-[#181A20] border border-[#2B313A] rounded-xl p-6 space-y-4 shadow-xl">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2.5 h-2.5 rounded-sm bg-[#F0B90B]" />
            <h1 className="text-lg font-bold tracking-tight">
              <span className="text-[#F0B90B]">Crypto</span>
              <span className="text-[#EAECEF]">Radar</span>
            </h1>
          </div>
          <p className="text-xs text-[#848E9C] leading-relaxed">Digite a chave de acesso para sincronizar a carteira e o motor de sinais.</p>
        </div>
        <input
          type="password"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Chave de acesso"
          className="w-full bg-[#121418] border border-[#2B313A] rounded-lg px-3 py-2.5 text-sm text-[#EAECEF] focus:outline-none focus:border-[#F0B90B]"
        />
        {error && <p className="text-xs text-[#F6465D]">{error}</p>}
        <button
          disabled={busy || !value.trim()}
          className="w-full bg-[#F0B90B] hover:bg-[#FCD535] text-black font-semibold text-xs py-2.5 rounded-lg disabled:opacity-40 transition-colors cursor-pointer shadow-sm"
        >
          {busy ? 'Verificando…' : 'Acessar Terminal'}
        </button>
      </form>
    </div>
  );
};

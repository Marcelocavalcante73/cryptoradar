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
    <div className="min-h-screen bg-[#0f1115] text-slate-100 flex items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-sm bg-[#161920] border border-[#23272f] rounded-xl p-5 space-y-4">
        <div>
          <h1 className="text-lg font-semibold">CryptoRadar</h1>
          <p className="text-sm text-slate-400 mt-1 leading-relaxed">Digite a chave de acesso para ver a sua carteira e o seu histórico.</p>
        </div>
        <input
          type="password"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Chave de acesso"
          className="w-full bg-[#0f1115] border border-[#2a2f3a] rounded-lg px-3 py-3 text-base text-slate-100 focus:outline-none focus:border-slate-400"
        />
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button disabled={busy || !value.trim()} className="w-full bg-slate-100 text-slate-900 font-semibold py-3 rounded-lg disabled:opacity-40">
          {busy ? 'Verificando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
};

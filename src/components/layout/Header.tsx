import React from 'react';
import { RefreshCw, Settings } from 'lucide-react';

interface HeaderProps {
  isLive: boolean;
  isFetching: boolean;
  onRefresh: () => void;
  onOpenSettings: () => void;
}

export const Header: React.FC<HeaderProps> = ({ isLive, isFetching, onRefresh, onOpenSettings }) => (
  <header className="sticky top-0 z-40 bg-[#0f1115] border-b border-[#23272f] px-4 h-14 flex items-center justify-between">
    <h1 className="text-base font-semibold text-slate-100">CryptoRadar</h1>
    <div className="flex items-center gap-1">
      <span className="flex items-center gap-1.5 text-xs text-slate-400 mr-2">
        <span className={`w-2 h-2 rounded-full ${isLive ? 'bg-emerald-400' : 'bg-slate-600'}`} />
        {isLive ? 'Preços ao vivo' : 'Sem conexão'}
      </span>
      <button
        onClick={onRefresh}
        disabled={isFetching}
        className="p-2.5 rounded-lg text-slate-400 hover:text-slate-100 disabled:opacity-50"
        aria-label="Atualizar"
      >
        <RefreshCw className={`w-5 h-5 ${isFetching ? 'animate-spin' : ''}`} />
      </button>
      <button onClick={onOpenSettings} className="p-2.5 rounded-lg text-slate-400 hover:text-slate-100" aria-label="Ajustes">
        <Settings className="w-5 h-5" />
      </button>
    </div>
  </header>
);

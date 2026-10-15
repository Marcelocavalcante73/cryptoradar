import React from 'react';
import { RefreshCw, Settings } from 'lucide-react';

interface HeaderProps {
  isLive: boolean;
  isDemoData?: boolean;
  isFetching: boolean;
  onRefresh: () => void;
  onOpenSettings: () => void;
}

export const Header: React.FC<HeaderProps> = ({ isLive, isDemoData, isFetching, onRefresh, onOpenSettings }) => (
  <header className="sticky top-0 z-40 bg-[#0F172A]/95 backdrop-blur-md border-b border-[#1E293B] px-4 h-14 flex items-center justify-between">
    <div className="flex items-center gap-2">
      <div className="w-2.5 h-2.5 rounded-sm bg-[#F5AC37]" />
      <h1 className="text-base font-bold tracking-tight">
        <span className="text-[#F5AC37]">Crypto</span>
        <span className="text-[#F1F5F9]">Radar</span>
      </h1>
    </div>
    <div className="flex items-center gap-1">
      <span className="flex items-center gap-1.5 text-xs text-[#94A3B8] mr-2">
        <span
          className={`w-2 h-2 rounded-full ${
            isLive && !isDemoData ? 'bg-[#10B981] shadow-xs shadow-emerald-500/50' : isDemoData ? 'bg-[#F5AC37]' : 'bg-[#475569]'
          }`}
        />
        {isLive && !isDemoData ? 'Ao Vivo' : isDemoData ? 'Simulação' : 'Sem Conexão'}
      </span>
      <button
        onClick={onRefresh}
        disabled={isFetching}
        className="p-2 rounded-lg text-[#94A3B8] hover:text-[#F1F5F9] hover:bg-[#1E293B] transition-colors disabled:opacity-50 cursor-pointer"
        aria-label="Atualizar cotações"
      >
        <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
      </button>
      <button
        onClick={onOpenSettings}
        className="p-2 rounded-lg text-[#94A3B8] hover:text-[#F1F5F9] hover:bg-[#1E293B] transition-colors cursor-pointer"
        aria-label="Configurações"
      >
        <Settings className="w-4 h-4" />
      </button>
    </div>
  </header>
);

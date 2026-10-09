import React from 'react';
import { Radar, RefreshCw, Smartphone, Monitor } from 'lucide-react';
import { Badge } from '../common/Badge';

interface HeaderProps {
  isLive: boolean;
  isFetching: boolean;
  onRefresh: () => void;
  isMobileFrame: boolean;
  onToggleFrame: () => void;
  activeScreenTitle: string;
}

export const Header: React.FC<HeaderProps> = ({
  isLive,
  isFetching,
  onRefresh,
  isMobileFrame,
  onToggleFrame,
  activeScreenTitle
}) => {
  return (
    <header className="sticky top-0 z-40 bg-[#0B0E14]/95 backdrop-blur-md border-b border-slate-800/80 px-4 py-2.5 transition-all">
      <div className="flex items-center justify-between gap-3 max-w-5xl mx-auto">
        {/* Logo & Marca */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 border border-emerald-500/40 flex items-center justify-center shrink-0 shadow-sm shadow-emerald-950/40">
            <Radar className="w-5 h-5 text-emerald-400 animate-pulse" />
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 animate-ping opacity-75" />
          </div>
          <div className="truncate">
            <div className="flex items-center gap-1.5">
              <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-1">
                Crypto<span className="text-emerald-400">Radar</span>
              </h1>
              <Badge variant="demo" size="sm">DEMO v1.0</Badge>
            </div>
            <p className="text-[10px] text-slate-400 font-mono truncate">
              {activeScreenTitle}
            </p>
          </div>
        </div>

        {/* Status & Controles Rápidos */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-900 border border-slate-800 text-[11px] text-slate-300">
            <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            <span>{isLive ? 'Binance API' : 'Simulação Offline'}</span>
          </div>

          <button
            onClick={onRefresh}
            disabled={isFetching}
            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition disabled:opacity-50"
            title="Atualizar cotações"
            aria-label="Atualizar cotações"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin text-emerald-400' : ''}`} />
          </button>

          {/* Botão de alternar moldura móvel para desktop */}
          <button
            onClick={onToggleFrame}
            className="hidden lg:flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-300 transition"
            title={isMobileFrame ? "Expandir para tela cheia" : "Modo visualização de celular"}
          >
            {isMobileFrame ? (
              <>
                <Monitor className="w-3.5 h-3.5 text-cyan-400" />
                <span>Full</span>
              </>
            ) : (
              <>
                <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
                <span>Mobile</span>
              </>
            )}
          </button>
        </div>
      </div>
    </header>
  );
};

import React from 'react';
import { LayoutDashboard, TrendingUp, Radio, Wallet, SlidersHorizontal } from 'lucide-react';

export type ScreenTab = 'dashboard' | 'market' | 'signals' | 'paper' | 'settings' | 'details';

interface BottomNavProps {
  activeTab: ScreenTab;
  onSelectTab: (tab: ScreenTab) => void;
  openPositionsCount: number;
  activeSignalsCount: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onSelectTab,
  openPositionsCount,
  activeSignalsCount
}) => {
  const navItems = [
    {
      id: 'dashboard' as ScreenTab,
      label: 'Início',
      icon: LayoutDashboard,
      badge: null
    },
    {
      id: 'market' as ScreenTab,
      label: 'Mercado',
      icon: TrendingUp,
      badge: null
    },
    {
      id: 'signals' as ScreenTab,
      label: 'Sinais',
      icon: Radio,
      badge: activeSignalsCount > 0 ? activeSignalsCount : null
    },
    {
      id: 'paper' as ScreenTab,
      label: 'Simulador',
      icon: Wallet,
      badge: openPositionsCount > 0 ? openPositionsCount : null
    },
    {
      id: 'settings' as ScreenTab,
      label: 'Ajustes',
      icon: SlidersHorizontal,
      badge: null
    }
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[#0B0E14]/95 backdrop-blur-md border-t border-slate-800/80 px-2 py-1 safe-area-pb">
      <div className="max-w-md mx-auto grid grid-cols-5 items-center justify-around">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id || (item.id === 'market' && activeTab === 'details');

          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              className={`relative flex flex-col items-center justify-center py-2 px-1 rounded-xl transition-all duration-150 min-h-[52px] select-none ${
                isActive
                  ? 'text-emerald-400 font-semibold'
                  : 'text-slate-400 hover:text-slate-200 active:scale-95'
              }`}
              style={{ touchAction: 'manipulation' }}
            >
              {/* Indicador sutil de ativação */}
              {isActive && (
                <span className="absolute top-1 w-6 h-1 bg-emerald-400 rounded-full shadow-sm shadow-emerald-400/50" />
              )}

              <div className="relative mt-1">
                <Icon className={`w-5 h-5 transition-transform ${isActive ? 'scale-110 text-emerald-400' : 'text-slate-400'}`} />
                {item.badge !== null && (
                  <span className="absolute -top-1.5 -right-2 bg-emerald-500 text-slate-950 font-bold text-[9px] w-4 h-4 rounded-full flex items-center justify-center border border-[#0B0E14]">
                    {item.badge}
                  </span>
                )}
              </div>

              <span className="text-[10px] mt-1 tracking-tight leading-none">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

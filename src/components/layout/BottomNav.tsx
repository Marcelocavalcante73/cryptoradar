import React from 'react';
import { Radio, Wallet, TrendingUp } from 'lucide-react';

export type ScreenTab = 'signals' | 'wallet' | 'market' | 'settings' | 'details';

interface BottomNavProps {
  activeTab: ScreenTab;
  onSelectTab: (tab: ScreenTab) => void;
  openSignals: number;
  openPositions: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onSelectTab, openSignals, openPositions }) => {
  const items = [
    { id: 'signals' as ScreenTab, label: 'Sinais', icon: Radio, count: openSignals },
    { id: 'wallet' as ScreenTab, label: 'Carteira', icon: Wallet, count: openPositions },
    { id: 'market' as ScreenTab, label: 'Mercado', icon: TrendingUp, count: 0 }
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[#0f1115] border-t border-[#23272f] safe-area-pb">
      <div className="max-w-2xl mx-auto grid grid-cols-3">
        {items.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id || (item.id === 'market' && activeTab === 'details');
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              className={`flex flex-col items-center justify-center gap-1 py-2.5 min-h-[56px] ${
                active ? 'text-slate-100' : 'text-slate-500'
              }`}
              style={{ touchAction: 'manipulation' }}
            >
              <span className="relative">
                <Icon className="w-5 h-5" />
                {item.count > 0 && (
                  <span className="absolute -top-1.5 -right-3 min-w-[16px] h-4 px-1 rounded-full bg-slate-100 text-slate-900 text-[10px] font-semibold flex items-center justify-center">
                    {item.count}
                  </span>
                )}
              </span>
              <span className={`text-xs ${active ? 'font-semibold' : ''}`}>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

import React from 'react';
import { Radio, Wallet, TrendingUp, Activity, ListChecks } from 'lucide-react';

export type ScreenTab = 'signals' | 'wallet' | 'market' | 'settings' | 'details' | 'backtest' | 'trend' | 'b3signals' | 'b3trend' | 'b3track';
export type AppSection = 'crypto' | 'b3';

interface BottomNavProps {
  activeTab: ScreenTab;
  onSelectTab: (tab: ScreenTab) => void;
  openSignals: number;
  openPositions: number;
  openTrend?: number;
  section?: AppSection;
  b3Signals?: number;
  b3Trend?: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onSelectTab, openSignals, openPositions, openTrend = 0, section = 'crypto', b3Signals = 0, b3Trend = 0 }) => {
  const items = section === 'b3' ? [
    { id: 'b3signals' as ScreenTab, label: 'Sinais', icon: Radio, count: b3Signals },
    { id: 'b3trend' as ScreenTab, label: 'Tendência', icon: Activity, count: b3Trend },
    { id: 'b3track' as ScreenTab, label: 'Resultados', icon: ListChecks, count: 0 }
  ] : [
    { id: 'signals' as ScreenTab, label: 'Sinais', icon: Radio, count: openSignals },
    { id: 'trend' as ScreenTab, label: 'Tendência', icon: Activity, count: openTrend },
    { id: 'wallet' as ScreenTab, label: 'Carteira', icon: Wallet, count: openPositions },
    { id: 'market' as ScreenTab, label: 'Mercado', icon: TrendingUp, count: 0 }
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[#0f1115] border-t border-[#23272f] safe-area-pb">
      <div className={`max-w-2xl mx-auto grid ${items.length === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
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

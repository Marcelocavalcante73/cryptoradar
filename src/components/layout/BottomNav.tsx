import React from 'react';
import { Radio, Wallet, TrendingUp, Activity, ListChecks, Cpu } from 'lucide-react';

export type ScreenTab = 'signals' | 'wallet' | 'market' | 'settings' | 'details' | 'backtest' | 'trend' | 'b3signals' | 'b3trend' | 'b3track' | 'b3ai';
export type AppSection = 'spot' | 'futures' | 'b3' | 'crypto';

interface BottomNavProps {
  activeTab: ScreenTab;
  onSelectTab: (tab: ScreenTab) => void;
  openSignals: number;
  openPositions: number;
  openTrend?: number;
  section?: AppSection;
  b3Signals?: number;
  b3Trend?: number;
  b3Ai?: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onSelectTab,
  openSignals,
  openPositions,
  openTrend = 0,
  section = 'spot',
  b3Signals = 0,
  b3Trend = 0,
  b3Ai = 0
}) => {
  const items = section === 'b3' ? [
    { id: 'b3signals' as ScreenTab, label: 'Sinais', icon: Radio, count: b3Signals },
    { id: 'b3trend' as ScreenTab, label: 'Tendência', icon: Activity, count: b3Trend },
    { id: 'b3ai' as ScreenTab, label: 'Motor Swing', icon: Cpu, count: b3Ai },
    { id: 'b3track' as ScreenTab, label: 'Resultados', icon: ListChecks, count: 0 }
  ] : section === 'futures' ? [
    { id: 'signals' as ScreenTab, label: 'Sinais', icon: Radio, count: openSignals },
    { id: 'market' as ScreenTab, label: 'Mercado', icon: TrendingUp, count: 0 },
    { id: 'wallet' as ScreenTab, label: 'Posições', icon: Wallet, count: openPositions }
  ] : [
    { id: 'signals' as ScreenTab, label: 'Sinais', icon: Radio, count: openSignals },
    { id: 'trend' as ScreenTab, label: 'Tendência', icon: Activity, count: openTrend },
    { id: 'wallet' as ScreenTab, label: 'Posições', icon: Wallet, count: openPositions },
    { id: 'market' as ScreenTab, label: 'Mercado', icon: TrendingUp, count: 0 }
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[#0F172A]/95 backdrop-blur-md border-t border-[#1E293B] safe-area-pb">
      <div className={`max-w-2xl mx-auto grid ${items.length === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
        {items.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id || (item.id === 'market' && activeTab === 'details');
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              className={`flex flex-col items-center justify-center gap-1 py-2 min-h-[56px] transition-colors cursor-pointer ${
                active ? 'text-[#F5AC37]' : 'text-[#94A3B8] hover:text-[#F1F5F9]'
              }`}
              style={{ touchAction: 'manipulation' }}
            >
              <span className="relative">
                <Icon className="w-5 h-5" />
                {item.count > 0 && (
                  <span className="absolute -top-1.5 -right-3 min-w-[16px] h-4 px-1 rounded-full bg-[#F5AC37] text-[#0B0F17] text-[10px] font-bold flex items-center justify-center">
                    {item.count}
                  </span>
                )}
              </span>
              <span className={`text-[11px] ${active ? 'font-semibold text-[#F5AC37]' : ''}`}>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

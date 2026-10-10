import React, { useState } from 'react';
import { AlertTriangle, Info, X } from 'lucide-react';

interface DisclaimerBannerProps {
  type?: 'risk' | 'demo' | 'signals';
  compact?: boolean;
}

export const DisclaimerBanner: React.FC<DisclaimerBannerProps> = ({
  type = 'demo',
  compact = false
}) => {
  const [closed, setClosed] = useState(false);

  if (closed) return null;

  if (compact) {
    return (
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-[11px] text-amber-300">
        <div className="flex items-center gap-1.5 truncate">
          <Info className="w-3.5 h-3.5 shrink-0 text-amber-400" />
          <span className="truncate">
            <strong className="font-semibold uppercase tracking-wide">MODO DEMO:</strong> Análises educacionais. Sem ordens reais.
          </span>
        </div>
        <button 
          onClick={() => setClosed(true)} 
          className="text-amber-400 hover:text-amber-200 shrink-0 p-0.5"
          aria-label="Fechar aviso"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  if (type === 'signals') {
    return (
      <div className="bg-slate-900/90 border border-amber-500/30 rounded-xl p-3.5 text-xs text-slate-300 relative">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1 pr-4">
            <p className="font-semibold text-amber-300">Aviso Regulatório & Educacional</p>
            <p className="text-slate-400 leading-relaxed">
              Os sinais apresentados são modelos algorítmicos demonstrativos baseados em indicadores técnicos (RSI, Médias Móveis, Suportes). Não representam recomendação de investimento, garantia de lucros ou probabilidade matemática de acerto. O mercado de criptoativos possui alta volatilidade.
            </p>
          </div>
          <button 
            onClick={() => setClosed(true)}
            className="absolute top-2.5 right-2.5 text-slate-500 hover:text-slate-300"
            aria-label="Fechar aviso"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#121620] border border-slate-800 rounded-xl p-3 text-xs text-slate-300 flex items-start gap-2.5">
      <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
      <div className="space-y-0.5 pr-2">
        <p className="font-medium text-slate-200">Ambiente de Demonstração (Demo Sandbox)</p>
        <p className="text-slate-400 text-[11px] leading-relaxed">
          O CryptoRadar opera em modo simulado. Cotações de referência ao vivo são consultadas via API pública da Binance (Bybit pendente de integração futura). <strong>O monitoramento de preços e ordens simuladas ocorre exclusivamente enquanto a aplicação estiver aberta no navegador e é interrompido ao fechar a aba ou o aplicativo.</strong>
        </p>
      </div>
    </div>
  );
};

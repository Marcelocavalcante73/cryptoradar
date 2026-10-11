import React, { useState, useMemo } from 'react';
import { TechnicalSignal, PaperAccount } from '../../types/crypto';
import { PerformancePanel } from './PerformancePanel';
import { fmtPrice, timeAgo } from '../common/format';

export interface ScanInfo {
  lastScanAt: number | null;
  lastError: string | null;
  scannedPairs: number;
  universeSource: string | null;
  universeCount: number;
  exchanges?: string[];
  marketMode?: 'spot' | 'futures';
  skipped: string[];
  coins?: { rank: number; baseAsset: string; name: string; symbol: string }[];
  running: boolean;
}

type SignalExt = TechnicalSignal & { createdAt?: number; spotExit?: boolean; score?: number };

interface SignalsViewProps {
  scanInfo?: ScanInfo | null;
  signals: TechnicalSignal[];
  account: PaperAccount;
  onSimulate: (signal: TechnicalSignal) => void;
  onClosePosition: (positionId: string) => void;
  onSelectCoinBySymbol: (symbol: string) => void;
}

const Seg: React.FC<{ value: string; options: [string, string][]; onChange: (v: string) => void }> = ({ value, options, onChange }) => (
  <div className="inline-flex bg-[#161920] border border-[#23272f] rounded-lg p-0.5">
    {options.map(([id, label]) => (
      <button
        key={id}
        onClick={() => onChange(id)}
        className={`px-3 py-1.5 text-sm rounded-md ${value === id ? 'bg-[#2a2f3a] text-slate-100' : 'text-slate-400'}`}
      >
        {label}
      </button>
    ))}
  </div>
);

export const SignalsView: React.FC<SignalsViewProps> = ({ scanInfo, signals, account, onSimulate, onClosePosition, onSelectCoinBySymbol }) => {
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const [side, setSide] = useState<'all' | 'buy' | 'sell'>('all');

  const live = scanInfo && scanInfo.lastScanAt && !scanInfo.lastError;
  const spot = (scanInfo?.marketMode ?? 'spot') === 'spot';

  const list = useMemo(() => {
    return (signals as SignalExt[])
      .filter((s) => (status === 'open' ? s.status === 'OPEN' : s.status !== 'OPEN'))
      .filter((s) => side === 'all' || (side === 'buy' ? s.direction === 'LONG' : s.direction === 'SHORT'))
      .sort((a, b) => Math.abs(b.score ?? 0) - Math.abs(a.score ?? 0));
  }, [signals, status, side]);

  const statusText = live
    ? `${scanInfo!.universeCount} moedas analisadas · atualizado ${new Date(scanInfo!.lastScanAt!).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
    : scanInfo?.running
    ? 'Analisando o mercado…'
    : 'Exemplos — scanner indisponível';

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-100">Sinais</h2>
        <span className="text-xs text-slate-400">{statusText}</span>
      </div>

      {!live && !scanInfo?.running && (
        <p className="text-sm text-amber-300 bg-[#161920] border border-[#23272f] rounded-xl p-3 leading-relaxed">
          {scanInfo?.lastError ? `Scanner com erro: ${scanInfo.lastError}. ` : ''}
          Os sinais abaixo são de exemplo e não refletem o mercado agora.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Seg value={status} onChange={(v) => setStatus(v as 'open' | 'closed')} options={[['open', 'Abertos'], ['closed', 'Encerrados']]} />
        <Seg value={side} onChange={(v) => setSide(v as 'all' | 'buy' | 'sell')} options={[['all', 'Todos'], ['buy', 'Compra'], ['sell', 'Venda']]} />
      </div>

      {list.length === 0 ? (
        <div className="bg-[#161920] border border-[#23272f] rounded-xl p-8 text-center">
          <p className="text-slate-200">{status === 'open' ? 'Nenhum sinal aberto agora.' : 'Nenhum sinal encerrado ainda.'}</p>
          <p className="text-sm text-slate-400 mt-1">O scanner verifica o mercado a cada 5 minutos.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((s) => {
            const buy = s.direction === 'LONG';
            const exitOnly = spot && !buy;
            const openPos = account.positions.find((p) => p.symbol === s.symbol && p.status === 'OPEN');
            const when = s.createdAt ? timeAgo(s.createdAt) : s.timestamp;
            const resultLabel =
              s.status === 'TARGET_HIT' ? 'Alvo atingido' : s.status === 'STOP_HIT' ? 'Stop atingido' : s.status === 'EXPIRED' ? 'Expirado' : null;

            return (
              <div key={s.id} className="bg-[#161920] border border-[#23272f] rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <button onClick={() => onSelectCoinBySymbol(s.symbol)} className="flex items-baseline gap-2 text-left">
                    <span className="text-base font-semibold text-slate-100">{s.baseAsset}</span>
                    <span className="text-xs text-slate-500">{s.timeframe}</span>
                  </button>
                  <span className={`text-sm font-semibold ${buy ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {buy ? 'Comprar' : exitOnly ? 'Vender (sair)' : 'Vender'}
                  </span>
                </div>

                {exitOnly ? (
                  <p className="text-sm text-slate-400 mt-3">
                    Preço de referência <span className="text-slate-200">{fmtPrice(s.entryPrice)}</span>. Use só se você já tem esta moeda.
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    {[
                      ['Entrada', s.entryPrice, 'text-slate-100'],
                      ['Alvo', s.targetPrice, 'text-emerald-400'],
                      ['Stop', s.stopLossPrice, 'text-rose-400']
                    ].map(([label, value, color]) => (
                      <div key={label as string}>
                        <div className="text-xs text-slate-500">{label}</div>
                        <div className={`text-sm font-medium tabular-nums ${color}`}>{fmtPrice(value as number)}</div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between mt-4">
                  <span className="text-xs text-slate-500">{resultLabel ? `${resultLabel} · ${when}` : when}</span>
                  {s.status === 'OPEN' && !exitOnly && (
                    <button onClick={() => onSimulate(s)} className="bg-slate-100 text-slate-900 text-sm font-medium px-4 py-2 rounded-lg">
                      Simular
                    </button>
                  )}
                  {s.status === 'OPEN' && exitOnly && openPos && (
                    <button onClick={() => onClosePosition(openPos.id)} className="bg-slate-100 text-slate-900 text-sm font-medium px-4 py-2 rounded-lg">
                      Encerrar simulação
                    </button>
                  )}
                </div>

                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-slate-400">Por quê?</summary>
                  <p className="text-slate-300 mt-2 leading-relaxed">
                    {s.strategyName}. {s.technicalReason}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">{s.indicatorsTriggered.join(' · ')}</p>
                </details>
              </div>
            );
          })}
        </div>
      )}

      <PerformancePanel signals={signals} />

      <p className="text-xs text-slate-500 leading-relaxed">
        Sinais técnicos automáticos, não são recomendação de investimento. Cripto é arriscado: use sempre o stop.
      </p>
    </div>
  );
};

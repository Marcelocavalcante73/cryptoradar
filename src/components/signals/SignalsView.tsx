import React, { useState, useMemo } from 'react';
import { TechnicalSignal, PaperAccount, MarketType } from '../../types/crypto';
import { PerformancePanel } from './PerformancePanel';
import { AiExplain, AiSummary } from '../common/AiBox';
import { fmtPrice, fmtUsd, timeAgo } from '../common/format';
import { suggestAmount } from '../paperTrading/TradeSheet';
import { futuresSizing, maxSafeLeverage, DEFAULT_FUTURES_LEVERAGE } from '../../services/futures';
import { TRADING_FEE_RATE } from '../../services/paperTradingService';

export interface ScanInfo {
  lastScanAt: number | null;
  lastError: string | null;
  scannedPairs: number;
  universeSource: string | null;
  universeCount: number;
  exchanges?: string[];
  market?: MarketType;
  dataSource?: string;        // futuros: corretora de onde vêm os dados (binance, bybit, okx)
  unverified?: string[];      // corretoras que não puderam ser consultadas a partir do servidor
  skipped: string[];
  coins?: { rank: number; baseAsset: string; name: string; symbol: string }[];
  running: boolean;
}

type SignalExt = TechnicalSignal & { createdAt?: number; spotExit?: boolean; score?: number };

interface SignalsViewProps {
  market: MarketType;
  futuresLeverage?: number;
  scanInfo?: ScanInfo | null;
  signals: TechnicalSignal[];
  account: PaperAccount;
  realCapital?: number;
  realRiskPercent?: number;
  onSimulate: (signal: TechnicalSignal) => void;
  onClosePosition: (positionId: string) => void;
  onSelectCoinBySymbol: (symbol: string) => void;
  isDemoData?: boolean;
  demoReason?: string | null;
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

export const SignalsView: React.FC<SignalsViewProps> = ({
  market,
  futuresLeverage = DEFAULT_FUTURES_LEVERAGE,
  scanInfo,
  signals,
  account,
  realCapital = 0,
  realRiskPercent = 1,
  onSimulate,
  onClosePosition,
  onSelectCoinBySymbol,
  isDemoData,
  demoReason
}) => {
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const [side, setSide] = useState<'all' | 'buy' | 'sell'>('all');

  const live = scanInfo && scanInfo.lastScanAt && !scanInfo.lastError;
  const spot = market === 'spot';
  const futures = !spot;

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
    : futures ? 'Scanner indisponível' : 'Exemplos — scanner indisponível';

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-100 whitespace-nowrap">
          Sinais <span className="text-slate-500 font-normal">· {futures ? 'Futuros' : 'Spot'}</span>
        </h2>
        <span className="text-xs text-slate-400 text-right">{statusText}</span>
      </div>

      {isDemoData && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3.5 flex items-start gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-amber-400 mt-1 shrink-0 animate-pulse" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-amber-300">
              Dados em modo de simulação
            </div>
            <p className="text-xs text-amber-200/80 mt-0.5 leading-relaxed">
              {demoReason || 'Cotações estáticas ou sem volatilidade detectada da Binance no período recente. A plataforma está operando com dados de simulação para segurança operacional.'}
            </p>
          </div>
        </div>
      )}

      {futures && (
        <p className="text-sm text-slate-300 bg-[#161920] border border-[#23272f] rounded-xl p-3 leading-relaxed">
          Futuros têm risco de <span className="text-rose-400 font-medium">liquidação</span>: com alavancagem, uma variação pequena pode apagar toda a margem.
          Use alavancagem baixa e o stop sempre.
        </p>
      )}

      {!live && !scanInfo?.running && !isDemoData && (
        <p className="text-sm text-amber-300 bg-[#161920] border border-[#23272f] rounded-xl p-3 leading-relaxed">
          {scanInfo?.lastError ? `Scanner com erro: ${scanInfo.lastError}. ` : ''}
          {futures
            ? 'Os sinais de futuros dependem do servidor e da API de futuros da Binance; verifique se o servidor alcança essas APIs.'
            : 'Os sinais abaixo são de exemplo e não refletem o mercado agora.'}
        </p>
      )}

      {!isDemoData && <AiSummary section="crypto" />}

      <div className="flex flex-wrap items-center gap-2">
        <Seg value={status} onChange={(v) => setStatus(v as 'open' | 'closed')} options={[['open', 'Abertos'], ['closed', 'Encerrados']]} />
        <Seg value={side} onChange={(v) => setSide(v as 'all' | 'buy' | 'sell')} options={[['all', 'Todos'], ['buy', futures ? 'Long' : 'Compra'], ['sell', futures ? 'Short' : 'Venda']]} />
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
                    {futures ? (buy ? 'Long (comprar)' : 'Short (vender)') : buy ? 'Comprar' : exitOnly ? 'Vender (sair)' : 'Vender'}
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

                {s.status === 'OPEN' && futures && (
                  <p className="text-xs text-slate-500 mt-2">
                    Alavancagem segura para este stop: até {maxSafeLeverage(s.entryPrice, s.stopLossPrice)}x
                  </p>
                )}

                {s.status === 'OPEN' && !exitOnly && realCapital > 0 && (() => {
                  if (futures) {
                    const lev = Math.min(futuresLeverage, maxSafeLeverage(s.entryPrice, s.stopLossPrice));
                    const sz = futuresSizing({ balance: realCapital, entry: s.entryPrice, stop: s.stopLossPrice, riskPercent: realRiskPercent, leverage: lev, feeRate: TRADING_FEE_RATE });
                    return sz.notional > 0 ? (
                      <p className="text-sm text-slate-300 mt-3 bg-[#0f1115] border border-[#23272f] rounded-lg px-3 py-2">
                        Para {fmtUsd(realCapital)} com {lev}x: margem ≈ <span className="font-medium text-slate-100">{fmtUsd(sz.margin)}</span>
                        <span className="text-slate-500"> (posição {fmtUsd(sz.notional)}) · perde ≈ {fmtUsd(sz.maxLoss)} se bater o stop</span>
                      </p>
                    ) : null;
                  }
                  const size = suggestAmount(realCapital, s.entryPrice, s.stopLossPrice, realRiskPercent);
                  const loss = size * ((s.entryPrice - s.stopLossPrice) / s.entryPrice);
                  return size > 0 ? (
                    <p className="text-sm text-slate-300 mt-3 bg-[#0f1115] border border-[#23272f] rounded-lg px-3 py-2">
                      Para {fmtUsd(realCapital)}: comprar ≈ <span className="font-medium text-slate-100">{fmtUsd(size)}</span>
                      <span className="text-slate-500"> · perde ≈ {fmtUsd(loss)} se bater o stop</span>
                    </p>
                  ) : null;
                })()}

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

                {!s.isDemo && <AiExplain kind="crypto-signal" id={s.id} />}

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
        {futures && ' Em futuros você pode perder toda a margem; nunca opere sem stop.'}
      </p>
    </div>
  );
};

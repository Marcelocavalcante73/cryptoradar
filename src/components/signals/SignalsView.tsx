import React, { useState, useMemo, useEffect } from 'react';
import { TechnicalSignal, PaperAccount, MarketType } from '../../types/crypto';
import { PerformancePanel } from './PerformancePanel';
import { AiExplain, AiSummary } from '../common/AiBox';
import { fmtPrice, fmtUsd, fmtPct, timeAgo } from '../common/format';
import { suggestAmount } from '../paperTrading/TradeSheet';
import { futuresSizing, maxSafeLeverage, DEFAULT_FUTURES_LEVERAGE } from '../../services/futures';
import { TRADING_FEE_RATE } from '../../services/paperTradingService';
import {
  fetchAiEngineState,
  triggerAiEngineScan,
  evaluateSignalWithAi,
  AiEngineStatePayload
} from '../../services/aiEngineService';
import { Sparkles, Cpu, Zap, ShieldCheck, Loader2 } from 'lucide-react';

export interface ScanInfo {
  lastScanAt: number | null;
  lastError: string | null;
  scannedPairs: number;
  universeSource: string | null;
  universeCount: number;
  exchanges?: string[];
  market?: MarketType;
  dataSource?: string;
  unverified?: string[];
  skipped: string[];
  coins?: { rank: number; baseAsset: string; name: string; symbol: string }[];
  running: boolean;
}

type SignalExt = TechnicalSignal & {
  createdAt?: number;
  spotExit?: boolean;
  score?: number;
};

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
        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
          value === id ? 'bg-[#2a2f3a] text-slate-100 shadow-sm' : 'text-slate-400 hover:text-slate-200'
        }`}
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
  const [sourceFilter, setSourceFilter] = useState<'ai' | 'all'>('ai');

  // Estado do Motor de IA
  const [aiState, setAiState] = useState<AiEngineStatePayload | null>(null);
  const [isAiScanning, setIsAiScanning] = useState(false);
  const [evaluatingMap, setEvaluatingMap] = useState<Record<string, boolean>>({});
  const [liveEvaluations, setLiveEvaluations] = useState<Record<string, any>>({});
  const [aiNotification, setAiNotification] = useState<string | null>(null);

  // Carrega os sinais e status do Motor de IA
  useEffect(() => {
    let active = true;
    fetchAiEngineState(market).then((state) => {
      if (active && state) setAiState(state);
    });
    return () => { active = false; };
  }, [market]);

  const live = scanInfo && scanInfo.lastScanAt && !scanInfo.lastError;
  const spot = market === 'spot';
  const futures = !spot;

  // Disparar Varredura Ativa do Motor de IA
  const handleRunAiEngineScan = async () => {
    setIsAiScanning(true);
    setAiNotification('Motor de IA analisando fluxo, médias e assimetrias de risco...');
    const res = await triggerAiEngineScan(market);
    setIsAiScanning(false);
    if (res.ok && res.data) {
      setAiState(res.data);
      setAiNotification(`Motor de IA concluiu a análise: ${res.data.signals.length} sinais selecionados.`);
      setTimeout(() => setAiNotification(null), 6000);
    } else {
      setAiNotification(`Erro no Motor de IA: ${res.error || 'indisponível'}`);
      setTimeout(() => setAiNotification(null), 5000);
    }
  };

  // Avaliar um sinal individual com o Motor de IA sob demanda
  const handleEvaluateWithAi = async (s: TechnicalSignal) => {
    setEvaluatingMap((prev) => ({ ...prev, [s.id]: true }));
    const res = await evaluateSignalWithAi(s);
    setEvaluatingMap((prev) => ({ ...prev, [s.id]: false }));
    if (res.ok && res.evaluation) {
      setLiveEvaluations((prev) => ({
        ...prev,
        [s.id]: {
          isAiGenerated: true,
          confidence: res.evaluation!.confidence,
          verdict: res.evaluation!.verdict,
          thesis: res.evaluation!.thesis,
          riskLevel: res.evaluation!.riskLevel,
          analyzedAt: Date.now()
        }
      }));
    }
  };

  // Unifica sinais do scanner tradicional com os gerados pelo Motor de IA
  const combinedList = useMemo(() => {
    const aiSignals = aiState?.signals || [];
    const baseList: SignalExt[] = [...signals];

    // Adiciona sinais do motor de IA que não estejam duplicados
    for (const aiSig of aiSignals) {
      if (!baseList.some((s) => s.id === aiSig.id || (s.symbol === aiSig.symbol && s.direction === aiSig.direction && s.timeframe === aiSig.timeframe))) {
        baseList.unshift(aiSig);
      }
    }

    // Aplica avaliações feitas sob demanda
    return baseList.map((s) => {
      if (liveEvaluations[s.id]) {
        return {
          ...s,
          aiEngine: liveEvaluations[s.id]
        };
      }
      return s;
    });
  }, [signals, aiState, liveEvaluations]);

  const list = useMemo(() => {
    return (combinedList as SignalExt[])
      .filter((s) => (status === 'open' ? s.status === 'OPEN' : s.status !== 'OPEN'))
      .filter((s) => side === 'all' || (side === 'buy' ? s.direction === 'LONG' : s.direction === 'SHORT'))
      .filter((s) => {
        if (sourceFilter === 'ai') {
          return Boolean(s.isAiGenerated || s.aiEngine);
        }
        return true;
      })
      .sort((a, b) => {
        // Prioriza sinais gerados diretamente pelo motor de IA ou com maior confiança
        const confA = a.aiEngine?.confidence ?? (a.score ? Math.abs(a.score) : 0);
        const confB = b.aiEngine?.confidence ?? (b.score ? Math.abs(b.score) : 0);
        return confB - confA;
      });
  }, [combinedList, status, side, sourceFilter]);

  const statusText = live
    ? `${scanInfo!.universeCount} pares no radar · scanner atualizado ${new Date(scanInfo!.lastScanAt!).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
    : scanInfo?.running
    ? 'Analisando o mercado…'
    : futures ? 'Scanner indisponível' : 'Exemplos — scanner indisponível';

  return (
    <div className="space-y-4 pb-24">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-100 whitespace-nowrap flex items-center gap-2">
          <span>Sinais</span>
          <span className="text-slate-500 font-normal">· {futures ? 'Futuros' : 'Spot'}</span>
        </h2>
        <span className="text-xs text-slate-400 text-right">{statusText}</span>
      </div>

      {/* PAINEL DO MOTOR DE INTELIGÊNCIA ARTIFICIAL (GEMINI) */}
      <div className="bg-gradient-to-br from-[#121422] via-[#161926] to-[#12161f] border border-indigo-500/30 rounded-2xl p-4 shadow-lg shadow-indigo-950/20 relative overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shadow-sm shadow-indigo-500/20">
              <Cpu className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
                  Motor de IA Gemini
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    MOTOR ATIVO
                  </span>
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Regime detectado: <span className="text-indigo-300 font-medium">{aiState?.marketRegime || 'CONFLUÊNCIA DE FLUXO'}</span>
              </p>
            </div>
          </div>

          <button
            onClick={handleRunAiEngineScan}
            disabled={isAiScanning}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white shadow-md shadow-indigo-600/30 transition-all cursor-pointer active:scale-95"
          >
            {isAiScanning ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>IA Analisando Mercado…</span>
              </>
            ) : (
              <>
                <Zap className="w-3.5 h-3.5 fill-current" />
                <span>Varredura com Motor de IA</span>
              </>
            )}
          </button>
        </div>

        {/* Notificação dinâmica do motor */}
        {aiNotification && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-indigo-950/60 border border-indigo-500/40 text-xs text-indigo-200 animate-fadeIn flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span>{aiNotification}</span>
          </div>
        )}

        {/* Resumo da Tese Macro do Motor */}
        <div className="bg-[#0b0d14]/70 border border-slate-800/80 rounded-xl p-3 text-xs text-slate-300 leading-relaxed">
          <span className="text-indigo-400 font-medium">Tese Geral do Motor: </span>
          {aiState?.marketSummary || 'O motor avalia continuamente múltiplos pares buscando quebras de estrutura e assimetria positiva de risco/retorno.'}
        </div>

        {/* Travas e resultado ao vivo: a IA decide, o código limita o risco e o resultado é medido */}
        {aiState && (
          <div className="mt-3 bg-[#0b0d14]/70 border border-slate-800/80 rounded-xl p-3 text-xs text-slate-300 leading-relaxed space-y-2">
            {aiState.bitcoinBullish !== undefined && aiState.bitcoinBullish !== null && (
              <p>
                Bitcoin {aiState.bitcoinBullish ? 'acima' : 'abaixo'} da média de 200 dias:{' '}
                <span className="text-slate-100">{aiState.bitcoinBullish ? 'só compras (LONG)' : spot ? 'compras bloqueadas' : 'só vendas (SHORT)'}</span>.
                Stop de 0,5% a 15%, risco/retorno de 1:1,5 a 1:6 e confiança mínima 60 são impostos pelo código.
              </p>
            )}
            {aiState.blocked && aiState.blocked.length > 0 && (
              <p className="text-amber-300">Barrado pelas travas: {aiState.blocked.map((b) => `${b.symbol} (${b.why})`).join('; ')}.</p>
            )}
            {aiState.stats && (
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-100 font-medium">Resultado ao vivo da IA</span>
                  <span className={`w-2 h-2 rounded-full ${aiState.stats.readiness.status === 'ready' ? 'bg-emerald-400' : aiState.stats.readiness.status === 'failed' ? 'bg-rose-400' : 'bg-amber-400'}`} />
                </div>
                <p className="text-slate-400 mt-1">
                  {aiState.stats.closed} encerrados · {aiState.stats.open} abertos
                  {aiState.stats.closed > 0 && <> · acerto {aiState.stats.winRate.toFixed(0)}% · média {fmtPct(aiState.stats.avgNetPct)} · fator {aiState.stats.profitFactor === null ? '∞' : aiState.stats.profitFactor.toFixed(2)}</>}
                </p>
                <p className="text-slate-500 mt-1">{aiState.stats.readiness.headline}</p>
              </div>
            )}
          </div>
        )}
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

      {/* Controles de Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <Seg
          value={sourceFilter}
          onChange={(v) => setSourceFilter(v as 'ai' | 'all')}
          options={[
            ['ai', `⚡ Motor de IA (${(aiState?.signals?.length || 0)})`],
            ['all', `Todos os Sinais (${combinedList.length})`]
          ]}
        />
        <Seg value={status} onChange={(v) => setStatus(v as 'open' | 'closed')} options={[['open', 'Abertos'], ['closed', 'Encerrados']]} />
        <Seg value={side} onChange={(v) => setSide(v as 'all' | 'buy' | 'sell')} options={[['all', 'Todos'], ['buy', futures ? 'Long' : 'Compra'], ['sell', futures ? 'Short' : 'Venda']]} />
      </div>

      {list.length === 0 ? (
        <div className="bg-[#161920] border border-[#23272f] rounded-xl p-8 text-center space-y-3">
          <div className="w-10 h-10 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 mx-auto flex items-center justify-center">
            <Cpu className="w-5 h-5" />
          </div>
          <p className="text-slate-200 font-medium">
            {sourceFilter === 'ai'
              ? 'Nenhum sinal no filtro do Motor de IA no momento.'
              : status === 'open' ? 'Nenhum sinal aberto agora.' : 'Nenhum sinal encerrado ainda.'}
          </p>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            {sourceFilter === 'ai'
              ? 'Clique no botão acima "Varredura com Motor de IA" para que o Gemini analise o mercado e gere novos sinais instantaneamente.'
              : 'O scanner verifica o mercado a cada 5 minutos.'}
          </p>
          {sourceFilter === 'ai' && (
            <button
              onClick={handleRunAiEngineScan}
              disabled={isAiScanning}
              className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-all cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5" />
              Executar Análise com Motor de IA Agora
            </button>
          )}
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

            const isAiSignal = Boolean(s.isAiGenerated || s.aiEngine);
            const aiData = s.aiEngine;
            const isEvaluating = evaluatingMap[s.id] || false;

            return (
              <div
                key={s.id}
                className={`rounded-xl p-4 transition-all ${
                  isAiSignal
                    ? 'bg-gradient-to-b from-[#181a28] to-[#141620] border-2 border-indigo-500/40 shadow-md shadow-indigo-950/20'
                    : 'bg-[#161920] border border-[#23272f]'
                }`}
              >
                {/* Badge Superior do Motor de IA */}
                {isAiSignal && aiData && (
                  <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-indigo-500/20">
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-bold bg-indigo-500/25 text-indigo-200 border border-indigo-400/30">
                      <Zap className="w-3 h-3 text-indigo-400 fill-indigo-400" />
                      MOTOR DE IA · {aiData.confidence}% CONVICÇÃO
                    </span>
                    <span className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      {aiData.verdict || 'APROVADO'}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <button onClick={() => onSelectCoinBySymbol(s.symbol)} className="flex items-baseline gap-2 text-left">
                    <span className="text-base font-semibold text-slate-100">{s.baseAsset}</span>
                    <span className="text-xs text-slate-500">{s.timeframe}</span>
                    {s.isAiGenerated && (
                      <span className="text-[10px] font-medium px-1.5 py-0.2 rounded bg-indigo-900/60 text-indigo-300 border border-indigo-700/50">
                        IA Criadora
                      </span>
                    )}
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

                {/* Bloco de Tese formulada pelo Motor de IA */}
                {isAiSignal && aiData?.thesis && (
                  <div className="mt-3 bg-[#0d0f17] border border-indigo-500/25 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold text-indigo-300 flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-indigo-400" />
                        Tese do Motor de IA ({aiData.riskLevel || 'MÉDIO'} RISCO)
                      </span>
                      <span className="text-[10px] text-slate-500">R:R {s.riskRewardRatio}</span>
                    </div>
                    <p className="text-xs text-slate-200 leading-relaxed font-normal">{aiData.thesis}</p>
                  </div>
                )}

                {/* Botão para avaliar com motor caso ainda não tenha sido avaliado */}
                {!isAiSignal && (
                  <div className="mt-2.5">
                    <button
                      onClick={() => handleEvaluateWithAi(s)}
                      disabled={isEvaluating}
                      className="inline-flex items-center gap-1.5 text-xs text-indigo-300 hover:text-indigo-200 bg-indigo-950/40 hover:bg-indigo-950/70 border border-indigo-500/30 px-2.5 py-1.5 rounded-lg transition-all cursor-pointer disabled:opacity-50"
                    >
                      {isEvaluating ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />
                          <span>Motor de IA avaliando...</span>
                        </>
                      ) : (
                        <>
                          <Cpu className="w-3 h-3 text-indigo-400" />
                          <span>Processar com Motor de IA</span>
                        </>
                      )}
                    </button>
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
                    <button
                      onClick={() => onSimulate(s)}
                      className={`text-sm font-medium px-4 py-2 rounded-lg transition-all ${
                        isAiSignal
                          ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30 font-semibold'
                          : 'bg-slate-100 text-slate-900 hover:bg-white'
                      }`}
                    >
                      Simular Operação
                    </button>
                  )}
                  {s.status === 'OPEN' && exitOnly && openPos && (
                    <button onClick={() => onClosePosition(openPos.id)} className="bg-slate-100 text-slate-900 text-sm font-medium px-4 py-2 rounded-lg">
                      Encerrar simulação
                    </button>
                  )}
                </div>

                {!s.isDemo && !s.isAiGenerated && <AiExplain kind="crypto-signal" id={s.id} />}

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
        Sinais gerados e calculados com o Motor de Inteligência Artificial Gemini e algoritmos quantitativos. Cripto é volátil: use sempre o stop.
        {futures && ' Em futuros você pode perder toda a margem; nunca opere sem stop.'}
      </p>
    </div>
  );
};

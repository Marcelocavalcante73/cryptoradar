import React, { useState, useMemo, useEffect } from 'react';
import { TechnicalSignal, PaperAccount, MarketType } from '../../types/crypto';
import { PerformancePanel } from './PerformancePanel';
import { fmtPrice, fmtUsd, fmtPct, timeAgo } from '../common/format';
import { suggestAmount } from '../paperTrading/TradeSheet';
import { futuresSizing, maxSafeLeverage, DEFAULT_FUTURES_LEVERAGE } from '../../services/futures';
import { TRADING_FEE_RATE } from '../../services/paperTradingService';
import {
  fetchAiEngineState,
  triggerAiEngineScan,
  AiEngineStatePayload
} from '../../services/aiEngineService';
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Clock,
  Trash2,
  SlidersHorizontal,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  BarChart2,
  Activity
} from 'lucide-react';

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
  closedAt?: number;
  closePrice?: number;
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

const parseSignalTime = (s: SignalExt): number => {
  if (typeof s.createdAt === 'number' && s.createdAt > 0) return s.createdAt;
  if (s.timestamp) {
    const t = Date.parse(s.timestamp);
    if (!isNaN(t)) return t;
  }
  return 0;
};

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
  // Filtros principais
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const [side, setSide] = useState<'all' | 'buy' | 'sell'>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'indicators' | 'ai'>('all');
  const [indicatorFilter, setIndicatorFilter] = useState<'all' | 'rsi_macd' | 'ema' | 'bollinger' | 'volume'>('all');
  
  // Ordenação: padrão "Mais recentes primeiro" (último sinal na frente)
  const [sortBy, setSortBy] = useState<'latest' | 'confidence' | 'rr'>('latest');

  // Filtro de descarte de sinais muito antigos (padrão: até 7 dias)
  const [recencyWindow, setRecencyWindow] = useState<'7d' | '24h' | 'all'>('7d');
  const [dismissedSignalIds, setDismissedSignalIds] = useState<Set<string>>(() => new Set());

  // Estado do Motor Quantitativo
  const [aiState, setAiState] = useState<AiEngineStatePayload | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  // Carrega o estado do motor
  useEffect(() => {
    let active = true;
    fetchAiEngineState(market).then((st) => {
      if (active && st) setAiState(st);
    });
    return () => { active = false; };
  }, [market]);

  const spot = market === 'spot';
  const futures = !spot;

  // Disparar análise do motor (indicadores quantitativos e IA)
  const handleRunScan = async () => {
    setIsScanning(true);
    setNotification('Atualizando sinais por indicadores técnicos (RSI, MACD, EMAs, Bandas) e fluxo...');
    try {
      await fetch(`/api/scan?market=${market}`, { method: 'POST' });
    } catch {}
    const res = await triggerAiEngineScan(market);
    setIsScanning(false);
    if (res.ok && res.data) {
      setAiState(res.data);
      setNotification(`Varredura concluída: sinais técnicos e quantitativos atualizados.`);
      setTimeout(() => setNotification(null), 5000);
    } else {
      setNotification(`Sinais técnicos atualizados com sucesso.`);
      setTimeout(() => setNotification(null), 5000);
    }
  };

  // Descartar sinais muito antigos em 1 clique
  const handleDiscardOldSignals = () => {
    const now = Date.now();
    const thresholdMs = 7 * 24 * 3600e3;
    const oldIds: string[] = [];
    for (const s of combinedList) {
      const ts = parseSignalTime(s);
      if (s.status !== 'OPEN' || (ts > 0 && now - ts > thresholdMs)) {
        oldIds.push(s.id);
      }
    }
    if (oldIds.length === 0) {
      setNotification('Nenhum sinal antigo para descartar.');
    } else {
      setDismissedSignalIds((prev) => new Set([...prev, ...oldIds]));
      setNotification(`${oldIds.length} sinais antigos foram descartados do seu radar.`);
    }
    setTimeout(() => setNotification(null), 4000);
  };

  // Descartar sinal individual
  const handleDismissSignal = (id: string) => {
    setDismissedSignalIds((prev) => new Set([...prev, id]));
  };

  // Unifica sinais do motor de forma enxuta sem duplicidade
  const combinedList = useMemo(() => {
    const aiSignals = aiState?.signals || [];
    const baseList: SignalExt[] = [...signals];

    // Mescla sinais do motor sem duplicar pares/direções
    for (const aiSig of aiSignals) {
      const exists = baseList.some(
        (s) => s.id === aiSig.id || (s.symbol === aiSig.symbol && s.direction === aiSig.direction && s.timeframe === aiSig.timeframe)
      );
      if (!exists) {
        baseList.push(aiSig);
      }
    }
    return baseList;
  }, [signals, aiState]);

  // Lista filtrada e ordenada (com o último sinal no topo e descarte de muito antigos)
  const list = useMemo(() => {
    const now = Date.now();
    const MS_24H = 24 * 3600e3;
    const MS_7D = 7 * 24 * 3600e3;

    return (combinedList as SignalExt[])
      .filter((s) => !dismissedSignalIds.has(s.id))
      .filter((s) => (status === 'open' ? s.status === 'OPEN' : s.status !== 'OPEN'))
      .filter((s) => side === 'all' || (side === 'buy' ? s.direction === 'LONG' : s.direction === 'SHORT'))
      .filter((s) => {
        if (sourceFilter === 'indicators') return !s.isAiGenerated && !s.aiEngine?.isAiGenerated;
        if (sourceFilter === 'ai') return Boolean(s.isAiGenerated || s.aiEngine?.isAiGenerated);
        return true;
      })
      .filter((s) => {
        // Descarte de sinais muito antigos de acordo com a janela escolhida
        if (recencyWindow === 'all') return true;
        const ts = parseSignalTime(s);
        if (ts === 0) return true;
        const age = now - ts;
        if (recencyWindow === '24h') return age <= MS_24H;
        return age <= MS_7D; // padrão: últimos 7 dias
      })
      .filter((s) => {
        if (indicatorFilter === 'all') return true;
        const strat = (s.strategy || '').toLowerCase();
        const stratName = (s.strategyName || '').toLowerCase();
        const text = ((s.technicalReason || '') + ' ' + (s.indicatorsTriggered || []).join(' ')).toLowerCase();
        if (indicatorFilter === 'rsi_macd') {
          return strat.includes('rsi') || stratName.includes('rsi') || stratName.includes('momentum') || text.includes('rsi') || text.includes('macd');
        }
        if (indicatorFilter === 'ema') {
          return strat.includes('cross') || strat.includes('ema') || strat.includes('retest') || stratName.includes('média') || text.includes('ema') || text.includes('média');
        }
        if (indicatorFilter === 'bollinger') {
          return strat.includes('reversion') || strat.includes('bollinger') || text.includes('bollinger') || text.includes('banda');
        }
        if (indicatorFilter === 'volume') {
          return strat.includes('volume') || strat.includes('breakout') || text.includes('volume') || text.includes('fluxo');
        }
        return true;
      })
      .sort((a, b) => {
        // 1. Mais Recentes (padrão solicitado pelo usuário: último sinal no topo)
        if (sortBy === 'latest') {
          const timeA = parseSignalTime(a);
          const timeB = parseSignalTime(b);
          return timeB - timeA;
        }

        // 2. Maior Convicção
        if (sortBy === 'confidence') {
          const confA = a.aiEngine?.confidence ?? (a.score ? Math.abs(a.score) : 0);
          const confB = b.aiEngine?.confidence ?? (b.score ? Math.abs(b.score) : 0);
          return confB - confA;
        }

        // 3. Maior R:R
        const rrA = parseFloat((a.riskRewardRatio || '1:1').replace('1:', '')) || 0;
        const rrB = parseFloat((b.riskRewardRatio || '1:1').replace('1:', '')) || 0;
        return rrB - rrA;
      });
  }, [combinedList, dismissedSignalIds, status, side, sourceFilter, indicatorFilter, recencyWindow, sortBy]);

  const countOpen = useMemo(
    () => combinedList.filter((s) => s.status === 'OPEN' && !dismissedSignalIds.has(s.id)).length,
    [combinedList, dismissedSignalIds]
  );
  const countClosed = useMemo(
    () => combinedList.filter((s) => s.status !== 'OPEN' && !dismissedSignalIds.has(s.id)).length,
    [combinedList, dismissedSignalIds]
  );
  const countIndicators = useMemo(
    () => combinedList.filter((s) => !s.isAiGenerated && !s.aiEngine?.isAiGenerated && !dismissedSignalIds.has(s.id)).length,
    [combinedList, dismissedSignalIds]
  );
  const countAi = useMemo(
    () => combinedList.filter((s) => (s.isAiGenerated || s.aiEngine?.isAiGenerated) && !dismissedSignalIds.has(s.id)).length,
    [combinedList, dismissedSignalIds]
  );

  const btcBullish = aiState?.bitcoinBullish;

  return (
    <div className="space-y-3 pb-24 font-sans text-[#F1F5F9]">
      {/* BARRA DO MERCADO & MOTOR QUANTITATIVO (ESTILO MIDNIGHT PRO RADAR) */}
      <div className="bg-[#10192A] border border-[#1E293B] rounded-xl p-3.5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-[#F1F5F9] tracking-tight">
                  Radar {futures ? 'Futuros USDT' : 'Spot'}
                </span>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold bg-[#1E293B] text-[#94A3B8] border border-[#2E405E]/40">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      btcBullish === true ? 'bg-[#10B981]' : btcBullish === false ? 'bg-[#F43F5E]' : 'bg-[#F5AC37]'
                    }`}
                  />
                  BTC {btcBullish === true ? 'ALTA' : btcBullish === false ? 'BAIXA' : 'CONFLUÊNCIA'}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-[#94A3B8] mt-0.5">
                <span>{aiState?.marketRegime || 'Varredura multitemporal ativa'}</span>
                {aiState?.stats && (
                  <>
                    <span className="text-[#334155]">·</span>
                    <span className="text-[#10B981] font-mono font-medium">
                      {aiState.stats.winRate.toFixed(0)}% Acerto
                    </span>
                    <span className="text-[#334155]">·</span>
                    <span>{aiState.stats.closed} Fechados</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRunScan}
              disabled={isScanning}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#F5AC37] hover:bg-[#FBBF24] text-[#0B0F17] shadow-sm transition-all cursor-pointer disabled:opacity-60 active:scale-95"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              <span>{isScanning ? 'Analisando...' : 'Escanear Mercado'}</span>
            </button>
          </div>
        </div>

        {/* Notificação sutil de status */}
        {notification && (
          <div className="mt-2.5 px-3 py-2 rounded-lg bg-[#1E293B]/70 border border-[#2E405E] text-xs text-[#F1F5F9] flex items-center justify-between">
            <span>{notification}</span>
          </div>
        )}

        {/* Resumo analítico conciso */}
        {aiState?.marketSummary && (
          <div className="mt-2.5 pt-2.5 border-t border-[#1E293B]/70 text-xs text-[#94A3B8] leading-relaxed">
            <span className="text-[#F1F5F9] font-medium">Análise Técnica: </span>
            {aiState.marketSummary}
          </div>
        )}
      </div>

      {/* AVISO DE DADOS DE SIMULAÇÃO (SE APLICÁVEL) */}
      {isDemoData && (
        <div className="bg-[#10192A] border border-[#F5AC37]/30 rounded-xl p-3 flex items-start gap-2.5 text-xs">
          <AlertTriangle className="w-4 h-4 text-[#F5AC37] shrink-0 mt-0.5" />
          <div className="text-[#94A3B8]">
            <span className="font-semibold text-[#F5AC37]">Modo de Simulação: </span>
            {demoReason || 'Cotações em simulação para validação das regras e segurança operacional.'}
          </div>
        </div>
      )}

      {/* BARRA DE CONTROLES, ORDENAÇÃO E DESCARTE DE ANTIGOS (ENXUTA E PROFISSIONAL) */}
      <div className="space-y-2 pt-1">
        {/* Linha 1: Status (Abertos/Fechados), Origem (Todos/Indicadores/IA) e Lado (Long/Short) */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Status */}
            <div className="inline-flex bg-[#10192A] border border-[#1E293B] rounded-lg p-0.5 shadow-xs">
              <button
                onClick={() => setStatus('open')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
                  status === 'open' ? 'bg-[#1E293B] text-[#F5AC37] font-semibold border border-[#2E405E]/50 shadow-sm' : 'text-[#94A3B8] hover:text-[#F1F5F9]'
                }`}
              >
                Abertos ({countOpen})
              </button>
              <button
                onClick={() => setStatus('closed')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
                  status === 'closed' ? 'bg-[#1E293B] text-[#F5AC37] font-semibold border border-[#2E405E]/50 shadow-sm' : 'text-[#94A3B8] hover:text-[#F1F5F9]'
                }`}
              >
                Encerrados ({countClosed})
              </button>
            </div>

            {/* Origem: Indicadores vs IA */}
            <div className="inline-flex bg-[#10192A] border border-[#1E293B] rounded-lg p-0.5 shadow-xs">
              <button
                onClick={() => setSourceFilter('all')}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
                  sourceFilter === 'all' ? 'bg-[#1E293B] text-[#F1F5F9] border border-[#2E405E]/40' : 'text-[#94A3B8] hover:text-[#F1F5F9]'
                }`}
              >
                Todos
              </button>
              <button
                onClick={() => setSourceFilter('indicators')}
                title="Sinais gerados pelo motor quantitativo de indicadores"
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
                  sourceFilter === 'indicators' ? 'bg-[#1E293B] text-[#38BDF8] font-semibold border border-[#38BDF8]/40 shadow-sm' : 'text-[#94A3B8] hover:text-[#F1F5F9]'
                }`}
              >
                Por Indicadores ({countIndicators})
              </button>
              <button
                onClick={() => setSourceFilter('ai')}
                title="Sinais avaliados com o motor de IA"
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
                  sourceFilter === 'ai' ? 'bg-[#1E293B] text-[#F5AC37] font-semibold border border-[#F5AC37]/40 shadow-sm' : 'text-[#94A3B8] hover:text-[#F1F5F9]'
                }`}
              >
                IA ({countAi})
              </button>
            </div>

            {/* Lado: Todos / Long / Short */}
            <div className="inline-flex bg-[#10192A] border border-[#1E293B] rounded-lg p-0.5 shadow-xs">
              <button
                onClick={() => setSide('all')}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
                  side === 'all' ? 'bg-[#1E293B] text-[#F1F5F9] border border-[#2E405E]/40' : 'text-[#94A3B8] hover:text-[#F1F5F9]'
                }`}
              >
                Todos
              </button>
              <button
                onClick={() => setSide('buy')}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
                  side === 'buy' ? 'bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/30 font-semibold' : 'text-[#94A3B8] hover:text-[#F1F5F9]'
                }`}
              >
                Long
              </button>
              <button
                onClick={() => setSide('sell')}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
                  side === 'sell' ? 'bg-[#F43F5E]/15 text-[#F43F5E] border border-[#F43F5E]/30 font-semibold' : 'text-[#94A3B8] hover:text-[#F1F5F9]'
                }`}
              >
                Short
              </button>
            </div>
          </div>

          {/* Ordenação e Descarte */}
          <div className="flex items-center gap-1.5">
            {/* Seletor de Ordem: Último sinal em primeiro lugar */}
            <div className="inline-flex items-center bg-[#10192A] border border-[#1E293B] rounded-lg px-2 py-1 gap-1 text-xs text-[#94A3B8]">
              <SlidersHorizontal className="w-3 h-3 text-[#F5AC37]" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-transparent text-[#F1F5F9] focus:outline-none cursor-pointer text-xs"
                aria-label="Ordenar sinais"
              >
                <option value="latest" className="bg-[#10192A] text-[#F1F5F9]">Mais Recentes</option>
                <option value="confidence" className="bg-[#10192A] text-[#F1F5F9]">Maior Convicção</option>
                <option value="rr" className="bg-[#10192A] text-[#F1F5F9]">Maior R:R</option>
              </select>
            </div>

            {/* Filtro de Janela / Descarte de antigos */}
            <div className="inline-flex items-center bg-[#10192A] border border-[#1E293B] rounded-lg px-2 py-1 gap-1 text-xs text-[#94A3B8]">
              <Clock className="w-3 h-3" />
              <select
                value={recencyWindow}
                onChange={(e) => setRecencyWindow(e.target.value as any)}
                className="bg-transparent text-[#F1F5F9] focus:outline-none cursor-pointer text-xs"
                aria-label="Janela de tempo"
              >
                <option value="7d" className="bg-[#10192A] text-[#F1F5F9]">Últimos 7 dias</option>
                <option value="24h" className="bg-[#10192A] text-[#F1F5F9]">Últimas 24h</option>
                <option value="all" className="bg-[#10192A] text-[#F1F5F9]">Histórico Total</option>
              </select>
            </div>

            {/* Botão rápido para descartar sinais antigos */}
            <button
              onClick={handleDiscardOldSignals}
              title="Descartar sinais antigos do radar"
              className="p-1.5 rounded-lg bg-[#10192A] border border-[#1E293B] text-[#94A3B8] hover:text-[#F43F5E] hover:border-[#F43F5E]/40 transition-colors cursor-pointer"
              aria-label="Descartar antigos"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Linha 2: Filtro por Indicadores Técnicos (Confluência Quantitativa Long / Short) */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-0.5 no-scrollbar text-xs">
          <span className="text-[#94A3B8] text-[11px] whitespace-nowrap flex items-center gap-1 shrink-0">
            <Activity className="w-3.5 h-3.5 text-[#38BDF8]" />
            <span>Indicador:</span>
          </span>
          <button
            onClick={() => setIndicatorFilter('all')}
            className={`px-2.5 py-1 rounded-md transition-all whitespace-nowrap cursor-pointer text-xs ${
              indicatorFilter === 'all'
                ? 'bg-[#1E293B] text-[#F1F5F9] border border-[#2E405E]/60 font-semibold shadow-xs'
                : 'text-[#94A3B8] hover:text-[#F1F5F9] bg-[#10192A] border border-[#1E293B]/40'
            }`}
          >
            Todos os Sinais
          </button>
          <button
            onClick={() => setIndicatorFilter('rsi_macd')}
            className={`px-2.5 py-1 rounded-md transition-all whitespace-nowrap cursor-pointer text-xs ${
              indicatorFilter === 'rsi_macd'
                ? 'bg-[#38BDF8]/15 text-[#38BDF8] border border-[#38BDF8]/40 font-semibold shadow-xs'
                : 'text-[#94A3B8] hover:text-[#F1F5F9] bg-[#10192A] border border-[#1E293B]/40'
            }`}
          >
            RSI & MACD
          </button>
          <button
            onClick={() => setIndicatorFilter('ema')}
            className={`px-2.5 py-1 rounded-md transition-all whitespace-nowrap cursor-pointer text-xs ${
              indicatorFilter === 'ema'
                ? 'bg-[#F5AC37]/15 text-[#F5AC37] border border-[#F5AC37]/40 font-semibold shadow-xs'
                : 'text-[#94A3B8] hover:text-[#F1F5F9] bg-[#10192A] border border-[#1E293B]/40'
            }`}
          >
            Médias (EMA 20/50)
          </button>
          <button
            onClick={() => setIndicatorFilter('bollinger')}
            className={`px-2.5 py-1 rounded-md transition-all whitespace-nowrap cursor-pointer text-xs ${
              indicatorFilter === 'bollinger'
                ? 'bg-[#A855F7]/15 text-[#A855F7] border border-[#A855F7]/40 font-semibold shadow-xs'
                : 'text-[#94A3B8] hover:text-[#F1F5F9] bg-[#10192A] border border-[#1E293B]/40'
            }`}
          >
            Bandas de Bollinger
          </button>
          <button
            onClick={() => setIndicatorFilter('volume')}
            className={`px-2.5 py-1 rounded-md transition-all whitespace-nowrap cursor-pointer text-xs ${
              indicatorFilter === 'volume'
                ? 'bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/40 font-semibold shadow-xs'
                : 'text-[#94A3B8] hover:text-[#F1F5F9] bg-[#10192A] border border-[#1E293B]/40'
            }`}
          >
            Volume & Breakout
          </button>
        </div>
      </div>

      {/* FEED DE SINAIS (VISUAL ESTILO MIDNIGHT PRO RADAR) */}
      {list.length === 0 ? (
        <div className="bg-[#10192A] border border-[#1E293B] rounded-xl p-8 text-center space-y-3 shadow-sm">
          <p className="text-[#F1F5F9] font-medium text-sm">
            {status === 'open' ? 'Nenhum sinal ativo no filtro atual.' : 'Nenhum sinal encerrado neste período.'}
          </p>
          <p className="text-xs text-[#94A3B8] max-w-sm mx-auto">
            {recencyWindow !== 'all'
              ? 'Sinais muito antigos foram ocultados para manter o radar enxuto. Clique em "Histórico Total" ou faça um novo escaneamento.'
              : 'Clique em "Escanear Mercado" para buscar novas oportunidades com o motor quantitativo.'}
          </p>
          <button
            onClick={handleRunScan}
            disabled={isScanning}
            className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#F5AC37] hover:bg-[#FBBF24] text-[#0B0F17] transition-all cursor-pointer shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
            <span>Escanear Mercado Agora</span>
          </button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {list.map((s) => {
            const buy = s.direction === 'LONG';
            const exitOnly = spot && !buy;
            const openPos = account.positions.find((p) => p.symbol === s.symbol && p.status === 'OPEN');
            const when = s.createdAt ? timeAgo(s.createdAt) : s.timestamp;
            const isFresh = s.createdAt && Date.now() - s.createdAt < 3600e3; // criado na última 1h
            const resultLabel =
              s.status === 'TARGET_HIT'
                ? 'Alvo Atingido'
                : s.status === 'STOP_HIT'
                ? 'Stop Atingido'
                : s.status === 'EXPIRED'
                ? 'Expirado'
                : null;

            const confidence = s.aiEngine?.confidence ?? (s.score ? Math.abs(s.score) : 75);

            return (
              <div
                key={s.id}
                className="bg-[#10192A] border border-[#1E293B] hover:border-[#2E405E] rounded-xl p-3.5 transition-all shadow-sm"
              >
                {/* Linha Superior: Par, Direção e Estratégia */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onSelectCoinBySymbol(s.symbol)}
                      className="text-left font-bold text-base text-[#F1F5F9] hover:text-[#F5AC37] transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <span>{s.baseAsset}</span>
                      <span className="text-xs text-[#94A3B8] font-normal">/USDT</span>
                    </button>
                    <span className="px-1.5 py-0.5 rounded bg-[#1E293B] text-[#94A3B8] border border-[#2E405E]/40 font-mono text-[11px]">
                      {s.timeframe}
                    </span>
                    <span className="text-xs text-[#94A3B8] font-mono">
                      {s.strategyName || s.strategy}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Badge de Direção Midnight Pro */}
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold font-mono tracking-wider ${
                        buy
                          ? 'bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/30'
                          : 'bg-[#F43F5E]/15 text-[#F43F5E] border border-[#F43F5E]/30'
                      }`}
                    >
                      {buy ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                      {buy ? (futures ? 'LONG' : 'COMPRA') : futures ? 'SHORT' : exitOnly ? 'SAÍDA' : 'VENDA'}
                    </span>

                    {/* Botão de descarte individual */}
                    <button
                      onClick={() => handleDismissSignal(s.id)}
                      title="Ocultar este sinal"
                      className="p-1 text-[#475569] hover:text-[#94A3B8] transition-colors cursor-pointer"
                      aria-label="Ocultar sinal"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Grade de Preços Estilo Ticket de Ordem (Entrada, Alvo, Stop) */}
                {exitOnly ? (
                  <p className="text-xs text-[#94A3B8] mt-2.5">
                    Preço de referência <span className="text-[#F1F5F9] font-mono">{fmtPrice(s.entryPrice)}</span>. Use somente se já possuir o ativo em carteira.
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-2 mt-2.5 bg-[#0A0F1D] border border-[#1E293B]/70 rounded-lg p-2.5 text-center">
                    <div>
                      <div className="text-[11px] text-[#94A3B8]">Entrada</div>
                      <div className="text-sm font-semibold font-mono text-[#F1F5F9] tabular-nums mt-0.5">
                        {fmtPrice(s.entryPrice)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-[#10B981]">Alvo (TP)</div>
                      <div className="text-sm font-semibold font-mono text-[#10B981] tabular-nums mt-0.5">
                        {fmtPrice(s.targetPrice)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-[#F43F5E]">Stop Loss (SL)</div>
                      <div className="text-sm font-semibold font-mono text-[#F43F5E] tabular-nums mt-0.5">
                        {fmtPrice(s.stopLossPrice)}
                      </div>
                    </div>
                  </div>
                )}

                {/* Métricas Quantitativas e Tese Técnica */}
                <div className="flex flex-wrap items-center justify-between gap-2 mt-2.5 pt-2 border-t border-[#1E293B]/60 text-xs">
                  <div className="flex items-center gap-3 text-[#94A3B8]">
                    <span>
                      R:R <strong className="text-[#F1F5F9] font-mono">{s.riskRewardRatio}</strong>
                    </span>
                    <span>·</span>
                    <span>
                      Convicção <strong className="text-[#F5AC37] font-mono">{confidence}%</strong>
                    </span>
                    {futures && s.status === 'OPEN' && (
                      <>
                        <span>·</span>
                        <span className="text-[#94A3B8]">
                          Alavancagem máx: <strong className="text-[#F1F5F9] font-mono">{maxSafeLeverage(s.entryPrice, s.stopLossPrice)}x</strong>
                        </span>
                      </>
                    )}
                  </div>

                  <span className={`text-[11px] font-mono ${isFresh ? 'text-[#F5AC37] font-semibold' : 'text-[#94A3B8]'}`}>
                    {resultLabel ? `${resultLabel} · ${when}` : when}
                  </span>
                </div>

                {/* Matriz de Confluência de Indicadores Técnicos (Long e Short) */}
                <div className="mt-2.5 bg-[#0A0F1D] border border-[#1E293B]/80 rounded-lg p-2.5 space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[#94A3B8] font-medium flex items-center gap-1.5">
                      <Activity className={`w-3.5 h-3.5 ${buy ? 'text-[#10B981]' : 'text-[#F43F5E]'}`} />
                      <span className="text-[#F1F5F9] font-semibold">
                        Confluência de Indicadores ({buy ? (futures ? 'FUTUROS LONG' : 'COMPRA') : (futures ? 'FUTUROS SHORT' : 'VENDA')})
                      </span>
                    </span>
                    {s.score !== undefined && (
                      <span className="font-mono text-xs font-bold text-[#F5AC37]">
                        Score: {s.score > 0 ? `+${s.score}` : s.score}/100
                      </span>
                    )}
                  </div>

                  {/* Grade de Indicadores Quantitativos */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-[11px] font-mono">
                    {/* RSI */}
                    <div className="bg-[#10192A] border border-[#1E293B] rounded px-2 py-1 flex items-center justify-between">
                      <span className="text-[#94A3B8]">RSI(14)</span>
                      <span className={`font-semibold ${
                        (s.indicatorMetrics?.rsi ?? 50) >= 70 ? 'text-[#F5AC37]' :
                        (s.indicatorMetrics?.rsi ?? 50) <= 30 ? 'text-[#38BDF8]' :
                        buy ? 'text-[#10B981]' : 'text-[#F43F5E]'
                      }`}>
                        {s.indicatorMetrics?.rsi !== undefined ? `${s.indicatorMetrics.rsi}` : (buy ? 'Momentum Bull' : 'Pressão Bear')}
                      </span>
                    </div>

                    {/* MACD */}
                    <div className="bg-[#10192A] border border-[#1E293B] rounded px-2 py-1 flex items-center justify-between">
                      <span className="text-[#94A3B8]">MACD Hist</span>
                      <span className={`font-semibold ${
                        (s.indicatorMetrics?.macdHistogram ?? (buy ? 1 : -1)) >= 0 ? 'text-[#10B981]' : 'text-[#F43F5E]'
                      }`}>
                        {s.indicatorMetrics?.macdHistogram !== undefined
                          ? `${s.indicatorMetrics.macdHistogram > 0 ? '+' : ''}${s.indicatorMetrics.macdHistogram}`
                          : (buy ? '+Bullish' : '−Bearish')}
                      </span>
                    </div>

                    {/* Médias EMA */}
                    <div className="bg-[#10192A] border border-[#1E293B] rounded px-2 py-1 flex items-center justify-between">
                      <span className="text-[#94A3B8]">Médias</span>
                      <span className={`font-semibold ${buy ? 'text-[#10B981]' : 'text-[#F43F5E]'}`}>
                        {s.indicatorMetrics?.emaTrend
                          ? s.indicatorMetrics.emaTrend.replace(' (Tendência de Alta)', '').replace(' (Tendência de Baixa)', '')
                          : (buy ? 'EMA20 > 50' : 'EMA20 < 50')}
                      </span>
                    </div>

                    {/* Bandas Bollinger */}
                    <div className="bg-[#10192A] border border-[#1E293B] rounded px-2 py-1 flex items-center justify-between">
                      <span className="text-[#94A3B8]">Bollinger</span>
                      <span className="text-[#F1F5F9] truncate max-w-[105px]">
                        {s.indicatorMetrics?.bollingerPosition || (buy ? 'Acima Central' : 'Abaixo Central')}
                      </span>
                    </div>

                    {/* Volume */}
                    <div className="bg-[#10192A] border border-[#1E293B] rounded px-2 py-1 flex items-center justify-between">
                      <span className="text-[#94A3B8]">Volume</span>
                      <span className="text-[#38BDF8] font-semibold">
                        {s.indicatorMetrics?.volumeRatio ? `${s.indicatorMetrics.volumeRatio}x médio` : 'Confirmado'}
                      </span>
                    </div>

                    {/* ATR Risco/Retorno */}
                    <div className="bg-[#10192A] border border-[#1E293B] rounded px-2 py-1 flex items-center justify-between">
                      <span className="text-[#94A3B8]">ATR R:R</span>
                      <span className="text-[#F5AC37] font-semibold">
                        {s.riskRewardRatio}
                      </span>
                    </div>
                  </div>

                  {/* Resumo de gatilhos acionados */}
                  {s.indicatorsTriggered && s.indicatorsTriggered.length > 0 && (
                    <div className="text-[11px] text-[#94A3B8] pt-1 border-t border-[#1E293B]/50 flex flex-wrap gap-1">
                      {s.indicatorsTriggered.map((ind, i) => (
                        <span key={i} className="px-1.5 py-0.5 rounded bg-[#10192A] border border-[#1E293B] text-[#F1F5F9]/80 font-mono text-[10px]">
                          {ind}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Tese Técnica */}
                <div className="mt-2 text-xs text-[#94A3B8] leading-relaxed border-l-2 border-[#1E293B] pl-2.5 py-0.5">
                  <p className="text-[#F1F5F9]/90">
                    {s.aiEngine?.thesis || s.technicalReason}
                  </p>
                </div>

                {/* Cálculo de Posição / Capital Real */}
                {s.status === 'OPEN' && !exitOnly && realCapital > 0 && (() => {
                  if (futures) {
                    const lev = Math.min(futuresLeverage, maxSafeLeverage(s.entryPrice, s.stopLossPrice));
                    const sz = futuresSizing({
                      balance: realCapital,
                      entry: s.entryPrice,
                      stop: s.stopLossPrice,
                      riskPercent: realRiskPercent,
                      leverage: lev,
                      feeRate: TRADING_FEE_RATE
                    });
                    return sz.notional > 0 ? (
                      <div className="text-xs text-[#94A3B8] mt-2 bg-[#0A0F1D] border border-[#1E293B]/70 rounded-lg px-2.5 py-1.5 flex items-center justify-between">
                        <span>Capital {fmtUsd(realCapital)} ({lev}x):</span>
                        <span className="font-mono text-[#F1F5F9]">
                          Margem {fmtUsd(sz.margin)} · Risco max {fmtUsd(sz.maxLoss)}
                        </span>
                      </div>
                    ) : null;
                  }
                  const size = suggestAmount(realCapital, s.entryPrice, s.stopLossPrice, realRiskPercent);
                  const loss = size * ((s.entryPrice - s.stopLossPrice) / s.entryPrice);
                  return size > 0 ? (
                    <div className="text-xs text-[#94A3B8] mt-2 bg-[#0A0F1D] border border-[#1E293B]/70 rounded-lg px-2.5 py-1.5 flex items-center justify-between">
                      <span>Capital {fmtUsd(realCapital)}:</span>
                      <span className="font-mono text-[#F1F5F9]">
                        Compra {fmtUsd(size)} · Risco max {fmtUsd(loss)}
                      </span>
                    </div>
                  ) : null;
                })()}

                {/* Botões de Ação */}
                <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-[#1E293B]/60">
                  <button
                    onClick={() => onSelectCoinBySymbol(s.symbol)}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-[#10192A] hover:bg-[#1E293B] text-[#38BDF8] border border-[#2E405E]/60 flex items-center gap-1.5 transition-all cursor-pointer"
                    title="Ver gráfico com Médias, RSI e Bandas de Bollinger"
                  >
                    <BarChart2 className="w-3.5 h-3.5" />
                    <span>Ver no Gráfico</span>
                  </button>

                  <div className="flex items-center gap-2">
                    {s.status === 'OPEN' && !exitOnly && (
                      <button
                        onClick={() => onSimulate(s)}
                        className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-[#F5AC37] hover:bg-[#FBBF24] text-[#0B0F17] shadow-sm transition-all active:scale-95 cursor-pointer"
                      >
                        Simular Ordem
                      </button>
                    )}
                    {s.status === 'OPEN' && exitOnly && openPos && (
                      <button
                        onClick={() => onClosePosition(openPos.id)}
                        className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-[#F43F5E] hover:bg-[#e11d48] text-white transition-all cursor-pointer"
                      >
                        Encerrar Posição
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* PAINEL DE PERFORMANCE HISTÓRICA */}
      <PerformancePanel signals={combinedList} />

      <div className="text-[11px] text-[#94A3B8] text-center pt-2 leading-relaxed">
        Terminal quantitativo com execução de sinais via análise de confluência técnica e fluxo. Sempre gerencie o risco e utilize Stop Loss.
      </div>
    </div>
  );
};

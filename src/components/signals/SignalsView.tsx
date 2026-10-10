import React, { useState, useMemo } from 'react';
import { Radio, Filter, ArrowUpRight, ArrowDownRight, CheckCircle2, XCircle, Clock, Wallet } from 'lucide-react';
import { TechnicalSignal, SignalStrategy, SignalStatus, CryptoAsset } from '../../types/crypto';
import { DisclaimerBanner } from '../common/DisclaimerBanner';
import { Badge } from '../common/Badge';

export interface ScanInfo {
  lastScanAt: number | null;
  lastError: string | null;
  scannedPairs: number;
  universeSource: string | null;
  universeCount: number;
  skipped: string[];
  running: boolean;
}

interface SignalsViewProps {
  scanInfo?: ScanInfo | null;
  signals: TechnicalSignal[];
  assets: CryptoAsset[];
  onOpenTradeModal: (asset: CryptoAsset) => void;
  onSelectCoinBySymbol: (symbol: string) => void;
}

const PERIOD_MS = { '24h': 24 * 3600e3, '7d': 7 * 24 * 3600e3, '30d': 30 * 24 * 3600e3 } as const;

export const SignalsView: React.FC<SignalsViewProps> = ({
  scanInfo,
  signals,
  assets,
  onOpenTradeModal,
  onSelectCoinBySymbol
}) => {
  const [selectedCoin, setSelectedCoin] = useState<string>('ALL');
  const [selectedStrategy, setSelectedStrategy] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedPeriod, setSelectedPeriod] = useState<'24h' | '7d' | '30d'>('7d');

  // Moedas disponíveis a partir dos sinais
  const availableCoins = useMemo(() => {
    const set = new Set(signals.map((s) => s.baseAsset));
    return ['ALL', ...Array.from(set)];
  }, [signals]);

  // Estratégias disponíveis
  const availableStrategies = [
    { id: 'ALL', label: 'Todas Estratégias' },
    { id: 'EMA_GOLDEN_CROSS', label: 'Cruzamento EMA' },
    { id: 'RSI_DIVERGENCE', label: 'Divergência RSI' },
    { id: 'BREAKOUT_RESISTANCE', label: 'Rompimento' },
    { id: 'SUPPORT_RETEST', label: 'Reteste Suporte' },
    { id: 'MEAN_REVERSION', label: 'Reversão à Média' },
    { id: 'VOLUME_SPIKE', label: 'Volume Spike' }
  ];

  const filteredSignals = useMemo(() => {
    const now = Date.now();
    return signals.filter((s) => {
      const matchCoin = selectedCoin === 'ALL' || s.baseAsset === selectedCoin;
      const matchStrategy = selectedStrategy === 'ALL' || s.strategy === selectedStrategy;
      const matchStatus = selectedStatus === 'ALL' || s.status === selectedStatus;
      // Sinais reais têm createdAt; sinais de demonstração não têm data e ficam sempre visíveis.
      const createdAt = (s as TechnicalSignal & { createdAt?: number }).createdAt;
      const matchPeriod = createdAt === undefined || now - createdAt <= PERIOD_MS[selectedPeriod];
      return matchCoin && matchStrategy && matchStatus && matchPeriod;
    });
  }, [signals, selectedCoin, selectedStrategy, selectedStatus, selectedPeriod]);

  const getStatusBadge = (status: SignalStatus) => {
    switch (status) {
      case 'OPEN':
        return <Badge variant="cyan" size="sm">EM ABERTO</Badge>;
      case 'TARGET_HIT':
        return <Badge variant="green" size="sm">ALVO ATINGIDO</Badge>;
      case 'STOP_HIT':
        return <Badge variant="red" size="sm">STOP LOSS</Badge>;
      case 'EXPIRED':
        return <Badge variant="neutral" size="sm">EXPIRADO</Badge>;
    }
  };

  return (
    <div className="space-y-3 pb-24">
      {/* Disclaimer Regulatório e de Risco */}
      <DisclaimerBanner type="signals" />

      {/* Estado do scanner */}
      <div className="bg-[#121722] border border-slate-800 rounded-2xl p-3 text-[11px] text-slate-400">
        {scanInfo && scanInfo.lastScanAt && !scanInfo.lastError ? (
          <span>
            <span className="text-emerald-400 font-semibold">Scanner ativo</span> — {scanInfo.universeCount} moedas do top 100
            ({scanInfo.universeSource === 'COINMARKETCAP' ? 'CoinMarketCap' : 'CoinGecko'}), {scanInfo.scannedPairs} análises na última varredura
            ({new Date(scanInfo.lastScanAt).toLocaleTimeString('pt-BR')}).
          </span>
        ) : (
          <span>
            <span className="text-amber-300 font-semibold">Modo demonstração</span> — exibindo sinais de exemplo.{' '}
            {scanInfo?.running ? 'Primeira varredura em andamento…' : scanInfo?.lastError ?? 'Servidor/scanner indisponível.'}
          </span>
        )}
        {scanInfo && !scanInfo.lastError && scanInfo.skipped.length > 0 && (
          <details className="mt-1.5">
            <summary className="cursor-pointer text-slate-500">
              {scanInfo.skipped.length} do top 100 sem par USDT na Binance (ignoradas)
            </summary>
            <p className="mt-1 text-[10px] text-slate-500 leading-relaxed">{scanInfo.skipped.join(', ')}</p>
          </details>
        )}
      </div>

      {/* Barra de Filtros por Moeda, Estratégia e Status */}
      <div className="bg-[#121722] border border-slate-800 rounded-2xl p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-emerald-400" />
            Filtros do Radar
          </span>
          <span className="text-[10px] text-slate-500 font-mono">
            {filteredSignals.length} sinal(is)
          </span>
        </div>

        {/* Filtro por Moeda (Scroll Horizontal com toque suave) */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          {availableCoins.map((coin) => (
            <button
              key={coin}
              onClick={() => setSelectedCoin(coin)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition shrink-0 ${
                selectedCoin === coin
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-white'
              }`}
            >
              {coin === 'ALL' ? 'Todas Moedas' : coin}
            </button>
          ))}
        </div>

        {/* Filtro por Estratégia & Status */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-slate-400 block mb-1">Estratégia Técnica</label>
            <select
              value={selectedStrategy}
              onChange={(e) => setSelectedStrategy(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 text-slate-300 text-xs rounded-xl p-2 focus:outline-none focus:border-emerald-500"
            >
              {availableStrategies.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] text-slate-400 block mb-1">Status do Sinal</label>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 text-slate-300 text-xs rounded-xl p-2 focus:outline-none focus:border-emerald-500"
            >
              <option value="ALL">Todos os Status</option>
              <option value="OPEN">Em Aberto</option>
              <option value="TARGET_HIT">Alvo Atingido</option>
              <option value="STOP_HIT">Stop Loss</option>
              <option value="EXPIRED">Expirado</option>
            </select>
          </div>
        </div>

        {/* Filtro de Janela de Tempo */}
        <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-[11px]">
          <span className="text-slate-400">Janela Temporal:</span>
          <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800">
            {(['24h', '7d', '30d'] as const).map((period) => (
              <button
                key={period}
                onClick={() => setSelectedPeriod(period)}
                className={`px-2.5 py-0.5 rounded text-[10px] font-medium transition ${
                  selectedPeriod === period
                    ? 'bg-slate-800 text-white font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {period}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Lista de Sinais */}
      <div className="space-y-2.5">
        {filteredSignals.length === 0 ? (
          <div className="bg-[#121722] border border-slate-800 rounded-2xl p-8 text-center space-y-2">
            <Radio className="w-8 h-8 text-slate-600 mx-auto" />
            <p className="text-sm text-slate-300">Nenhum sinal encontrado com os filtros aplicados.</p>
            <p className="text-xs text-slate-500">Tente selecionar "Todas Moedas" ou "Todas Estratégias".</p>
          </div>
        ) : (
          filteredSignals.map((signal) => {
            const isLong = signal.direction === 'LONG';
            const matchedAsset: CryptoAsset = assets.find((a) => a.symbol === signal.symbol) || {
              id: signal.symbol.toLowerCase(),
              symbol: signal.symbol,
              baseAsset: signal.baseAsset,
              quoteAsset: 'USDT',
              name: signal.baseAsset,
              price: signal.entryPrice,
              change24h: 0,
              high24h: signal.entryPrice,
              low24h: signal.entryPrice,
              volume24h: 0,
              exchanges: ['binance'],
              sparkline: [signal.entryPrice],
              lastUpdated: signal.timestamp,
              isDemoData: signal.isDemo
            };
            const score = (signal as TechnicalSignal & { score?: number }).score;

            return (
              <div
                key={signal.id}
                className="bg-[#121722] border border-slate-800/90 rounded-2xl p-3.5 space-y-2.5 transition"
              >
                {/* Cabeçalho do Card */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-bold px-2.5 py-0.5 rounded-lg flex items-center gap-1 ${
                        isLong
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                      }`}
                    >
                      {isLong ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                      {isLong ? 'COMPRA' : 'VENDA'}
                    </span>

                    <button
                      onClick={() => onSelectCoinBySymbol(signal.symbol)}
                      className="text-sm font-bold text-white hover:text-emerald-400 transition"
                    >
                      {signal.symbol}
                    </button>

                    <span className="text-[10px] bg-slate-900 border border-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-mono">
                      {signal.timeframe}
                    </span>

                    {signal.isDemo ? (
                      <span className="text-[9px] bg-amber-500/10 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded font-mono">
                        DEMO
                      </span>
                    ) : (
                      score !== undefined && (
                        <span className="text-[9px] bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 px-1.5 py-0.5 rounded font-mono">
                          {score > 0 ? '+' : ''}{score}
                        </span>
                      )
                    )}
                  </div>

                  {getStatusBadge(signal.status)}
                </div>

                {/* Estratégia e Racional Técnico */}
                <div>
                  <h4 className="text-xs font-bold text-slate-200">
                    {signal.strategyName}
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                    {signal.technicalReason}
                  </p>
                </div>

                {/* Tags de Indicadores Acionados */}
                <div className="flex flex-wrap gap-1">
                  {signal.indicatorsTriggered.map((ind, i) => (
                    <span
                      key={i}
                      className="text-[10px] bg-slate-900/90 border border-slate-800 text-slate-300 px-2 py-0.5 rounded-md"
                    >
                      {ind}
                    </span>
                  ))}
                </div>

                {/* Preços: Entrada, Alvo, Stop e Relação R/R */}
                <div className="grid grid-cols-4 gap-1 pt-2 border-t border-slate-800/80 text-[11px] font-mono">
                  <div>
                    <span className="text-[9px] text-slate-500 block font-sans">ENTRADA</span>
                    <span className="text-white">${signal.entryPrice.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-500 block font-sans">ALVO (TP)</span>
                    <span className="text-emerald-400">${signal.targetPrice.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-500 block font-sans">STOP LOSS</span>
                    <span className="text-rose-400">${signal.stopLossPrice.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-500 block font-sans">RISCO:RETORNO</span>
                    <span className="text-cyan-400 font-bold">{signal.riskRewardRatio}</span>
                  </div>
                </div>

                {/* Rodapé: Timestamp e Ação Simular */}
                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px]">
                  <span className="text-slate-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {signal.timestamp}
                  </span>

                  <button
                    onClick={() => onOpenTradeModal(matchedAsset)}
                    className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-3 py-1.5 rounded-xl font-semibold flex items-center gap-1 transition"
                  >
                    <Wallet className="w-3 h-3" />
                    Simular no Paper Trading
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

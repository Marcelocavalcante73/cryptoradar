import React, { useState, useEffect } from 'react';
import { Sliders, Shield, Bell, Send, Database, Save, Check, Code2, AlertTriangle, Key, Volume2, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import { AppSettings, RiskSettings } from '../../types/crypto';
import { soundService } from '../../services/soundService';
import { sendTelegramTestMessage, getTelegramServerStatus, TelegramBackendStatus, TelegramSendResult } from '../../services/telegramService';
import { apiService, ExchangeHealth } from '../../services/apiService';

interface SettingsViewProps {
  settings: AppSettings;
  onSaveSettings: (settings: AppSettings) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onSaveSettings
}) => {
  const [formData, setFormData] = useState<AppSettings>(settings);
  const [savedNotification, setSavedNotification] = useState(false);
  const [activeTab, setActiveTab] = useState<'risk' | 'exchanges' | 'telegram' | 'architecture'>('risk');

  // Estado de teste do Telegram
  const [telegramTesting, setTelegramTesting] = useState(false);
  const [telegramResult, setTelegramResult] = useState<TelegramSendResult | null>(null);
  const [telegramServerStatus, setTelegramServerStatus] = useState<TelegramBackendStatus | null>(null);

  // Estado de teste da API de Exchanges
  const [exchangeChecking, setExchangeChecking] = useState(false);
  const [exchangeHealth, setExchangeHealth] = useState<{ binance: ExchangeHealth; bybit: ExchangeHealth } | null>(null);

  // Teste de som
  const [soundTested, setSoundTested] = useState(false);

  useEffect(() => {
    getTelegramServerStatus().then(setTelegramServerStatus).catch(() => null);
  }, [activeTab]);

  const handleRiskChange = (field: keyof RiskSettings, value: any) => {
    setFormData((prev) => ({
      ...prev,
      risk: {
        ...prev.risk,
        [field]: value
      }
    }));
  };

  const handleTestSound = () => {
    soundService.playSuccess();
    setSoundTested(true);
    setTimeout(() => setSoundTested(false), 2000);
  };

  const handleTestTelegram = async () => {
    setTelegramTesting(true);
    setTelegramResult(null);
    try {
      const res = await sendTelegramTestMessage(formData.telegram.chatIdPlaceholder);
      setTelegramResult(res);
      getTelegramServerStatus().then(setTelegramServerStatus).catch(() => null);
    } catch (e: any) {
      setTelegramResult({
        success: false,
        configured: false,
        message: 'Erro inesperado ao disparar teste do Telegram: ' + (e?.message || 'falha de rede')
      });
    } finally {
      setTelegramTesting(false);
    }
  };

  const handleCheckExchanges = async () => {
    setExchangeChecking(true);
    try {
      await apiService.fetchTickers();
      const health = await apiService.checkExchangeHealth();
      setExchangeHealth(health);
    } catch {
      // Ignora
    } finally {
      setExchangeChecking(false);
    }
  };

  const handleSave = () => {
    onSaveSettings(formData);
    setSavedNotification(true);
    setTimeout(() => setSavedNotification(false), 2500);
  };

  return (
    <div className="space-y-4 pb-28">
      {/* Abas Superiores das Configurações */}
      <div className="flex items-center gap-1 bg-[#121722] border border-slate-800 rounded-2xl p-1 overflow-x-auto no-scrollbar">
        {[
          { id: 'risk', label: 'Gestão de Risco & Alertas', icon: Shield },
          { id: 'exchanges', label: 'Exchanges', icon: Key },
          { id: 'telegram', label: 'Telegram', icon: Send },
          { id: 'architecture', label: 'Arquitetura', icon: Database }
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex-1 py-2 px-2.5 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1.5 shrink-0 ${
                isActive
                  ? 'bg-slate-800 text-emerald-400 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* 1. Gestão de Risco & Alertas Sonoros */}
      {activeTab === 'risk' && (
        <div className="space-y-3">
          {/* Card de Alertas Sonoros */}
          <div className="bg-[#121722] border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-xl bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 flex items-center justify-center">
                  <Volume2 className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white">Alertas Sonoros Nativos</h4>
                  <p className="text-[10px] text-slate-400">Sintetizador Web Audio API para execuções e gatilhos de TP/SL</p>
                </div>
              </div>

              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.soundAlerts}
                  onChange={(e) => setFormData((prev) => ({ ...prev, soundAlerts: e.target.checked }))}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500" />
              </label>
            </div>

            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
              <span className="text-[11px] text-slate-400">
                {formData.soundAlerts ? 'Áudio ativado para execuções' : 'Áudio silenciado'}
              </span>
              <button
                type="button"
                onClick={handleTestSound}
                className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-200 hover:text-white flex items-center gap-1.5 transition"
              >
                <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
                <span>{soundTested ? 'Tocando...' : 'Testar Som Real'}</span>
              </button>
            </div>
          </div>

          {/* Parâmetros de Risco */}
          <div className="bg-[#121722] border border-slate-800 rounded-2xl p-4 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-400" />
                Parâmetros de Gestão de Risco
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Defina limites matemáticos estritos para proteção contra perdas acentuadas.
              </p>
            </div>

            <div className="space-y-3.5 text-xs">
              {/* Risco Máximo por Operação */}
              <div>
                <div className="flex justify-between font-medium text-slate-300 mb-1">
                  <span>Risco Máximo por Operação (% do capital)</span>
                  <span className="text-emerald-400 font-mono font-bold">
                    {formData.risk.maxRiskPerTradePercent}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="5.0"
                  step="0.5"
                  value={formData.risk.maxRiskPerTradePercent}
                  onChange={(e) => handleRiskChange('maxRiskPerTradePercent', parseFloat(e.target.value))}
                  className="w-full accent-emerald-500"
                />
                <span className="text-[10px] text-slate-500">Recomendação profissional: 1% a 2% por trade.</span>
              </div>

              {/* Limite de Perda Diária (Daily Drawdown) */}
              <div>
                <div className="flex justify-between font-medium text-slate-300 mb-1">
                  <span>Limite de Perda Diária (Drawdown Máximo)</span>
                  <span className="text-rose-400 font-mono font-bold">
                    {formData.risk.dailyMaxDrawdownPercent}%
                  </span>
                </div>
                <input
                  type="range"
                  min="2.0"
                  max="10.0"
                  step="1.0"
                  value={formData.risk.dailyMaxDrawdownPercent}
                  onChange={(e) => handleRiskChange('dailyMaxDrawdownPercent', parseFloat(e.target.value))}
                  className="w-full accent-rose-500"
                />
                <span className="text-[10px] text-slate-500">Trava novas ordens simuladas caso o limite seja atingido.</span>
              </div>

              {/* Stop Loss Padrão */}
              <div>
                <div className="flex justify-between font-medium text-slate-300 mb-1">
                  <span>Stop Loss Padrão Sugerido</span>
                  <span className="text-amber-400 font-mono font-bold">
                    {formData.risk.defaultStopLossPercent}%
                  </span>
                </div>
                <input
                  type="range"
                  min="1.0"
                  max="6.0"
                  step="0.5"
                  value={formData.risk.defaultStopLossPercent}
                  onChange={(e) => handleRiskChange('defaultStopLossPercent', parseFloat(e.target.value))}
                  className="w-full accent-amber-500"
                />
              </div>

              {/* Relação Risco:Retorno Mínima */}
              <div>
                <div className="flex justify-between font-medium text-slate-300 mb-1">
                  <span>Relação Risco : Retorno Mínima</span>
                  <span className="text-cyan-400 font-mono font-bold">
                    1 : {formData.risk.defaultTakeProfitRatio}
                  </span>
                </div>
                <input
                  type="range"
                  min="1.5"
                  max="4.0"
                  step="0.5"
                  value={formData.risk.defaultTakeProfitRatio}
                  onChange={(e) => handleRiskChange('defaultTakeProfitRatio', parseFloat(e.target.value))}
                  className="w-full accent-cyan-500"
                />
              </div>

              {/* Toggles Adicionais */}
              <div className="pt-2 border-t border-slate-800 space-y-2">
                <label className="flex items-center justify-between text-slate-300 cursor-pointer">
                  <span>Alertar ao detectar alta volatilidade</span>
                  <input
                    type="checkbox"
                    checked={formData.risk.alertOnHighVolatility}
                    onChange={(e) => handleRiskChange('alertOnHighVolatility', e.target.checked)}
                    className="rounded bg-slate-900 border-slate-700 text-emerald-500"
                  />
                </label>

                <label className="flex items-center justify-between text-slate-300 cursor-pointer">
                  <span>Trailing Stop automático simulado</span>
                  <input
                    type="checkbox"
                    checked={formData.risk.enableTrailingStop}
                    onChange={(e) => handleRiskChange('enableTrailingStop', e.target.checked)}
                    className="rounded bg-slate-900 border-slate-700 text-emerald-500"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. Integração com Exchanges (Binance & Bybit separadas) */}
      {activeTab === 'exchanges' && (
        <div className="bg-[#121722] border border-slate-800 rounded-2xl p-4 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Key className="w-4 h-4 text-cyan-400" />
                Conectores Binance & Bybit
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Validação separada de conectores públicos com transparência de status.
              </p>
            </div>

            <button
              type="button"
              onClick={handleCheckExchanges}
              disabled={exchangeChecking}
              className="px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] font-medium text-slate-300 flex items-center gap-1 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${exchangeChecking ? 'animate-spin' : ''}`} />
              <span>Verificar</span>
            </button>
          </div>

          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-xs text-amber-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
            <div>
              <strong className="font-semibold block">Regra de Segurança Estrita:</strong>
              Nenhuma chave privada (Secret Key) é exigida ou aceita nesta interface. As cotações são obtidas via endpoints públicos ou snapshots de demonstração.
            </div>
          </div>

          {/* Intervalo de Atualização de Cotações */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white">Intervalo de Atualização Periódica</span>
              <span className="text-xs font-mono font-bold text-emerald-400">
                {formData.refreshIntervalSeconds || 30}s
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {[10, 15, 30, 60].map((sec) => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => setFormData((prev) => ({ ...prev, refreshIntervalSeconds: sec }))}
                  className={`py-1.5 rounded-lg text-xs font-mono font-medium border transition ${
                    (formData.refreshIntervalSeconds || 30) === sec
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                      : 'bg-[#161D2B] text-slate-400 border-slate-700/80 hover:text-white'
                  }`}
                >
                  {sec}s
                </button>
              ))}
            </div>
            <div className="bg-[#101520] border border-slate-800 rounded-lg p-2.5 text-[11px] text-slate-400 space-y-1">
              <span className="text-amber-400 font-semibold block">Aviso sobre o Ciclo de Vida:</span>
              <p>
                O monitoramento periódico ocorre no navegador do usuário. Se a aba for fechada, as ordens e verificações pausam até reabertura.
              </p>
            </div>
          </div>

          {/* Conector Binance */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                <span className="text-xs font-bold text-white">Binance Public Ticker API</span>
              </div>
              <span className="text-[10px] bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded font-mono border border-emerald-500/30">
                {exchangeHealth?.binance ? exchangeHealth.binance.statusLabel : 'Endpoint Público'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Consulta pública ao endpoint REST <code className="text-slate-300">/api/v3/ticker/24hr</code> para cotações dos 10 pares monitorados. Em caso de bloqueio regional de IP ou ausência de conexão, o sistema migra transparentemente para dados de demonstração.
            </p>
          </div>

          {/* Conector Bybit - Relato Honesto de Status */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-500" />
                <span className="text-xs font-bold text-white">Bybit V5 Public API</span>
              </div>
              <span className="text-[10px] bg-rose-500/15 text-rose-300 border border-rose-500/30 px-2 py-0.5 rounded font-mono">
                Não Implementada
              </span>
            </div>
            <div className="bg-[#101520] border border-slate-800 rounded-lg p-2.5 text-[11px] text-slate-400 space-y-1">
              <strong className="text-rose-400 block font-semibold">Status Técnico Oficial:</strong>
              <p>
                A integração de API com a Bybit <strong>não está implementada</strong> nesta versão do CryptoRadar. Pares associados à Bybit utilizam dados demonstrativos ou a cotação de referência pública da Binance. Não é simulada falsa conexão ativa para esta corretora.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 3. Telegram Bot de Notificações - Integração Segura via Backend */}
      {activeTab === 'telegram' && (
        <div className="bg-[#121722] border border-slate-800 rounded-2xl p-4 space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Send className="w-4 h-4 text-cyan-400" />
                Notificações no Telegram (Integração Segura)
              </h3>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                telegramServerStatus?.configured
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                  : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
              }`}>
                {telegramServerStatus?.configured ? 'Servidor Pronto' : 'Backend Pendente (.env)'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Envio seguro de alertas via backend. O token do bot fica protegido no servidor e nunca é exposto no navegador.
            </p>
          </div>

          {/* Banner de Status do Backend */}
          <div className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
            telegramServerStatus?.configured
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
          }`}>
            <Shield className="w-4 h-4 shrink-0 mt-0.5 text-cyan-400" />
            <div>
              <span className="font-semibold block">
                {telegramServerStatus?.configured
                  ? 'Segurança de Credenciais Ativa'
                  : 'Configuração do Servidor Pendente'}
              </span>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {telegramServerStatus?.configured
                  ? 'A variável TELEGRAM_BOT_TOKEN está configurada no backend. Disparos reais autorizados.'
                  : 'Para ativar o envio real, defina a variável TELEGRAM_BOT_TOKEN no arquivo .env do servidor. Nenhum token transita pelo frontend por razões de segurança.'}
              </p>
            </div>
          </div>

          <div className="space-y-3 text-xs">
            <label className="flex items-center justify-between text-slate-300 cursor-pointer">
              <span>Habilitar Alertas no Telegram</span>
              <input
                type="checkbox"
                checked={formData.telegram.enabled}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    telegram: { ...prev.telegram, enabled: e.target.checked }
                  }))
                }
                className="rounded bg-slate-900 border-slate-700 text-cyan-500"
              />
            </label>

            <div>
              <label className="text-[10px] text-slate-400 block mb-1">
                Destino: Chat ID ou Canal (@canal)
              </label>
              <input
                type="text"
                value={formData.telegram.chatIdPlaceholder}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    telegram: { ...prev.telegram, chatIdPlaceholder: e.target.value }
                  }))
                }
                placeholder="Ex: @meucanal ou 123456789"
                className="w-full bg-[#161D2B] border border-slate-700/80 rounded-xl px-3 py-2 font-mono text-slate-300 focus:outline-none focus:border-cyan-400"
              />
              <span className="text-[10px] text-slate-500 block mt-1">
                Para canais públicos use @nome_do_canal. Para conversas privadas, envie /start para o bot e insira o seu ID numérico.
              </span>
            </div>

            {/* Resultado do Teste de Envio */}
            {telegramResult && (
              <div
                className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
                  telegramResult.success
                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                }`}
              >
                {telegramResult.success ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
                ) : (
                  <XCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                )}
                <div>
                  <strong className="block font-semibold">
                    {telegramResult.success ? 'Envio Real Concluído:' : 'Falha na Entrega:'}
                  </strong>
                  <span>{telegramResult.message}</span>
                </div>
              </div>
            )}

            <button
              type="button"
              disabled={telegramTesting}
              onClick={handleTestTelegram}
              className="w-full bg-slate-800 hover:bg-slate-700 active:scale-[0.99] text-cyan-300 font-semibold py-2.5 px-3 rounded-xl border border-slate-700 flex items-center justify-center gap-2 transition disabled:opacity-50"
            >
              {telegramTesting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
                  <span>Enviando pelo Backend...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 text-cyan-400" />
                  <span>Testar Envio via Backend</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* 4. Arquitetura Modular & Backend */}
      {activeTab === 'architecture' && (
        <div className="bg-[#121722] border border-slate-800 rounded-2xl p-4 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Database className="w-4 h-4 text-purple-400" />
              Arquitetura Modular Preparada
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Esquema de integração futura com FastAPI, Supabase e microsserviços.
            </p>
          </div>

          <div className="space-y-3 text-xs">
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 space-y-1.5 font-mono text-[11px]">
              <span className="text-emerald-400 font-bold block">1. Endpoints FastAPI Planejados:</span>
              <p className="text-slate-300">• GET /api/v1/market/tickers (Stream SSE / WebSockets)</p>
              <p className="text-slate-300">• GET /api/v1/market/candles/{'{symbol}'}?timeframe=4h</p>
              <p className="text-slate-300">• GET /api/v1/signals/radar (Algoritmos TA-Lib em Python)</p>
              <p className="text-slate-300">• POST /api/v1/paper-trading/order</p>
              <p className="text-slate-300">• POST /api/v1/telegram/webhook</p>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 space-y-1.5 font-mono text-[11px]">
              <span className="text-cyan-400 font-bold block">2. Esquema Relacional Supabase (PostgreSQL):</span>
              <p className="text-slate-300">• tabela: <strong className="text-white">user_risk_profiles</strong> (parâmetros de risco)</p>
              <p className="text-slate-300">• tabela: <strong className="text-white">technical_signals</strong> (sinais gerados com audit)</p>
              <p className="text-slate-300">• tabela: <strong className="text-white">paper_positions</strong> (ordens simuladas com PnL)</p>
              <p className="text-slate-300">• tabela: <strong className="text-white">watchlists</strong> (moedas favoritadas)</p>
            </div>
          </div>
        </div>
      )}

      {/* Botão de Salvar Configurações */}
      <div className="sticky bottom-16 z-30 pt-2">
        <button
          onClick={handleSave}
          className="w-full bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] text-slate-950 font-bold py-3.5 px-4 rounded-2xl shadow-xl shadow-emerald-500/20 flex items-center justify-center gap-2 text-sm transition"
        >
          {savedNotification ? (
            <>
              <Check className="w-4 h-4 text-slate-950 font-bold" />
              Configurações Salvas com Sucesso!
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Salvar Parâmetros e Ajustes
            </>
          )}
        </button>
      </div>
    </div>
  );
};

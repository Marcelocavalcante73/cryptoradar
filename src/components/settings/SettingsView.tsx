import React, { useState } from 'react';
import { Sliders, Shield, Bell, Send, Database, Save, Check, Code2, AlertTriangle, Key } from 'lucide-react';
import { AppSettings, RiskSettings } from '../../types/crypto';

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

  const handleRiskChange = (field: keyof RiskSettings, value: any) => {
    setFormData((prev) => ({
      ...prev,
      risk: {
        ...prev.risk,
        [field]: value
      }
    }));
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
          { id: 'risk', label: 'Gestão de Risco', icon: Shield },
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

      {/* 1. Gestão de Risco */}
      {activeTab === 'risk' && (
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
      )}

      {/* 2. Integração com Exchanges (Binance & Bybit) */}
      {activeTab === 'exchanges' && (
        <div className="bg-[#121722] border border-slate-800 rounded-2xl p-4 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Key className="w-4 h-4 text-cyan-400" />
              Conectores Binance & Bybit
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Protocolo seguro de comunicação exclusivamente em modo leitura.
            </p>
          </div>

          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-xs text-amber-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
            <div>
              <strong className="font-semibold block">Regra de Segurança Estrita:</strong>
              Nenhuma chave privada (Secret Key) é exigida ou aceita nesta interface. As cotações públicas são obtidas via REST/WebSocket público ou snapshots de referência.
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
                O monitoramento periódico de preços e a verificação de ordens LIMIT pendentes e Stop-Loss ocorrem exclusivamente no navegador. <strong>O monitoramento é interrompido quando a aba ou a aplicação for fechada.</strong>
              </p>
            </div>
          </div>

          {/* Binance */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-yellow-400" />
                <span className="text-xs font-bold text-white">Binance Spot & Futures API</span>
              </div>
              <span className="text-[10px] bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded font-mono">
                API Pública Ativa
              </span>
            </div>

            <div>
              <label className="text-[10px] text-slate-400 block mb-1">
                API Key Pública (Opcional para Rate Limit estendido)
              </label>
              <input
                type="text"
                value={formData.exchange.binanceApiKeyPreview}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    exchange: { ...prev.exchange, binanceApiKeyPreview: e.target.value }
                  }))
                }
                placeholder="Chave pública apenas de leitura..."
                className="w-full bg-[#161D2B] border border-slate-700/80 rounded-xl px-3 py-2 text-xs font-mono text-slate-300 focus:outline-none focus:border-yellow-400"
              />
            </div>
          </div>

          {/* Bybit */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-slate-500" />
                <span className="text-xs font-bold text-white">Bybit V5 Public API</span>
              </div>
              <span className="text-[10px] bg-slate-800 text-slate-400 border border-slate-700/60 px-2 py-0.5 rounded font-mono">
                Não Conectada (Pendente)
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Integração com feeds públicos da Bybit planejada para futura versão. Não ativa nesta versão.
            </p>

            <div>
              <label className="text-[10px] text-slate-400 block mb-1">
                API Key Pública Bybit (Opcional Leitura - Futura)
              </label>
              <input
                type="text"
                disabled
                value="Integração futura - Somente leitura via backend"
                placeholder="Chave pública apenas de leitura..."
                className="w-full bg-[#161D2B] border border-slate-700/80 rounded-xl px-3 py-2 text-xs font-mono text-slate-500 cursor-not-allowed"
              />
            </div>
          </div>
        </div>
      )}

      {/* 3. Telegram Bot de Notificações */}
      {activeTab === 'telegram' && (
        <div className="bg-[#121722] border border-slate-800 rounded-2xl p-4 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Send className="w-4 h-4 text-cyan-400" />
              Notificações no Telegram
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Receba alertas imediatos de sinais técnicos e execuções no seu canal.
            </p>
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
              <label className="text-[10px] text-slate-400 block mb-1">Telegram Bot Token (Demo)</label>
              <input
                type="text"
                value={formData.telegram.botTokenPlaceholder}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    telegram: { ...prev.telegram, botTokenPlaceholder: e.target.value }
                  }))
                }
                className="w-full bg-[#161D2B] border border-slate-700/80 rounded-xl px-3 py-2 font-mono text-slate-300 focus:outline-none focus:border-cyan-400"
              />
            </div>

            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Chat ID ou Canal (@canal)</label>
              <input
                type="text"
                value={formData.telegram.chatIdPlaceholder}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    telegram: { ...prev.telegram, chatIdPlaceholder: e.target.value }
                  }))
                }
                className="w-full bg-[#161D2B] border border-slate-700/80 rounded-xl px-3 py-2 font-mono text-slate-300 focus:outline-none focus:border-cyan-400"
              />
            </div>

            <button
              type="button"
              onClick={() => alert('Simulação de Alerta Enviada com Sucesso para o Chat ID!')}
              className="w-full py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-slate-300 hover:text-white transition font-medium"
            >
              Testar Envio de Mensagem (Simulado)
            </button>
          </div>
        </div>
      )}

      {/* 4. Arquitetura Modular & Backend (Documentação Pronta) */}
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

      {/* Botão de Salvar Configurações com o Polegar */}
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

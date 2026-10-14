import React, { useEffect, useState } from 'react';
import { AppSettings, MarketType } from '../../types/crypto';
import { MAX_LEVERAGE } from '../../services/futures';
import { soundService } from '../../services/soundService';
import { sendTelegramTestMessage, getTelegramServerStatus, TelegramBackendStatus } from '../../services/telegramService';
import { ScanInfo } from '../signals/SignalsView';
import { SyncNotice } from '../common/SyncNotice';
import { SyncStatus, StorageInfo, accessKey } from '../../services/remoteState';
import { localStore } from '../../services/localStore';

interface SettingsViewProps {
  settings: AppSettings;
  scanInfos: Record<MarketType, ScanInfo | null>;
  onSaveSettings: (settings: AppSettings) => void;
  onBack: () => void;
  onOpenBacktest: () => void;
  sync?: { status: SyncStatus; info: StorageInfo | null; detail?: string | null };
}

const card = 'bg-[#161920] border border-[#23272f] rounded-xl p-4';
const input = 'bg-[#0f1115] border border-[#2a2f3a] rounded-lg px-3 py-2.5 text-base text-slate-100 w-24 text-right tabular-nums focus:outline-none focus:border-slate-400';

export const SettingsView: React.FC<SettingsViewProps> = ({ settings, scanInfos, onSaveSettings, onBack, onOpenBacktest, sync }) => {
  const [tg, setTg] = useState<(TelegramBackendStatus & { chatConfigured?: boolean }) | null>(null);
  const [tgMsg, setTgMsg] = useState<string | null>(null);
  const [tgBusy, setTgBusy] = useState(false);
  const [health, setHealth] = useState<any | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [healthErr, setHealthErr] = useState<string | null>(null);

  const runHealth = async () => {
    setHealthBusy(true);
    setHealthErr(null);
    try {
      const r = await fetch('/api/health', { signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(r.status === 429 ? 'Muitas verificações seguidas. Aguarde um minuto.' : `Erro ${r.status}`);
      setHealth(await r.json());
    } catch (e: any) {
      setHealth(null);
      setHealthErr(`Não foi possível falar com o servidor: ${e?.message ?? 'sem resposta'}`);
    }
    setHealthBusy(false);
  };

  useEffect(() => {
    fetch('/api/telegram/status').then((r) => r.json()).then(setTg).catch(() => setTg(null));
  }, []);

  const setRisk = (patch: Partial<AppSettings['risk']>) => onSaveSettings({ ...settings, risk: { ...settings.risk, ...patch } });
  const num = (v: string, min: number, max: number, fallback: number) => {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };

  const testTelegram = async () => {
    setTgBusy(true);
    const res = await sendTelegramTestMessage('');
    setTgMsg(res.message);
    setTgBusy(false);
  };

  const row = 'flex items-center justify-between gap-3 py-2';

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-100">Ajustes</h2>
        <button onClick={onBack} className="text-sm text-slate-300 underline underline-offset-4">Voltar</button>
      </div>

      <section className={card}>
        <h3 className="text-sm font-medium text-slate-300 mb-2">Armazenamento e diagnóstico</h3>
        {sync && <SyncNotice status={sync.status} info={sync.info} blocked={localStore.isBlocked()} detail={sync.detail} />}
        {sync?.info && (
          <p className="text-xs text-slate-500 mt-1">
            Servidor: {sync.info.backend === 'supabase' ? 'Supabase' : sync.info.backend === 'file' ? 'arquivo' : 'memória'}
            {sync.info.keyRequired ? ' · protegido por chave de acesso' : ' · sem chave de acesso'}.
          </p>
        )}
        <div className="flex gap-2 flex-wrap mt-3">
          <button onClick={runHealth} disabled={healthBusy} className="border border-[#2a2f3a] text-slate-200 px-4 py-2.5 rounded-lg disabled:opacity-50">
            {healthBusy ? 'Verificando…' : 'Verificar agora'}
          </button>
          {sync?.info?.keyRequired && (
            <button onClick={() => { accessKey.clear(); window.location.reload(); }} className="border border-[#2a2f3a] text-slate-300 px-4 py-2.5 rounded-lg">Sair</button>
          )}
        </div>
        {healthErr && <p className="text-sm text-rose-400 mt-3">{healthErr}</p>}
        {health && (
          <div className="mt-3 space-y-3">
            <p className="text-xs text-slate-500">{health.host} · Node {health.node} · ligado há {health.uptimeMin} min</p>
            <ul className="space-y-1.5">
              {health.checks.map((c: any) => (
                <li key={c.id} className="flex items-start justify-between gap-3 text-sm">
                  <span className={c.ok ? 'text-slate-300' : 'text-rose-400'}>{c.ok ? '✓' : '✗'} {c.label}{c.detail ? <span className="text-slate-500"> · {c.detail}</span> : null}</span>
                  <span className="text-xs text-slate-500 tabular-nums shrink-0">{c.ms} ms</span>
                </li>
              ))}
            </ul>
            {health.warnings.length > 0 && (
              <ul className="space-y-1.5 text-sm text-amber-300 leading-relaxed list-disc pl-5">
                {health.warnings.map((w: string) => <li key={w}>{w}</li>)}
              </ul>
            )}
            <p className="text-xs text-slate-500 leading-relaxed">
              Scanners: spot {health.scanners.spot.signals} sinais{health.scanners.spot.lastError ? ` (erro: ${health.scanners.spot.lastError})` : ''} ·
              futuros {health.scanners.futures.signals}{health.scanners.futures.lastError ? ` (erro: ${health.scanners.futures.lastError})` : ''} ·
              tendência {health.scanners.trend.signals}{health.scanners.trend.lastError ? ` (erro: ${health.scanners.trend.lastError})` : ''}.
            </p>
          </div>
        )}
      </section>

      <section className={card}>
        <h3 className="text-sm font-medium text-slate-300 mb-1">Backtest</h3>
        <p className="text-xs text-slate-500 leading-relaxed mb-3">
          Testa a estratégia no histórico real das maiores moedas e diz se ela passa nos critérios antes de você simular ao vivo.
        </p>
        <button onClick={onOpenBacktest} className="border border-[#2a2f3a] text-slate-200 px-4 py-2.5 rounded-lg">Abrir backtest</button>
      </section>

      <section className={card}>
        <h3 className="text-sm font-medium text-slate-300 mb-1">Simulação</h3>
        <div className={row}>
          <span className="text-slate-200">Risco por operação (% do saldo)</span>
          <input className={input} inputMode="decimal" defaultValue={settings.risk.maxRiskPerTradePercent}
            onBlur={(e) => setRisk({ maxRiskPerTradePercent: num(e.target.value, 0.1, 10, settings.risk.maxRiskPerTradePercent) })} />
        </div>
        <div className={row}>
          <span className="text-slate-200">Stop padrão (%)</span>
          <input className={input} inputMode="decimal" defaultValue={settings.risk.defaultStopLossPercent}
            onBlur={(e) => setRisk({ defaultStopLossPercent: num(e.target.value, 0.5, 30, settings.risk.defaultStopLossPercent) })} />
        </div>
        <p className="text-xs text-slate-500">O valor sugerido em cada simulação é calculado para perder, no máximo, esse risco se o stop for atingido.</p>
      </section>

      <section className={card}>
        <h3 className="text-sm font-medium text-slate-300 mb-1">Capital real (opcional)</h3>
        <div className={row}>
          <span className="text-slate-200">Capital para operar (USDT)</span>
          <input className={input} inputMode="decimal" defaultValue={settings.realCapital || ''} placeholder="0"
            onBlur={(e) => onSaveSettings({ ...settings, realCapital: num(e.target.value, 0, 100000000, settings.realCapital || 0) })} />
        </div>
        <div className={row}>
          <span className="text-slate-200">Capital para operar na B3 (R$)</span>
          <input className={input} inputMode="decimal" defaultValue={settings.b3Capital || ''} placeholder="0"
            onBlur={(e) => onSaveSettings({ ...settings, b3Capital: num(e.target.value, 0, 1000000000, settings.b3Capital || 0) })} />
        </div>
        <div className={row}>
          <span className="text-slate-200">Risco por operação (%)</span>
          <input className={input} inputMode="decimal" defaultValue={settings.realRiskPercent ?? 1}
            onBlur={(e) => onSaveSettings({ ...settings, realRiskPercent: num(e.target.value, 0.1, 5, settings.realRiskPercent ?? 1) })} />
        </div>
        <div className={row}>
          <span className="text-slate-200">Alavancagem sugerida em futuros (x)</span>
          <input className={input} inputMode="decimal" defaultValue={settings.futuresLeverage ?? 3}
            onBlur={(e) => onSaveSettings({ ...settings, futuresLeverage: Math.round(num(e.target.value, 1, MAX_LEVERAGE, settings.futuresLeverage ?? 3)) })} />
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          Só serve para sugerir o tamanho da compra em cada sinal. O app não envia ordens: você opera na corretora, sempre com o stop.
          Comece com um valor que possa perder por inteiro.
        </p>
      </section>

      <section className={card}>
        <h3 className="text-sm font-medium text-slate-300 mb-1">App</h3>
        <div className={row}>
          <span className="text-slate-200">Atualizar preços a cada</span>
          <select
            value={settings.refreshIntervalSeconds}
            onChange={(e) => onSaveSettings({ ...settings, refreshIntervalSeconds: Number(e.target.value) })}
            className="bg-[#0f1115] border border-[#2a2f3a] rounded-lg px-3 py-2.5 text-base text-slate-100"
          >
            {[15, 30, 60].map((s) => <option key={s} value={s}>{s} segundos</option>)}
          </select>
        </div>
        <label className={row}>
          <span className="text-slate-200">Som ao encerrar operação</span>
          <input
            type="checkbox"
            className="w-5 h-5"
            checked={settings.soundAlerts}
            onChange={(e) => { onSaveSettings({ ...settings, soundAlerts: e.target.checked }); if (e.target.checked) soundService.playSuccess(); }}
          />
        </label>
      </section>

      <section className={card}>
        <h3 className="text-sm font-medium text-slate-300 mb-2">Alertas no Telegram</h3>
        {tg?.configured && tg.chatConfigured ? (
          <>
            <p className="text-sm text-slate-300 mb-3">Ativo: cada sinal novo é enviado automaticamente.</p>
            <button onClick={testTelegram} disabled={tgBusy} className="border border-[#2a2f3a] text-slate-200 px-4 py-2 rounded-lg disabled:opacity-50">
              Enviar mensagem de teste
            </button>
            {tgMsg && <p className="text-sm text-slate-400 mt-2">{tgMsg}</p>}
          </>
        ) : (
          <p className="text-sm text-slate-400 leading-relaxed">
            Desativado. Para receber alertas, defina <code className="text-slate-200">TELEGRAM_BOT_TOKEN</code> e{' '}
            <code className="text-slate-200">TELEGRAM_CHAT_ID</code> no arquivo <code className="text-slate-200">.env</code> do servidor e reinicie.
          </p>
        )}
      </section>

      {(['spot', 'futures'] as MarketType[]).map((m) => {
        const info = scanInfos[m];
        return (
          <section key={m} className={card}>
            <h3 className="text-sm font-medium text-slate-300 mb-2">Scanner · {m === 'futures' ? 'Futuros' : 'Spot'}</h3>
            {info?.lastScanAt && !info.lastError ? (
              <div className="text-sm text-slate-300 space-y-1 leading-relaxed">
                <p>
                  {info.universeCount} {m === 'futures' ? 'perpétuos' : 'moedas'} das 100 maiores, listados em{' '}
                  {(info.exchanges ?? ['binance']).map((e) => (e === 'bybit' ? 'Bybit' : 'Binance')).join(' e ')}.
                </p>
                <p>Última varredura: {new Date(info.lastScanAt).toLocaleString('pt-BR')}.</p>
                {m === 'futures' && info.dataSource && (
                  <p className={info.dataSource === 'binance' ? '' : 'text-amber-300'}>
                    Dados de futuros via {({ binance: 'Binance', bybit: 'Bybit', okx: 'OKX' } as Record<string, string>)[info.dataSource] ?? info.dataSource}
                    {info.dataSource !== 'binance' && ' (a Binance de futuros não respondeu a partir deste servidor; os preços são muito próximos, mas confira na sua corretora antes de operar)'}.
                  </p>
                )}
                {info.unverified && info.unverified.length > 0 && (
                  <p className="text-xs text-slate-500">Não foi possível verificar a lista de moedas em: {info.unverified.map((e) => (e === 'bybit' ? 'Bybit' : 'Binance')).join(', ')}.</p>
                )}
                {info.skipped.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-slate-400">{info.skipped.length} moedas ignoradas</summary>
                    <p className="text-xs text-slate-500 mt-1">{info.skipped.join(', ')}</p>
                  </details>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-400">{info?.lastError ?? 'Scanner indisponível ou ainda na primeira varredura.'}</p>
            )}
          </section>
        );
      })}
    </div>
  );
};

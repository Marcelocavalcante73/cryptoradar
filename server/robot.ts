/**
 * Robô simulado no servidor: a cada 5 minutos lê os sinais do motor de tendência e do motor de IA (spot, LONG), os preços
 * atuais e roda um ciclo de src/services/robot.ts na carteira própria do robô. Estado guardado como o das carteiras.
 * Sem chave de corretora: não envia ordem nenhuma, é só simulação.
 */

import {
  RobotConfig, RobotState, RobotEvent, SourceSignal, DEFAULT_ROBOT_CONFIG,
  newRobotState, robotStep, robotStats, sanitizeConfig
} from '../src/services/robot';
import { getTrendState } from './trendScanner';
import { getAiEngineState } from './aiEngine';
import { binanceGet } from './universe';
import { sendTelegram } from './scanner';
import { getStateSafe, setStateSafe } from './stateStore';

let state: RobotState = newRobotState();
let busy = false;
let lastError: string | null = null;

export async function loadRobot() {
  if (process.env.ROBOT_PERSIST === 'off') return;
  const snap = await getStateSafe('robot-state');
  const v = snap?.value;
  if (v && v.config && Array.isArray(v.positions)) state = v as RobotState;
}

function save() {
  if (process.env.ROBOT_PERSIST === 'off') return;
  void setStateSafe('robot-state', state);
}

export function resetRobotState() { state = newRobotState(); busy = false; lastError = null; }

export function getRobot() {
  return { state, stats: robotStats(state), lastError, running: busy };
}

/** Sinais das duas estratégias, no formato que o robô entende. */
export function collectSignals(): SourceSignal[] {
  const out: SourceSignal[] = [];
  for (const t of getTrendState().signals) {
    const done = t.status === 'STOPPED' || t.status === 'CLOSED';
    out.push({
      id: t.id, source: 'trend', symbol: t.symbol, baseAsset: t.baseAsset,
      state: done ? 'DONE' : t.status === 'EXIT_SIGNAL' ? 'EXIT_NOW' : 'OPEN',
      entryPrice: t.entryPrice, stopPrice: t.stopPrice, createdAt: t.createdAt, exitPrice: t.exitPrice
    });
  }
  for (const a of getAiEngineState('spot').signals) {
    if (a.direction !== 'LONG') continue;
    out.push({
      id: a.id, source: 'ai', symbol: a.symbol, baseAsset: a.baseAsset,
      state: a.status === 'OPEN' ? 'OPEN' : 'DONE',
      entryPrice: a.entryPrice, stopPrice: a.stopLossPrice, targetPrice: a.targetPrice, createdAt: a.createdAt, exitPrice: a.closePrice
    });
  }
  return out;
}

async function fetchPrices(): Promise<Map<string, number>> {
  const raw = (await binanceGet('/api/v3/ticker/price', 6000, 'spot')) as { symbol: string; price: string }[];
  return new Map(raw.map((p) => [p.symbol, parseFloat(p.price)]));
}

const alertText = (e: RobotEvent) => `${e.kind === 'entry' ? '🤖 *[ROBÔ] COMPRA SIMULADA*' : e.kind === 'exit' ? '🔔 *[ROBÔ] SAÍDA SIMULADA*' : '⚠️ *[ROBÔ]*'}\n${e.text}\n\n_Simulação, sem dinheiro real._`;

/** Um ciclo do robô. Roda mesmo desligado, para acompanhar e encerrar posições abertas. */
export async function runRobot(): Promise<{ ok: boolean; message: string }> {
  if (busy) return { ok: true, message: 'Já está rodando.' };
  busy = true;
  try {
    const signals = collectSignals();
    const needPrices = state.positions.length > 0 || (state.config.enabled && signals.some((s) => s.state === 'OPEN'));
    const prices = needPrices ? await fetchPrices() : new Map<string, number>();
    const r = robotStep(state, signals, prices);
    state = r.state;
    lastError = null;
    save();
    for (const e of r.events) if (e.kind !== 'info') await sendTelegram(alertText(e));
    return { ok: true, message: r.events.length ? r.events[r.events.length - 1].text : 'Sem novidades.' };
  } catch (e: any) {
    lastError = e?.message || 'Erro no robô';
    return { ok: false, message: lastError! };
  } finally {
    busy = false;
  }
}

export function updateRobotConfig(input: any) {
  const wasHalted = state.halted;
  state.config = sanitizeConfig(input, state.config);
  if (input?.resume === true && wasHalted) {
    state.halted = null;
    state.peakEquity = getRobot().stats.equity;
    state.events.unshift({ at: Date.now(), kind: 'info', text: 'Robô religado manualmente (o pico de patrimônio foi redefinido).' });
  }
  save();
}

export function resetRobot(startCapital?: unknown) {
  const cap = Number(startCapital);
  const cfg: RobotConfig = { ...state.config, enabled: false, startCapital: Number.isFinite(cap) ? Math.min(1_000_000, Math.max(100, cap)) : state.config.startCapital };
  state = newRobotState(cfg);
  save();
}

/** Ciclo automático a cada 5 minutos. Desligue com ROBOT_AUTO=false. */
export function startRobot(intervalMinutes = 5) {
  if (process.env.ROBOT_AUTO === 'false') return;
  setTimeout(() => { void runRobot(); setInterval(() => { void runRobot(); }, intervalMinutes * 60e3); }, 100000);
}

export { DEFAULT_ROBOT_CONFIG };

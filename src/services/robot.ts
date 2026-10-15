/**
 * Robô simulado (cripto spot, só compras). Opera sozinho numa carteira PRÓPRIA (separada da sua carteira de simulação)
 * seguindo os sinais do motor de tendência e do motor de IA, com limites de risco que ele não pode passar:
 *  - risco por operação (% do patrimônio) define o tamanho: perde só isso se o stop for atingido;
 *  - máximo de posições abertas e de % do patrimônio em uma posição (sem alavancagem);
 *  - perda máxima no dia (pausa as entradas até o dia seguinte, UTC) e queda máxima desde o pico (PARA o robô até você religar);
 *  - não "persegue": se o preço já subiu mais de 1,5% acima da entrada do sinal, ou caiu até o stop, pula.
 * Taxas e derrapagem entram nos dois lados (como nos backtests). As regras de entrada e saída são as dos próprios sinais.
 */

import { DEFAULT_BACKTEST_OPTIONS } from './backtest';
import { readinessFromResults, TrendReadiness } from './trendSignals';

export type RobotSource = 'trend' | 'ai';

export interface RobotConfig {
  enabled: boolean;
  useTrend: boolean;
  useAi: boolean;
  startCapital: number;      // USDT
  riskPct: number;           // % do patrimônio arriscado por operação
  maxOpen: number;
  maxPositionPct: number;    // % do patrimônio em uma posição
  maxDailyLossPct: number;
  maxDrawdownPct: number;
  maxSignalAgeH: number;     // ignora sinais mais velhos que isso
}

export const DEFAULT_ROBOT_CONFIG: RobotConfig = {
  enabled: false, useTrend: true, useAi: true, startCapital: 1000, riskPct: 1, maxOpen: 3,
  maxPositionPct: 30, maxDailyLossPct: 3, maxDrawdownPct: 15, maxSignalAgeH: 24
};

export const ROBOT_LIMITS = {
  startCapital: [100, 1_000_000], riskPct: [0.1, 3], maxOpen: [1, 10], maxPositionPct: [5, 100],
  maxDailyLossPct: [0.5, 20], maxDrawdownPct: [3, 50], maxSignalAgeH: [1, 72]
} as const;

const clampNum = (v: unknown, [lo, hi]: readonly [number, number], fb: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fb;
};

/** Valida e limita a configuração vinda da tela. */
export function sanitizeConfig(input: any, base: RobotConfig): RobotConfig {
  const L = ROBOT_LIMITS;
  return {
    enabled: typeof input?.enabled === 'boolean' ? input.enabled : base.enabled,
    useTrend: typeof input?.useTrend === 'boolean' ? input.useTrend : base.useTrend,
    useAi: typeof input?.useAi === 'boolean' ? input.useAi : base.useAi,
    startCapital: base.startCapital, // só muda no reset
    riskPct: clampNum(input?.riskPct, L.riskPct, base.riskPct),
    maxOpen: Math.round(clampNum(input?.maxOpen, L.maxOpen, base.maxOpen)),
    maxPositionPct: clampNum(input?.maxPositionPct, L.maxPositionPct, base.maxPositionPct),
    maxDailyLossPct: clampNum(input?.maxDailyLossPct, L.maxDailyLossPct, base.maxDailyLossPct),
    maxDrawdownPct: clampNum(input?.maxDrawdownPct, L.maxDrawdownPct, base.maxDrawdownPct),
    maxSignalAgeH: clampNum(input?.maxSignalAgeH, L.maxSignalAgeH, base.maxSignalAgeH)
  };
}

export interface SourceSignal {
  id: string;
  source: RobotSource;
  symbol: string;
  baseAsset: string;
  state: 'OPEN' | 'EXIT_NOW' | 'DONE';   // EXIT_NOW: a estratégia mandou sair na próxima abertura
  entryPrice?: number;                    // preço de entrada do sinal (quando já existe)
  stopPrice: number;
  targetPrice?: number;
  createdAt: number;
  exitPrice?: number;                     // quando DONE
}

export interface RobotPosition {
  id: string;
  source: RobotSource;
  signalId: string;
  symbol: string;
  baseAsset: string;
  qty: number;
  entryPrice: number;       // preço efetivo pago (com taxa e derrapagem)
  stopPrice: number;
  targetPrice?: number;
  openedAt: number;
  lastPrice: number;
  riskUsd: number;
}

export interface RobotTrade {
  id: string; source: RobotSource; symbol: string; baseAsset: string; qty: number;
  entryPrice: number; exitPrice: number; openedAt: number; closedAt: number;
  reason: string; pnl: number; netPct: number;
}

export interface RobotEvent { at: number; kind: 'entry' | 'exit' | 'risk' | 'info'; text: string }

export interface RobotState {
  config: RobotConfig;
  createdAt: number;
  cash: number;
  positions: RobotPosition[];
  trades: RobotTrade[];
  takenSignalIds: string[];
  peakEquity: number;
  dayStart: { day: string; equity: number };
  pausedDay: string | null;                 // dia (UTC) em que a perda máxima foi atingida
  halted: { reason: string; at: number } | null;
  events: RobotEvent[];
  curve: { t: number; equity: number }[];
  lastTickAt: number | null;
}

export const ROBOT_COST = DEFAULT_BACKTEST_OPTIONS.feeRate + DEFAULT_BACKTEST_OPTIONS.slippageRate;
const MIN_NOTIONAL = 10;
const MAX_CHASE = 0.015;
const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);

export function newRobotState(config: RobotConfig = DEFAULT_ROBOT_CONFIG, now = Date.now()): RobotState {
  return {
    config, createdAt: now, cash: config.startCapital, positions: [], trades: [], takenSignalIds: [],
    peakEquity: config.startCapital, dayStart: { day: dayOf(now), equity: config.startCapital }, pausedDay: null,
    halted: null, events: [], curve: [{ t: now, equity: config.startCapital }], lastTickAt: null
  };
}

export const robotEquity = (s: RobotState) => s.cash + s.positions.reduce((a, p) => a + p.qty * p.lastPrice, 0);

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 2 : 6 });

/**
 * Um ciclo do robô: atualiza preços, executa saídas, confere os limites de risco e, se permitido, abre novas posições.
 * `bars` (velas de 1h dos ativos em carteira) cobre o tempo em que o servidor ficou parado: se o stop ou o alvo foram tocados
 * nesse intervalo, a saída é aplicada pelo preço do stop/alvo, na hora da vela, e não pelo preço de agora.
 * Devolve um novo estado (o recebido não é alterado) e os eventos criados neste ciclo.
 */
export interface HourBar { timestamp: number; high: number; low: number; close: number }

export function robotStep(prev: RobotState, signals: SourceSignal[], prices: Map<string, number>, now: number = Date.now(), bars: Map<string, HourBar[]> = new Map()): { state: RobotState; events: RobotEvent[] } {
  const s: RobotState = JSON.parse(JSON.stringify(prev));
  const cfg = s.config;
  const events: RobotEvent[] = [];
  const log = (kind: RobotEvent['kind'], text: string) => events.push({ at: now, kind, text });

  // 1) dia novo
  const today = dayOf(now);
  if (s.dayStart.day !== today) s.dayStart = { day: today, equity: robotEquity(s) };

  // 2) preços
  for (const p of s.positions) { const px = prices.get(p.symbol); if (px && px > 0) p.lastPrice = px; }

  // 3) saídas (sempre, mesmo com o robô desligado ou parado)
  const bySignal = new Map(signals.map((x) => [x.id, x]));
  const keep: RobotPosition[] = [];
  for (const p of s.positions) {
    const sig = bySignal.get(p.signalId);
    let exit: { price: number; reason: string; at?: number } | null = null;
    for (const b of bars.get(p.symbol) ?? []) {
      if (b.timestamp < p.openedAt) continue; // a vela em que a posição abriu mistura preços de antes dela
      if (b.low <= p.stopPrice) { exit = { price: p.stopPrice, reason: 'stop atingido', at: b.timestamp + 3600e3 }; break; }
      if (p.targetPrice && b.high >= p.targetPrice) { exit = { price: p.targetPrice, reason: 'alvo atingido', at: b.timestamp + 3600e3 }; break; }
    }
    if (exit) { /* saída pelas velas */ }
    else if (sig?.state === 'DONE' && sig.exitPrice) exit = { price: sig.exitPrice, reason: 'a estratégia encerrou o sinal' };
    else if (sig?.state === 'EXIT_NOW') exit = { price: p.lastPrice, reason: 'a estratégia mandou sair' };
    else if (p.lastPrice <= p.stopPrice) exit = { price: Math.min(p.stopPrice, p.lastPrice), reason: 'stop atingido' };
    else if (p.targetPrice && p.lastPrice >= p.targetPrice) exit = { price: p.targetPrice, reason: 'alvo atingido' };
    if (!exit) { keep.push(p); continue; }
    const exitEff = exit.price * (1 - ROBOT_COST);
    const pnl = p.qty * (exitEff - p.entryPrice);
    s.cash += p.qty * exitEff;
    s.trades.unshift({
      id: p.id, source: p.source, symbol: p.symbol, baseAsset: p.baseAsset, qty: p.qty, entryPrice: p.entryPrice,
      exitPrice: exitEff, openedAt: p.openedAt, closedAt: Math.min(now, exit.at ?? now), reason: exit.reason, pnl, netPct: (exitEff / p.entryPrice - 1) * 100
    });
    log('exit', `Saiu de ${p.baseAsset} a ${fmt(exit.price)}: ${exit.reason} (${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT).`);
  }
  s.positions = keep;
  s.trades = s.trades.slice(0, 300);

  // 4) limites de risco
  const equity = robotEquity(s);
  s.peakEquity = Math.max(s.peakEquity, equity);
  const dd = ((s.peakEquity - equity) / s.peakEquity) * 100;
  if (!s.halted && dd >= cfg.maxDrawdownPct) {
    s.halted = { reason: `queda de ${dd.toFixed(1)}% desde o pico (limite ${cfg.maxDrawdownPct}%)`, at: now };
    log('risk', `Robô PARADO: ${s.halted.reason}. Reveja a estratégia antes de religar.`);
  }
  const dayLoss = ((s.dayStart.equity - equity) / s.dayStart.equity) * 100;
  if (s.pausedDay !== today && dayLoss >= cfg.maxDailyLossPct) {
    s.pausedDay = today;
    log('risk', `Perda de ${dayLoss.toFixed(1)}% no dia (limite ${cfg.maxDailyLossPct}%): sem novas entradas até amanhã.`);
  }

  // 5) entradas
  const canEnter = cfg.enabled && !s.halted && s.pausedDay !== today;
  if (canEnter) {
    const fresh = signals
      .filter((x) => x.state === 'OPEN' && x.entryPrice && (x.source === 'trend' ? cfg.useTrend : cfg.useAi))
      .filter((x) => !s.takenSignalIds.includes(x.id) && now - x.createdAt <= cfg.maxSignalAgeH * 3600e3)
      .sort((a, b) => b.createdAt - a.createdAt);
    for (const x of fresh) {
      if (s.positions.length >= cfg.maxOpen) break;
      if (s.positions.some((p) => p.symbol === x.symbol)) continue;
      const px = prices.get(x.symbol);
      if (!px || px <= 0) continue;
      s.takenSignalIds.push(x.id); // decidido (entrou ou foi descartado): não reavalia
      if (px > x.entryPrice! * (1 + MAX_CHASE)) { log('info', `Pulou ${x.baseAsset}: o preço já subiu mais de 1,5% acima da entrada do sinal.`); continue; }
      if (px <= x.stopPrice) { log('info', `Pulou ${x.baseAsset}: o preço já está no stop.`); continue; }
      const entryEff = px * (1 + ROBOT_COST);
      const riskPerUnit = entryEff - x.stopPrice;
      if (riskPerUnit <= 0) continue;
      const eq = robotEquity(s);
      const qty = Math.min((eq * cfg.riskPct / 100) / riskPerUnit, (eq * cfg.maxPositionPct / 100) / entryEff, s.cash / entryEff);
      if (!(qty * entryEff >= MIN_NOTIONAL)) { log('info', `Pulou ${x.baseAsset}: posição abaixo de ${MIN_NOTIONAL} USDT.`); continue; }
      s.cash -= qty * entryEff;
      s.positions.push({
        id: `${x.id}-bot`, source: x.source, signalId: x.id, symbol: x.symbol, baseAsset: x.baseAsset, qty, entryPrice: entryEff,
        stopPrice: x.stopPrice, targetPrice: x.targetPrice, openedAt: now, lastPrice: px, riskUsd: qty * riskPerUnit
      });
      log('entry', `Comprou ${x.baseAsset} a ${fmt(px)} (${x.source === 'ai' ? 'IA' : 'tendência'}): ${(qty * entryEff).toFixed(2)} USDT, arrisca ${(qty * riskPerUnit).toFixed(2)} USDT, stop ${fmt(x.stopPrice)}.`);
    }
    s.takenSignalIds = s.takenSignalIds.slice(-500);
  }

  // 6) curva de patrimônio (no máximo 1 ponto por hora) e registro
  const eqNow = robotEquity(s);
  const last = s.curve[s.curve.length - 1];
  if (!last || now - last.t >= 3600e3 || events.length) s.curve.push({ t: now, equity: eqNow });
  s.curve = s.curve.slice(-600);
  s.events = [...events.slice().reverse(), ...s.events].slice(0, 80);
  s.lastTickAt = now;
  return { state: s, events };
}

export interface RobotStats {
  equity: number; pnl: number; pnlPct: number; drawdownPct: number;
  open: number; closed: number; wins: number; winRate: number; profitFactor: number | null; avgNetPct: number;
  readiness: TrendReadiness;
}

export function robotStats(s: RobotState, now = Date.now()): RobotStats {
  const equity = robotEquity(s);
  const nets = s.trades.map((t) => t.netPct);
  const gains = nets.filter((x) => x > 0).reduce((a, x) => a + x, 0);
  const losses = Math.abs(nets.filter((x) => x <= 0).reduce((a, x) => a + x, 0));
  return {
    equity, pnl: equity - s.config.startCapital, pnlPct: (equity / s.config.startCapital - 1) * 100,
    drawdownPct: ((s.peakEquity - equity) / s.peakEquity) * 100,
    open: s.positions.length, closed: s.trades.length, wins: nets.filter((x) => x > 0).length,
    winRate: nets.length ? (nets.filter((x) => x > 0).length / nets.length) * 100 : 0,
    profitFactor: losses > 0 ? gains / losses : gains > 0 ? null : 0,
    avgNetPct: nets.length ? nets.reduce((a, x) => a + x, 0) / nets.length : 0,
    readiness: readinessFromResults(nets, (now - s.createdAt) / 86400000)
  };
}

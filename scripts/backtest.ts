/**
 * Uso: npm run backtest -- [--tf 1h] [--top 30] [--bars 2000] [--symbols BTCUSDT,ETHUSDT] [--min-score 60] [--both]
 * Roda o motor de sinais sobre o histórico real da Binance e imprime o resultado por moeda e agregado.
 */
import { buildUniverse } from '../server/universe';
import { fetchHistory } from '../server/history';
import { runBacktest, computeStats, BacktestTrade } from '../src/services/backtest';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const tf = arg('tf', '1h');
const top = Number(arg('top', '30'));
const bars = Number(arg('bars', '2000'));
const minScore = Number(arg('min-score', '0')) || undefined;
const symbolsArg = arg('symbols', '');
// Spot é o padrão: só compras. Use --both para incluir vendas a descoberto (futuros).
const longOnly = !process.argv.includes('--both') && process.env.MARKET_MODE !== 'futures';

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

async function main() {
  let targets: { symbol: string; base: string }[];
  if (symbolsArg) {
    targets = symbolsArg.split(',').map((s) => ({ symbol: s.trim().toUpperCase(), base: s.trim().toUpperCase().replace(/USDT$/, '') }));
  } else {
    const u = await buildUniverse();
    targets = u.coins.slice(0, top).map((c) => ({ symbol: c.symbol, base: c.baseAsset }));
  }

  console.log(`Backtest ${longOnly ? '(spot: só compras)' : '(compras e vendas)'} | timeframe ${tf} | ${targets.length} moedas | até ${bars} candles | taxa 0,1% + derrapagem 0,05% por lado\n`);
  console.log('Moeda        Op.  Acerto   Média/op   R médio  Fator lucro  Máx.DD');

  const all: BacktestTrade[] = [];
  for (const t of targets) {
    try {
      const candles = await fetchHistory(t.symbol, tf, bars);
      const r = runBacktest(candles, t.symbol, t.base, tf, { minScore, longOnly });
      all.push(...r.trades);
      const s = r.stats;
      console.log(
        `${t.symbol.padEnd(12)} ${String(s.trades).padStart(3)}  ${s.winRate.toFixed(0).padStart(5)}%  ${pct(s.avgNetPct).padStart(9)}  ${s.avgR.toFixed(2).padStart(7)}  ${(s.profitFactor === null ? '∞' : s.profitFactor.toFixed(2)).padStart(11)}  ${s.maxDrawdownPct.toFixed(1).padStart(5)}%`
      );
    } catch (e: any) {
      console.log(`${t.symbol.padEnd(12)} falhou: ${e?.message ?? e}`);
    }
  }

  const s = computeStats(all);
  console.log('\n=== AGREGADO ===');
  console.log(`Operações: ${s.trades} (compras ${s.longTrades}, vendas ${s.shortTrades})`);
  console.log(`Taxa de acerto: ${s.winRate.toFixed(1)}%  |  Fator de lucro: ${s.profitFactor === null ? '∞' : s.profitFactor.toFixed(2)}`);
  console.log(`Expectativa por operação: ${pct(s.avgNetPct)}  |  R médio: ${s.avgR.toFixed(2)}`);
  console.log(`Saídas: alvo ${s.targetExits}, stop ${s.stopExits}, tempo ${s.timeoutExits}`);
  console.log(`Soma dos retornos: ${pct(s.totalNetPct)}  |  Drawdown máx. (curva agregada): ${s.maxDrawdownPct.toFixed(1)}%`);
  console.log('\nAviso: resultado passado não garante resultado futuro. Poucas operações = estatística pouco confiável.');
}

main().catch((e) => { console.error('Erro:', e?.message ?? e); process.exit(1); });

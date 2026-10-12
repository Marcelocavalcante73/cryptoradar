import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart, CandlestickSeries, LineSeries, HistogramSeries, ColorType, CrosshairMode, LineStyle,
  IChartApi, ISeriesApi, UTCTimestamp
} from 'lightweight-charts';
import { Maximize2, Minimize2, Plus, Minus, RotateCcw } from 'lucide-react';
import { CandleData } from '../../types/crypto';
import { fmtPrice } from '../common/format';

export interface ChartLevel {
  price: number;
  color: string;
  title: string;
}

interface TvChartProps {
  candles: CandleData[];            // já com ema20/ema50
  levels?: ChartLevel[];            // entrada, stop e alvo do sinal
  tvSymbol?: string;                // ex: BINANCE:SOLUSDT, para o atalho "Abrir no TradingView"
  height?: number;
}

const COLORS = { up: '#26a69a', down: '#ef5350', grid: '#1c2029', text: '#8b93a3', bg: '#0f1115' };
const INITIAL_VISIBLE = 70;

// O eixo do gráfico é UTC; desloca para o fuso do aparelho para mostrar o horário local
const toChartTime = (ms: number) => (Math.floor(ms / 1000) - new Date().getTimezoneOffset() * 60) as UTCTimestamp;

export const TvChart: React.FC<TvChartProps> = ({ candles, levels = [], tvSymbol, height = 340 }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const ema20Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const ema50Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const bbRefs = useRef<ISeriesApi<'Line'>[]>([]);
  const priceLinesRef = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>[]>([]);
  const [fullscreen, setFullscreen] = useState(false);
  const [hover, setHover] = useState<CandleData | null>(null);
  const [show, setShow] = useState({ ema: true, bb: false, vol: true });
  const byTime = useRef(new Map<number, CandleData>());

  // Criação do gráfico (uma vez)
  useEffect(() => {
    if (!hostRef.current) return;
    const chart = createChart(hostRef.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: COLORS.bg }, textColor: COLORS.text, fontSize: 12, attributionLogo: true },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: COLORS.grid, scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: { borderColor: COLORS.grid, timeVisible: true, secondsVisible: false, rightOffset: 4 },
      // Toque: arrastar na horizontal move o gráfico, pinça dá zoom; arrastar na vertical rola a página
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
      kineticScroll: { touch: true, mouse: false }
    });

    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.up, downColor: COLORS.down, borderVisible: false, wickUpColor: COLORS.up, wickDownColor: COLORS.down,
      priceFormat: { type: 'custom', formatter: (p: number) => fmtPrice(p), minMove: 0.00000001 }
    });
    ema20Ref.current = chart.addSeries(LineSeries, { color: '#2962ff', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    ema50Ref.current = chart.addSeries(LineSeries, { color: '#ff9800', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    bbRefs.current = ['#9c27b0', '#7e57c2', '#9c27b0'].map((color, i) =>
      chart.addSeries(LineSeries, { color, lineWidth: 1, lineStyle: i === 1 ? LineStyle.Dotted : LineStyle.Solid, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, visible: false })
    );
    volRef.current = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) return setHover(null);
      setHover(byTime.current.get(param.time as number) ?? null);
    });

    chartRef.current = chart;
    return () => { chart.remove(); chartRef.current = null; };
  }, []);

  // Dados
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !candleRef.current) return;
    byTime.current = new Map(candles.map((c) => [toChartTime(c.timestamp) as number, c]));
    candleRef.current.setData(candles.map((c) => ({ time: toChartTime(c.timestamp), open: c.open, high: c.high, low: c.low, close: c.close })));
    ema20Ref.current?.setData(candles.filter((c) => c.ema20 !== undefined).map((c) => ({ time: toChartTime(c.timestamp), value: c.ema20! })));
    ema50Ref.current?.setData(candles.filter((c) => c.ema50 !== undefined).map((c) => ({ time: toChartTime(c.timestamp), value: c.ema50! })));
    (['upper', 'middle', 'lower'] as const).forEach((k, i) =>
      bbRefs.current[i]?.setData(candles.filter((c) => c.bollinger).map((c) => ({ time: toChartTime(c.timestamp), value: c.bollinger![k] })))
    );
    volRef.current?.setData(candles.map((c) => ({
      time: toChartTime(c.timestamp), value: c.volume, color: c.close >= c.open ? 'rgba(38,166,154,0.35)' : 'rgba(239,83,80,0.35)'
    })));
    const n = candles.length;
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - INITIAL_VISIBLE), to: n + 4 });
  }, [candles]);

  // Linhas de entrada / stop / alvo
  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;
    priceLinesRef.current.forEach((l) => series.removePriceLine(l));
    priceLinesRef.current = levels.map((l) =>
      series.createPriceLine({ price: l.price, color: l.color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: l.title })
    );
  }, [levels.map((l) => `${l.title}:${l.price}`).join('|'), candles.length]);

  // Liga/desliga indicadores
  useEffect(() => {
    ema20Ref.current?.applyOptions({ visible: show.ema });
    ema50Ref.current?.applyOptions({ visible: show.ema });
    bbRefs.current.forEach((l) => l.applyOptions({ visible: show.bb }));
    volRef.current?.applyOptions({ visible: show.vol });
  }, [show]);

  const zoom = useCallback((factor: number) => {
    const ts = chartRef.current?.timeScale();
    const r = ts?.getVisibleLogicalRange();
    if (!ts || !r) return;
    const right = r.to, span = (r.to - r.from) * factor;
    ts.setVisibleLogicalRange({ from: right - span, to: right });
  }, []);

  const reset = useCallback(() => {
    const n = candles.length;
    chartRef.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - INITIAL_VISIBLE), to: n + 4 });
    chartRef.current?.priceScale('right').applyOptions({ autoScale: true });
  }, [candles.length]);

  // Fecha o modo tela cheia com Esc e trava a rolagem da página enquanto aberto
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFullscreen(false);
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [fullscreen]);

  const shown = hover ?? candles[candles.length - 1];
  const btn = 'w-10 h-10 flex items-center justify-center rounded-lg bg-[#161920] border border-[#23272f] text-slate-300 active:bg-[#2a2f3a]';

  return (
    <div className={fullscreen ? 'fixed inset-0 z-50 bg-[#0f1115] flex flex-col p-3' : ''}>
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="text-xs text-slate-400 tabular-nums min-h-[32px]">
          {shown && (
            <>
              <div className="flex flex-wrap gap-x-3">
                <span className="whitespace-nowrap">A {fmtPrice(shown.open)}</span>
                <span className="whitespace-nowrap">M {fmtPrice(shown.high)}</span>
                <span className="whitespace-nowrap">m {fmtPrice(shown.low)}</span>
                <span className={`whitespace-nowrap ${shown.close >= shown.open ? 'text-emerald-400' : 'text-rose-400'}`}>F {fmtPrice(shown.close)}</span>
              </div>
            </>
          )}
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button className={btn} onClick={() => zoom(0.6)} aria-label="Aproximar"><Plus className="w-4 h-4" /></button>
          <button className={btn} onClick={() => zoom(1.6)} aria-label="Afastar"><Minus className="w-4 h-4" /></button>
          <button className={btn} onClick={reset} aria-label="Reiniciar zoom"><RotateCcw className="w-4 h-4" /></button>
          <button className={btn} onClick={() => setFullscreen((v) => !v)} aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}>
            {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-2">
        {([['ema', 'Médias'], ['bb', 'Bollinger'], ['vol', 'Volume']] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))}
            className={`px-3 py-1.5 text-xs rounded-lg border whitespace-nowrap ${show[k] ? 'bg-[#2a2f3a] border-[#3a4150] text-slate-100' : 'border-[#23272f] text-slate-400'}`}
          >
            {label}
          </button>
        ))}
        <a
          href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol || '')}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`ml-auto px-3 py-1.5 text-xs rounded-lg border border-[#23272f] text-slate-300 whitespace-nowrap ${tvSymbol ? '' : 'hidden'}`}
        >
          TradingView ↗
        </a>
      </div>

      <div
        ref={hostRef}
        className={`rounded-xl overflow-hidden border border-[#23272f] ${fullscreen ? 'flex-1' : ''}`}
        style={fullscreen ? undefined : { height }}
      />
      <p className="text-[11px] text-slate-500 mt-2">Pinça para zoom · arraste para mover · duplo toque no eixo reinicia a escala.</p>
    </div>
  );
};

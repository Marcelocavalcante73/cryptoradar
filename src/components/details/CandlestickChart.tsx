import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  BarChart2,
  TrendingUp,
  Activity,
  ChevronRight,
  Layers,
  RotateCw,
  Smartphone,
  X,
  Crosshair,
  Minus,
  Spline,
  Ruler,
  Trash2,
  Move,
  MousePointer,
  Compass,
  ArrowUpRight,
  Eye,
  EyeOff
} from 'lucide-react';
import { CandleData, Timeframe } from '../../types/crypto';
import { fmtPrice } from '../common/format';

export type ChartDrawingTool = 'cursor' | 'crosshair' | 'h-line' | 'trendline' | 'fibonacci' | 'measure';

export interface ChartDrawing {
  id: string;
  type: 'h-line' | 'trendline' | 'fibonacci' | 'measure';
  color: string;
  // Para h-line: price
  price?: number;
  // Para trendline e measure: ponto inicial e final em coordenadas lógicas
  candleIndexStart?: number;
  priceStart?: number;
  candleIndexEnd?: number;
  priceEnd?: number;
}

export interface CandlestickChartProps {
  candles: CandleData[];
  assetSymbol?: string;
  assetName?: string;
  currentPrice?: number;
  priceChange24h?: number;
  timeframe?: Timeframe;
  onChangeTimeframe?: (tf: Timeframe) => void;
  onOpenTradeModal?: () => void;
  chartType?: 'candle' | 'line';
  showEma20?: boolean;
  showEma50?: boolean;
  showBollinger?: boolean;
  showVolume?: boolean;
  showRsi?: boolean;
  showMacd?: boolean;
  height?: number;
  isExpandable?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: (expanded: boolean) => void;
  isRotated?: boolean;
  onToggleRotate?: (rotated: boolean) => void;
  initialRotated?: boolean;
}

const AVAILABLE_TIMEFRAMES: Timeframe[] = ['15m', '1h', '4h', '1D', '1W'];

export const CandlestickChart: React.FC<CandlestickChartProps> = ({
  candles,
  assetSymbol,
  assetName,
  currentPrice,
  priceChange24h,
  timeframe = '4h',
  onChangeTimeframe,
  onOpenTradeModal,
  chartType: propChartType = 'candle',
  showEma20: propShowEma20 = true,
  showEma50: propShowEma50 = true,
  showBollinger: propShowBollinger = false,
  showVolume: propShowVolume = true,
  showRsi: propShowRsi = false,
  showMacd: propShowMacd = false,
  height = 360,
  isExpandable = true,
  isExpanded: propIsExpanded,
  onToggleExpand,
  isRotated: propIsRotated,
  onToggleRotate,
  initialRotated = false
}) => {
  // Estado de expansão (modo TradingView tela cheia) e rotação horizontal (modo paisagem 90°)
  const [internalExpanded, setInternalExpanded] = useState(false);
  const [internalRotated, setInternalRotated] = useState(initialRotated);

  const isExpanded = propIsExpanded !== undefined ? propIsExpanded : internalExpanded;
  const isRotated = propIsRotated !== undefined ? propIsRotated : internalRotated;

  const setIsExpanded = (val: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof val === 'function' ? val(isExpanded) : val;
    setInternalExpanded(next);
    onToggleExpand?.(next);
  };

  const setIsRotated = (val: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof val === 'function' ? val(isRotated) : val;
    setInternalRotated(next);
    onToggleRotate?.(next);
  };

  // Monitora dimensões da tela para dimensionamento responsivo perfeito em modo rotacionado
  const [windowDimensions, setWindowDimensions] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 800,
    height: typeof window !== 'undefined' ? window.innerHeight : 600
  });

  useEffect(() => {
    const onResize = () => {
      setWindowDimensions({
        width: window.innerWidth,
        height: window.innerHeight
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Controles de indicadores (iniciam com os valores das props)
  const [chartType, setChartType] = useState<'candle' | 'line'>(propChartType);
  const [showEma20, setShowEma20] = useState(propShowEma20);
  const [showEma50, setShowEma50] = useState(propShowEma50);
  const [showBollinger, setShowBollinger] = useState(propShowBollinger);
  const [showVolume, setShowVolume] = useState(propShowVolume);
  const [showRsi, setShowRsi] = useState(propShowRsi);
  const [showMacd, setShowMacd] = useState(propShowMacd);

  // Controles de zoom e pan
  const defaultVisible = Math.min(candles.length || 45, 45);
  const [visibleCount, setVisibleCount] = useState(defaultVisible);
  const [panOffset, setPanOffset] = useState(0); // 0 = mais recente, > 0 = histórico mais antigo

  // Ferramentas de Desenho e Análise Técnica (Estilo TradingView)
  const [activeTool, setActiveTool] = useState<ChartDrawingTool>('cursor');
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  const [pendingDrawingStart, setPendingDrawingStart] = useState<{ candleIndex: number; price: number; x: number; y: number } | null>(null);
  const [scaleMode, setScaleMode] = useState<'auto' | 'log'>('auto');
  const [showDrawings, setShowDrawings] = useState(true);

  // Crosshair e inspeção de vela
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [crosshairPos, setCrosshairPos] = useState<{ x: number; y: number; price: number } | null>(null);

  // Arraste para navegar
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartPanRef = useRef(0);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Ajusta contagem visível se o total de velas mudar
  useEffect(() => {
    if (candles.length > 0) {
      setVisibleCount((prev) => Math.min(candles.length, Math.max(15, prev)));
    }
  }, [candles.length]);

  // Trava scroll da página ao expandir em tela cheia e captura tecla Escape
  useEffect(() => {
    if (!isExpanded) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsExpanded(false);
      } else if (e.key === '+' || e.key === '=') {
        handleZoomIn();
      } else if (e.key === '-' || e.key === '_') {
        handleZoomOut();
      } else if (e.key === 'ArrowLeft') {
        handlePan(5);
      } else if (e.key === 'ArrowRight') {
        handlePan(-5);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isExpanded, candles.length]);

  // Recorte das velas visíveis de acordo com zoom e pan
  const { visibleCandles, startIndex, endIndex } = useMemo(() => {
    if (!candles.length) return { visibleCandles: [], startIndex: 0, endIndex: 0 };
    const maxOffset = Math.max(0, candles.length - visibleCount);
    const clampedOffset = Math.min(maxOffset, Math.max(0, panOffset));

    const end = candles.length - clampedOffset;
    const start = Math.max(0, end - visibleCount);

    return {
      visibleCandles: candles.slice(start, end),
      startIndex: start,
      endIndex: end
    };
  }, [candles, visibleCount, panOffset]);

  // Dimensões do SVG calculadas dinamicamente
  const width = useMemo(() => {
    if (isExpanded) {
      return isRotated
        ? Math.max(720, windowDimensions.height)
        : Math.max(720, windowDimensions.width);
    }
    return 720;
  }, [isExpanded, isRotated, windowDimensions]);

  const chartHeight = useMemo(() => {
    if (isExpanded) {
      const availH = isRotated ? windowDimensions.width : windowDimensions.height;
      return Math.max(260, availH - 128);
    }
    return height;
  }, [isExpanded, isRotated, windowDimensions, height]);

  const subPanelHeight = isExpanded ? 76 : 58;
  const activeSubPanelsCount = (showRsi ? 1 : 0) + (showMacd ? 1 : 0);
  const mainHeight = chartHeight - activeSubPanelsCount * subPanelHeight;
  const volumeHeight = showVolume ? mainHeight * 0.22 : 0;

  // Escala dinâmica calculada estritamente sobre as velas visíveis (TradingView auto-scale)
  const { minPrice, maxPrice, priceRange, maxVol, decimals } = useMemo(() => {
    if (!visibleCandles.length) {
      return { minPrice: 0, maxPrice: 1, priceRange: 1, maxVol: 1, decimals: 2 };
    }
    let min = Infinity;
    let max = -Infinity;
    let mv = 0;

    visibleCandles.forEach((c) => {
      if (c.low < min) min = c.low;
      if (c.high > max) max = c.high;
      if (showEma20 && c.ema20 !== undefined) {
        if (c.ema20 < min) min = c.ema20;
        if (c.ema20 > max) max = c.ema20;
      }
      if (showEma50 && c.ema50 !== undefined) {
        if (c.ema50 < min) min = c.ema50;
        if (c.ema50 > max) max = c.ema50;
      }
      if (showBollinger && c.bollinger) {
        if (c.bollinger.lower < min) min = c.bollinger.lower;
        if (c.bollinger.upper > max) max = c.bollinger.upper;
      }
      if (c.volume > mv) mv = c.volume;
    });

    const pad = (max - min) * 0.07 || 1;
    const lo = Math.max(0, min - pad);
    const hi = max + pad;
    const dec = hi < 1 ? 4 : hi < 10 ? 3 : 2;

    return {
      minPrice: lo,
      maxPrice: hi,
      priceRange: hi - lo || 1,
      maxVol: mv || 1,
      decimals: dec
    };
  }, [visibleCandles, showEma20, showEma50, showBollinger]);

  const leftMargin = 12;
  const rightMargin = 68; // espaço para escala de preços Y
  const plotWidth = width - leftMargin - rightMargin;
  const candleCount = visibleCandles.length || 1;
  const candleSlotWidth = plotWidth / candleCount;
  const candleWidth = Math.max(2, candleSlotWidth * 0.72);
  const candleGap = candleSlotWidth - candleWidth;

  const getY = useCallback((price: number) => {
    return mainHeight - ((price - minPrice) / priceRange) * mainHeight;
  }, [mainHeight, minPrice, priceRange]);

  const getPriceFromY = useCallback((y: number) => {
    const clampedY = Math.max(0, Math.min(mainHeight, y));
    const ratio = (mainHeight - clampedY) / mainHeight;
    return minPrice + ratio * priceRange;
  }, [mainHeight, minPrice, priceRange]);

  // Linhas das EMAs e Bandas de Bollinger
  const ema20Points = useMemo(() => {
    if (!showEma20) return '';
    return visibleCandles
      .map((c, i) => {
        if (c.ema20 === undefined) return null;
        const x = leftMargin + i * candleSlotWidth + candleSlotWidth / 2;
        const y = getY(c.ema20);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .filter(Boolean)
      .join(' ');
  }, [visibleCandles, showEma20, candleSlotWidth, getY]);

  const ema50Points = useMemo(() => {
    if (!showEma50) return '';
    return visibleCandles
      .map((c, i) => {
        if (c.ema50 === undefined) return null;
        const x = leftMargin + i * candleSlotWidth + candleSlotWidth / 2;
        const y = getY(c.ema50);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .filter(Boolean)
      .join(' ');
  }, [visibleCandles, showEma50, candleSlotWidth, getY]);

  const { bbUpperPoints, bbMiddlePoints, bbLowerPoints, bbAreaPoints } = useMemo(() => {
    if (!showBollinger) return { bbUpperPoints: '', bbMiddlePoints: '', bbLowerPoints: '', bbAreaPoints: '' };
    const uppers: { x: number; y: number }[] = [];
    const lowers: { x: number; y: number }[] = [];
    const middles: { x: number; y: number }[] = [];

    visibleCandles.forEach((c, i) => {
      if (!c.bollinger) return;
      const x = leftMargin + i * candleSlotWidth + candleSlotWidth / 2;
      uppers.push({ x, y: getY(c.bollinger.upper) });
      middles.push({ x, y: getY(c.bollinger.middle) });
      lowers.push({ x, y: getY(c.bollinger.lower) });
    });

    const upStr = uppers.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const midStr = middles.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const lowStr = lowers.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

    let areaStr = '';
    if (uppers.length > 0 && lowers.length > 0) {
      const reversedLowers = [...lowers].reverse();
      areaStr = `${upStr} ${reversedLowers.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}`;
    }

    return { bbUpperPoints: upStr, bbMiddlePoints: midStr, bbLowerPoints: lowStr, bbAreaPoints: areaStr };
  }, [visibleCandles, showBollinger, candleSlotWidth, getY]);

  // Linha contínua caso modo seja 'line'
  const linePoints = useMemo(() => {
    if (chartType !== 'line') return '';
    return visibleCandles
      .map((c, i) => {
        const x = leftMargin + i * candleSlotWidth + candleSlotWidth / 2;
        const y = getY(c.close);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [visibleCandles, chartType, candleSlotWidth, getY]);

  // Escala normalizada do MACD
  const { maxMacdAbs, macdLinePoints, macdSignalPoints } = useMemo(() => {
    if (!showMacd || !visibleCandles.length) {
      return { maxMacdAbs: 1, macdLinePoints: '', macdSignalPoints: '' };
    }
    let maxAbs = 0.0001;
    visibleCandles.forEach((c) => {
      if (c.macd) {
        maxAbs = Math.max(maxAbs, Math.abs(c.macd.macd), Math.abs(c.macd.signal), Math.abs(c.macd.histogram));
      }
    });

    const midY = subPanelHeight / 2;
    const linePts = visibleCandles
      .map((c, i) => {
        if (!c.macd) return null;
        const x = leftMargin + i * candleSlotWidth + candleSlotWidth / 2;
        const y = midY - (c.macd.macd / maxAbs) * (midY * 0.78);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .filter(Boolean)
      .join(' ');

    const sigPts = visibleCandles
      .map((c, i) => {
        if (!c.macd) return null;
        const x = leftMargin + i * candleSlotWidth + candleSlotWidth / 2;
        const y = midY - (c.macd.signal / maxAbs) * (midY * 0.78);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .filter(Boolean)
      .join(' ');

    return { maxMacdAbs: maxAbs, macdLinePoints: linePts, macdSignalPoints: sigPts };
  }, [visibleCandles, showMacd, candleSlotWidth, subPanelHeight]);

  // Vela ativa na inspeção
  const activeCandle =
    hoverIndex !== null && visibleCandles[hoverIndex]
      ? visibleCandles[hoverIndex]
      : visibleCandles[visibleCandles.length - 1];

  const lastCandle = candles[candles.length - 1];
  const livePrice = currentPrice || (lastCandle ? lastCandle.close : 0);
  const liveY = getY(livePrice);
  const isLiveUp = lastCandle ? lastCandle.close >= lastCandle.open : true;

  // Tratamento de Navegação (Zoom e Pan)
  const handleZoomIn = () => {
    setVisibleCount((prev) => Math.max(15, prev - 8));
  };

  const handleZoomOut = () => {
    setVisibleCount((prev) => Math.min(candles.length || 100, prev + 8));
  };

  const handleResetZoom = () => {
    setVisibleCount(Math.min(candles.length || 45, 45));
    setPanOffset(0);
    setHoverIndex(null);
    setCrosshairPos(null);
  };

  const handlePan = (deltaCandles: number) => {
    const maxOffset = Math.max(0, candles.length - visibleCount);
    setPanOffset((prev) => Math.max(0, Math.min(maxOffset, prev + deltaCandles)));
  };

  // Converte coordenadas da tela para o espaço vetorial interno do SVG (suporta rotação de 90° e qualquer escala)
  const getSvgPoint = useCallback(
    (clientX: number, clientY: number, svg: SVGSVGElement): { x: number; y: number } => {
      try {
        const ctm = svg.getScreenCTM();
        if (ctm) {
          const pt = svg.createSVGPoint();
          pt.x = clientX;
          pt.y = clientY;
          const local = pt.matrixTransform(ctm.inverse());
          return { x: local.x, y: local.y };
        }
      } catch {
        // Fallback matemático se getScreenCTM não estiver disponível
      }
      const rect = svg.getBoundingClientRect();
      const totalH = mainHeight + activeSubPanelsCount * subPanelHeight;
      if (isExpanded && isRotated) {
        const relX = clientX - rect.left;
        const relY = clientY - rect.top;
        return {
          x: (relY / Math.max(1, rect.height)) * width,
          y: (1 - relX / Math.max(1, rect.width)) * totalH
        };
      }
      return {
        x: ((clientX - rect.left) / Math.max(1, rect.width)) * width,
        y: ((clientY - rect.top) / Math.max(1, rect.height)) * totalH
      };
    },
    [width, mainHeight, activeSubPanelsCount, subPanelHeight, isExpanded, isRotated]
  );

  // Eventos de Ponteiro (Mouse & Touch) para Crosshair, Desenhos e Arraste
  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.setPointerCapture?.(e.pointerId);

    const pt = getSvgPoint(e.clientX, e.clientY, svg);
    const svgX = pt.x;
    const svgY = pt.y;

    // Se estiver usando ferramenta de Linha Horizontal
    if (activeTool === 'h-line') {
      const priceAtCursor = getPriceFromY(svgY);
      const newDrawing: ChartDrawing = {
        id: `h-line-${Date.now()}`,
        type: 'h-line',
        color: '#3B82F6',
        price: priceAtCursor
      };
      setDrawings((prev) => [...prev, newDrawing]);
      setActiveTool('crosshair');
      return;
    }

    // Se estiver usando ferramentas de dois pontos (Trendline, Fibonacci, Medição/Ruler)
    if (activeTool === 'trendline' || activeTool === 'fibonacci' || activeTool === 'measure') {
      const idx = Math.max(0, Math.min(visibleCandles.length - 1, Math.floor((svgX - leftMargin) / candleSlotWidth)));
      const priceAtCursor = getPriceFromY(svgY);

      if (!pendingDrawingStart) {
        // Primeiro clique: define o ponto de partida
        setPendingDrawingStart({
          candleIndex: idx,
          price: priceAtCursor,
          x: svgX,
          y: svgY
        });
      } else {
        // Segundo clique: finaliza o desenho
        const newDrawing: ChartDrawing = {
          id: `${activeTool}-${Date.now()}`,
          type: activeTool,
          color: activeTool === 'measure' ? '#10B981' : activeTool === 'fibonacci' ? '#F59E0B' : '#8B5CF6',
          candleIndexStart: pendingDrawingStart.candleIndex,
          priceStart: pendingDrawingStart.price,
          candleIndexEnd: idx,
          priceEnd: priceAtCursor
        };
        setDrawings((prev) => [...prev, newDrawing]);
        setPendingDrawingStart(null);
        if (activeTool === 'measure') {
          // Mantém ruler ou volta para crosshair
        } else {
          setActiveTool('crosshair');
        }
      }
      return;
    }

    // Se a ferramenta for cursor ou crosshair, inicia arraste para navegar no histórico (Pan)
    isDraggingRef.current = true;
    dragStartXRef.current = pt.x;
    dragStartPanRef.current = panOffset;
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const pt = getSvgPoint(e.clientX, e.clientY, svg);
    const svgX = pt.x;
    const svgY = pt.y;

    if (isDraggingRef.current) {
      // Arrastando horizontalmente no eixo de velas para navegar no histórico (Pan)
      const dxUnits = svgX - dragStartXRef.current;
      if (candleSlotWidth > 0) {
        const deltaCandles = Math.round(dxUnits / candleSlotWidth);
        const maxOffset = Math.max(0, candles.length - visibleCount);
        const newOffset = Math.max(0, Math.min(maxOffset, dragStartPanRef.current + deltaCandles));
        setPanOffset(newOffset);
      }
      return;
    }

    // Atualiza Crosshair
    if (svgX >= leftMargin && svgX <= width - rightMargin) {
      const idx = Math.floor((svgX - leftMargin) / candleSlotWidth);
      if (idx >= 0 && idx < visibleCandles.length) {
        setHoverIndex(idx);
        const candleX = leftMargin + idx * candleSlotWidth + candleSlotWidth / 2;
        const currentPriceAtCursor = getPriceFromY(svgY);
        setCrosshairPos({
          x: candleX,
          y: Math.min(mainHeight, Math.max(0, svgY)),
          price: currentPriceAtCursor
        });
      }
    } else {
      setHoverIndex(null);
      setCrosshairPos(null);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    isDraggingRef.current = false;
    const svg = svgRef.current;
    if (svg?.hasPointerCapture?.(e.pointerId)) {
      svg.releasePointerCapture(e.pointerId);
    }
  };

  const handlePointerLeave = () => {
    if (!isDraggingRef.current) {
      setHoverIndex(null);
      setCrosshairPos(null);
    }
  };

  // Zoom pelo scroll do mouse (Mouse Wheel)
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      handleZoomIn();
    } else if (e.deltaY > 0) {
      handleZoomOut();
    }
  };

  // Grade de Preços (5 linhas horizontais equidistantes)
  const priceGridLevels = [0.12, 0.32, 0.52, 0.72, 0.92];

  // Grade de Tempos (4 a 6 marcas verticais)
  const timeTickIndices = useMemo(() => {
    if (visibleCandles.length < 4) return [];
    const step = Math.max(1, Math.floor(visibleCandles.length / (isExpanded ? 7 : 4)));
    const indices: number[] = [];
    for (let i = 0; i < visibleCandles.length; i += step) {
      indices.push(i);
    }
    return indices;
  }, [visibleCandles.length, isExpanded]);

  const candleChangePct = activeCandle && activeCandle.open > 0
    ? ((activeCandle.close - activeCandle.open) / activeCandle.open) * 100
    : 0;

  const containerStyle: React.CSSProperties = isExpanded && isRotated
    ? {
        position: 'fixed',
        top: 0,
        left: 0,
        width: `${windowDimensions.height}px`,
        height: `${windowDimensions.width}px`,
        transform: 'rotate(90deg) translate(0, -100%)',
        transformOrigin: 'top left',
        zIndex: 9999
      }
    : isExpanded
    ? {
        position: 'fixed',
        inset: 0,
        zIndex: 9999
      }
    : {};

  return (
    <div
      style={containerStyle}
      className={
        isExpanded
          ? 'bg-[#090C12] text-slate-100 flex flex-col overflow-hidden animate-in fade-in duration-200 select-none shadow-2xl'
          : 'w-full bg-[#0D111A] border border-slate-800/90 rounded-2xl overflow-hidden select-none'
      }
    >
      {/* Barra de Ferramentas Estilo TradingView */}
      <div className="px-3 py-2.5 bg-[#111622] border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
        {/* Identificação do Ativo e Preço (no modo expandido) */}
        <div className="flex items-center gap-2.5">
          {assetSymbol && (
            <div className="flex items-baseline gap-1.5">
              <span className="font-semibold text-slate-100 text-sm tracking-tight">{assetSymbol}</span>
              {assetName && <span className="text-slate-400 text-xs hidden sm:inline">· {assetName}</span>}
              {currentPrice !== undefined && (
                <span className="font-mono text-slate-100 font-medium ml-1.5 tabular-nums">
                  ${fmtPrice(currentPrice)}
                </span>
              )}
              {priceChange24h !== undefined && (
                <span
                  className={`text-[11px] font-mono tabular-nums ${
                    priceChange24h >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {priceChange24h >= 0 ? '+' : ''}
                  {priceChange24h.toFixed(2)}%
                </span>
              )}
            </div>
          )}

          {/* Timeframes */}
          {onChangeTimeframe && (
            <div className="flex items-center gap-0.5 bg-[#171D2B] p-0.5 rounded-lg border border-slate-800">
              {AVAILABLE_TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  onClick={() => onChangeTimeframe(tf)}
                  className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
                    timeframe === tf
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          )}

          {/* Tipo de Gráfico: Velas vs Linha */}
          <div className="flex items-center gap-0.5 bg-[#171D2B] p-0.5 rounded-lg border border-slate-800">
            <button
              onClick={() => setChartType('candle')}
              title="Velas Japonesas"
              className={`p-1 rounded transition-colors ${
                chartType === 'candle'
                  ? 'bg-slate-700 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BarChart2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setChartType('line')}
              title="Linha Contínua"
              className={`p-1 rounded transition-colors ${
                chartType === 'line'
                  ? 'bg-slate-700 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Toggles de Indicadores Técnicos & Ferramentas de Zoom / Expandir */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-1 bg-[#171D2B] p-0.5 rounded-lg border border-slate-800">
            <button
              onClick={() => setShowEma20((v) => !v)}
              className={`px-2 py-0.5 text-[10px] font-mono rounded transition-colors flex items-center gap-1 ${
                showEma20
                  ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-800/50'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
              title="Média Móvel Exponencial de 20 períodos"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
              EMA20
            </button>

            <button
              onClick={() => setShowEma50((v) => !v)}
              className={`px-2 py-0.5 text-[10px] font-mono rounded transition-colors flex items-center gap-1 ${
                showEma50
                  ? 'bg-purple-950/80 text-purple-300 border border-purple-800/50'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
              title="Média Móvel Exponencial de 50 períodos"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
              EMA50
            </button>

            <button
              onClick={() => setShowBollinger((v) => !v)}
              className={`px-2 py-0.5 text-[10px] font-mono rounded transition-colors flex items-center gap-1 ${
                showBollinger
                  ? 'bg-blue-950/80 text-blue-300 border border-blue-800/50'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
              title="Bandas de Bollinger (20, 2)"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
              BB
            </button>

            <button
              onClick={() => setShowVolume((v) => !v)}
              className={`px-2 py-0.5 text-[10px] font-mono rounded transition-colors ${
                showVolume
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/50'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
              title="Volume de Negociação"
            >
              VOL
            </button>

            <button
              onClick={() => setShowRsi((v) => !v)}
              className={`px-2 py-0.5 text-[10px] font-mono rounded transition-colors flex items-center gap-1 ${
                showRsi
                  ? 'bg-amber-950/80 text-amber-300 border border-amber-800/50'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
              title="Índice de Força Relativa (Wilder 14)"
            >
              RSI
            </button>

            <button
              onClick={() => setShowMacd((v) => !v)}
              className={`px-2 py-0.5 text-[10px] font-mono rounded transition-colors flex items-center gap-1 ${
                showMacd
                  ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-800/50'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
              title="MACD (12, 26, 9)"
            >
              MACD
            </button>

            <button
              onClick={() => setScaleMode((m) => (m === 'auto' ? 'log' : 'auto'))}
              className={`px-2 py-0.5 text-[10px] font-mono rounded transition-colors ${
                scaleMode === 'log'
                  ? 'bg-amber-950/80 text-amber-300 border border-amber-800/50'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
              title="Alternar entre Escala Normal e Logarítmica (Log)"
            >
              {scaleMode === 'log' ? 'LOG' : 'AUTO'}
            </button>
          </div>

          {/* Ferramentas de Zoom Dinâmico e Reset */}
          <div className="flex items-center gap-0.5 bg-[#171D2B] p-0.5 rounded-lg border border-slate-800">
            <button
              onClick={handleZoomIn}
              title="Aproximar Zoom (+)"
              className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleZoomOut}
              title="Afastar Zoom (-)"
              className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleResetZoom}
              title="Resetar Zoom e Centralizar Histórico (100%)"
              className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Alternar visibilidade e limpeza de desenhos técnicos */}
          {drawings.length > 0 && (
            <div className="flex items-center gap-0.5 bg-[#171D2B] p-0.5 rounded-lg border border-slate-800">
              <button
                onClick={() => setShowDrawings((v) => !v)}
                title={showDrawings ? 'Ocultar estudos e desenhos' : 'Exibir estudos e desenhos'}
                className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
              >
                {showDrawings ? <Eye className="w-3.5 h-3.5 text-blue-400" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => {
                  setDrawings([]);
                  setPendingDrawingStart(null);
                }}
                title="Limpar todos os desenhos e linhas"
                className="p-1 text-slate-400 hover:text-rose-400 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Botão de Alternar Rotação Horizontal 90° (Modo Paisagem TradingView Mobile) */}
          <button
            onClick={() => {
              if (!isExpanded) {
                setIsExpanded(true);
                setIsRotated(true);
              } else {
                setIsRotated((r) => !r);
              }
            }}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
              isRotated
                ? 'bg-purple-600/30 text-purple-200 border border-purple-500/50 hover:bg-purple-600/40 shadow-sm'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-700/60'
            }`}
            title="Visualização rotacionada horizontalmente em 90° para telas pequenas (estilo TradingView mobile)"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">
              {isRotated ? 'Desfazer Giro' : 'Girar 90° (Paisagem)'}
            </span>
            <span className="sm:hidden">
              {isRotated ? 'Normal' : '90° Paisagem'}
            </span>
          </button>

          {/* Botão de Expandir / Reduzir Estilo TradingView */}
          {isExpandable && (
            <button
              onClick={() => {
                if (isExpanded) {
                  setIsExpanded(false);
                  setIsRotated(false);
                } else {
                  setIsExpanded(true);
                }
              }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                isExpanded
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'
                  : 'bg-blue-600/20 text-blue-300 border border-blue-500/30 hover:bg-blue-600/30'
              }`}
              title={isExpanded ? 'Reduzir tela (Esc)' : 'Expandir gráfico estilo TradingView'}
            >
              {isExpanded ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5" />
                  <span>Reduzir</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>Expandir</span>
                </>
              )}
            </button>
          )}

          {/* Botão de Fechar Rápido quando em tela cheia */}
          {isExpanded && (
            <button
              onClick={() => {
                setIsExpanded(false);
                setIsRotated(false);
              }}
              className="p-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors ml-0.5"
              title="Fechar tela cheia (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* HUD de Informações da Vela Inspecionada (TradingView Bar) */}
      <div className="px-3 py-1.5 bg-[#0f141f] border-b border-slate-800/80 flex flex-wrap items-center justify-between text-[11px] gap-2 font-mono">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-slate-400 font-medium">{activeCandle?.time || '—'}</span>
          <span className="text-slate-400">
            A: <strong className="text-slate-200">${activeCandle ? fmtPrice(activeCandle.open) : '—'}</strong>
          </span>
          <span className="text-slate-400">
            MÁX: <strong className="text-emerald-400">${activeCandle ? fmtPrice(activeCandle.high) : '—'}</strong>
          </span>
          <span className="text-slate-400">
            MÍN: <strong className="text-rose-400">${activeCandle ? fmtPrice(activeCandle.low) : '—'}</strong>
          </span>
          <span className="text-slate-400">
            F:{' '}
            <strong
              className={
                activeCandle && activeCandle.close >= activeCandle.open
                  ? 'text-emerald-400'
                  : 'text-rose-400'
              }
            >
              ${activeCandle ? fmtPrice(activeCandle.close) : '—'}
            </strong>
          </span>
          <span
            className={`font-medium ${
              candleChangePct >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {candleChangePct >= 0 ? '+' : ''}
            {candleChangePct.toFixed(2)}%
          </span>
          {showVolume && activeCandle?.volume !== undefined && (
            <span className="text-slate-400 hidden sm:inline">
              Vol: <strong className="text-slate-300">{activeCandle.volume.toLocaleString()}</strong>
            </span>
          )}
        </div>

        {/* Indicadores Ativos na Vela Inspecionada */}
        <div className="flex items-center gap-2.5 text-[10px] flex-wrap">
          {showEma20 && (
            <span className="text-cyan-400">
              EMA20: {activeCandle?.ema20 !== undefined ? `$${fmtPrice(activeCandle.ema20)}` : '—'}
            </span>
          )}
          {showEma50 && (
            <span className="text-purple-400">
              EMA50: {activeCandle?.ema50 !== undefined ? `$${fmtPrice(activeCandle.ema50)}` : '—'}
            </span>
          )}
          {showBollinger && activeCandle?.bollinger && (
            <span className="text-blue-300 hidden md:inline">
              BB: [Sup ${fmtPrice(activeCandle.bollinger.upper)} · Inf ${fmtPrice(activeCandle.bollinger.lower)}]
            </span>
          )}
          {showRsi && (
            <span className="text-amber-400">
              RSI: {activeCandle?.rsi !== undefined ? activeCandle.rsi.toFixed(1) : '—'}
            </span>
          )}
          {showMacd && activeCandle?.macd && (
            <span className="text-cyan-400 hidden sm:inline">
              MACD: {activeCandle.macd.macd} | Sig: {activeCandle.macd.signal} | Hist: {activeCandle.macd.histogram}
            </span>
          )}
        </div>
      </div>

      {/* Barra de Ferramentas Lateral Esquerda (TradingView Technical Tools) */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        <aside className="w-10 bg-[#0E131D] border-r border-slate-800/80 flex flex-col items-center py-2 gap-1.5 z-10 shrink-0 select-none">
          <button
            onClick={() => {
              setActiveTool('crosshair');
              setPendingDrawingStart(null);
            }}
            className={`p-2 rounded-lg transition-colors ${
              activeTool === 'crosshair'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
            title="Mira / Crosshair (Inspeção de Velas)"
          >
            <Crosshair className="w-4 h-4" />
          </button>

          <button
            onClick={() => {
              setActiveTool('cursor');
              setPendingDrawingStart(null);
            }}
            className={`p-2 rounded-lg transition-colors ${
              activeTool === 'cursor'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
            title="Ponteiro / Pan (Mover e Navegar no Histórico)"
          >
            <Move className="w-4 h-4" />
          </button>

          <div className="w-6 h-px bg-slate-800/80 my-0.5" />

          <button
            onClick={() => {
              setActiveTool('trendline');
              setPendingDrawingStart(null);
            }}
            className={`p-2 rounded-lg transition-colors relative ${
              activeTool === 'trendline'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
            title="Linha de Tendência (Clique em 2 pontos para traçar suporte/resistência)"
          >
            <TrendingUp className="w-4 h-4" />
          </button>

          <button
            onClick={() => {
              setActiveTool('h-line');
              setPendingDrawingStart(null);
            }}
            className={`p-2 rounded-lg transition-colors ${
              activeTool === 'h-line'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
            title="Linha de Preço Horizontal (Suporte / Resistência exato)"
          >
            <Minus className="w-4 h-4" />
          </button>

          <button
            onClick={() => {
              setActiveTool('fibonacci');
              setPendingDrawingStart(null);
            }}
            className={`p-2 rounded-lg transition-colors ${
              activeTool === 'fibonacci'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
            title="Retração de Fibonacci (Níveis 23.6%, 38.2%, 50%, 61.8% Golden Ratio, 78.6%)"
          >
            <Spline className="w-4 h-4" />
          </button>

          <button
            onClick={() => {
              setActiveTool('measure');
              setPendingDrawingStart(null);
            }}
            className={`p-2 rounded-lg transition-colors ${
              activeTool === 'measure'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
            title="Régua de Medição (Mede % de variação, barras e amplitude entre 2 pontos)"
          >
            <Ruler className="w-4 h-4" />
          </button>

          <div className="w-6 h-px bg-slate-800/80 my-0.5" />

          {drawings.length > 0 && (
            <button
              onClick={() => {
                setDrawings([]);
                setPendingDrawingStart(null);
              }}
              className="p-2 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
              title={`Limpar ${drawings.length} estudo(s)`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </aside>

        {/* Área Gráfica com Canvas SVG Interativo */}
        <div
          className={`relative flex-1 touch-none overflow-hidden ${
            activeTool === 'cursor' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'
          }`}
          onWheel={handleWheel}
        >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${mainHeight + activeSubPanelsCount * subPanelHeight}`}
          className="w-full h-full block"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerLeave}
        >
          <defs>
            <linearGradient id="tv-bb-grad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.04" />
            </linearGradient>
            <linearGradient id="tv-line-grad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Fundo do Gráfico Principal */}
          <rect x="0" y="0" width={width} height={mainHeight} fill="#0A0E17" />

          {/* Grade Horizontal de Preços */}
          {priceGridLevels.map((ratio) => {
            const y = mainHeight * ratio;
            const price = maxPrice - ratio * priceRange;
            return (
              <g key={`grid-h-${ratio}`}>
                <line
                  x1={leftMargin}
                  y1={y}
                  x2={width - rightMargin}
                  y2={y}
                  stroke="#172030"
                  strokeDasharray="2 3"
                  strokeWidth="0.8"
                />
                {/* Rótulo de Preço na Escala Y à Direita */}
                <text
                  x={width - rightMargin + 6}
                  y={y + 3.5}
                  fill="#64748B"
                  fontSize="9.5"
                  fontFamily="monospace"
                >
                  ${fmtPrice(price)}
                </text>
              </g>
            );
          })}

          {/* Grade Vertical de Tempo (X) */}
          {timeTickIndices.map((idx) => {
            const c = visibleCandles[idx];
            if (!c) return null;
            const x = leftMargin + idx * candleSlotWidth + candleSlotWidth / 2;
            return (
              <g key={`grid-v-${idx}`}>
                <line
                  x1={x}
                  y1={0}
                  x2={x}
                  y2={mainHeight}
                  stroke="#172030"
                  strokeDasharray="2 3"
                  strokeWidth="0.8"
                />
                <text
                  x={x}
                  y={mainHeight - 6}
                  fill="#475569"
                  fontSize="8.5"
                  textAnchor="middle"
                  fontFamily="monospace"
                >
                  {c.time.split(' ')[0]}
                </text>
              </g>
            );
          })}

          {/* Divisor da Escala Y à Direita */}
          <line
            x1={width - rightMargin}
            y1={0}
            x2={width - rightMargin}
            y2={mainHeight}
            stroke="#1E293B"
            strokeWidth="1"
          />

          {/* Volume de Negociação Integrado no Fundo */}
          {showVolume &&
            visibleCandles.map((c, i) => {
              const x = leftMargin + i * candleSlotWidth + candleGap / 2;
              const isUp = c.close >= c.open;
              const vHeight = (c.volume / maxVol) * volumeHeight;
              const y = mainHeight - vHeight;
              return (
                <rect
                  key={`vol-${i}`}
                  x={x}
                  y={y}
                  width={candleWidth}
                  height={vHeight}
                  fill={isUp ? '#10B981' : '#F43F5E'}
                  opacity={0.2}
                />
              );
            })}

          {/* Bandas de Bollinger (Área Sombreada e Linhas) */}
          {showBollinger && bbAreaPoints && (
            <polygon points={bbAreaPoints} fill="url(#tv-bb-grad)" />
          )}
          {showBollinger && bbUpperPoints && (
            <polyline
              fill="none"
              stroke="#3B82F6"
              strokeWidth="1"
              strokeDasharray="3 2"
              opacity="0.8"
              points={bbUpperPoints}
            />
          )}
          {showBollinger && bbMiddlePoints && (
            <polyline
              fill="none"
              stroke="#3B82F6"
              strokeWidth="0.8"
              opacity="0.4"
              points={bbMiddlePoints}
            />
          )}
          {showBollinger && bbLowerPoints && (
            <polyline
              fill="none"
              stroke="#3B82F6"
              strokeWidth="1"
              strokeDasharray="3 2"
              opacity="0.8"
              points={bbLowerPoints}
            />
          )}

          {/* Velas Japonesas ou Linha */}
          {chartType === 'candle' ? (
            visibleCandles.map((c, i) => {
              const x = leftMargin + i * candleSlotWidth + candleGap / 2;
              const centerX = x + candleWidth / 2;
              const isUp = c.close >= c.open;
              const color = isUp ? '#22C55E' : '#EF4444';

              const openY = getY(c.open);
              const closeY = getY(c.close);
              const highY = getY(c.high);
              const lowY = getY(c.low);

              const bodyTop = Math.min(openY, closeY);
              const bodyHeight = Math.max(1.5, Math.abs(closeY - openY));

              return (
                <g key={`candle-${i}`}>
                  {/* Pavio Superior e Inferior */}
                  <line
                    x1={centerX}
                    y1={highY}
                    x2={centerX}
                    y2={lowY}
                    stroke={color}
                    strokeWidth="1.2"
                  />
                  {/* Corpo da Vela */}
                  <rect
                    x={x}
                    y={bodyTop}
                    width={candleWidth}
                    height={bodyHeight}
                    fill={color}
                    rx="0.5"
                  />
                </g>
              );
            })
          ) : (
            <polyline
              fill="none"
              stroke="#22C55E"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={linePoints}
            />
          )}

          {/* Linhas das Médias Móveis Exponenciais */}
          {showEma20 && ema20Points && (
            <polyline
              fill="none"
              stroke="#06B6D4"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={ema20Points}
            />
          )}

          {showEma50 && ema50Points && (
            <polyline
              fill="none"
              stroke="#A855F7"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={ema50Points}
            />
          )}

          {/* Linha do Preço ao Vivo (Live Price Dotted Line) */}
          {livePrice > 0 && liveY >= 0 && liveY <= mainHeight && (
            <g>
              <line
                x1={leftMargin}
                y1={liveY}
                x2={width - rightMargin}
                y2={liveY}
                stroke={isLiveUp ? '#22C55E' : '#EF4444'}
                strokeDasharray="3 3"
                strokeWidth="1"
                opacity="0.85"
              />
              {/* Badge de Preço Atual no Eixo Y */}
              <rect
                x={width - rightMargin + 1}
                y={liveY - 8}
                width={rightMargin - 3}
                height={16}
                rx="3"
                fill={isLiveUp ? '#166534' : '#991B1B'}
              />
              <text
                x={width - rightMargin + 5}
                y={liveY + 3.5}
                fill="#FFFFFF"
                fontSize="9"
                fontWeight="bold"
                fontFamily="monospace"
              >
                ${fmtPrice(livePrice)}
              </text>
            </g>
          )}

          {/* Mira Interativa TradingView (Crosshair) */}
          {crosshairPos && (
            <g>
              {/* Linha Vertical da Mira */}
              <line
                x1={crosshairPos.x}
                y1={0}
                x2={crosshairPos.x}
                y2={mainHeight + activeSubPanelsCount * subPanelHeight}
                stroke="#94A3B8"
                strokeDasharray="2 2"
                strokeWidth="0.9"
                opacity="0.8"
              />

              {/* Linha Horizontal da Mira */}
              <line
                x1={leftMargin}
                y1={crosshairPos.y}
                x2={width - rightMargin}
                y2={crosshairPos.y}
                stroke="#94A3B8"
                strokeDasharray="2 2"
                strokeWidth="0.9"
                opacity="0.8"
              />

              {/* Rótulo da Mira no Eixo de Preços Y à Direita */}
              <rect
                x={width - rightMargin + 1}
                y={crosshairPos.y - 8}
                width={rightMargin - 3}
                height={16}
                rx="3"
                fill="#1E293B"
                stroke="#64748B"
                strokeWidth="0.8"
              />
              <text
                x={width - rightMargin + 5}
                y={crosshairPos.y + 3.5}
                fill="#F8FAFC"
                fontSize="9"
                fontFamily="monospace"
                fontWeight="500"
              >
                ${fmtPrice(crosshairPos.price)}
              </text>

              {/* Rótulo de Tempo no Eixo X */}
              {activeCandle && (
                <g>
                  <rect
                    x={crosshairPos.x - 38}
                    y={mainHeight - 14}
                    width={76}
                    height={14}
                    rx="3"
                    fill="#1E293B"
                    stroke="#64748B"
                    strokeWidth="0.8"
                  />
                  <text
                    x={crosshairPos.x}
                    y={mainHeight - 3.5}
                    fill="#F8FAFC"
                    fontSize="8.5"
                    textAnchor="middle"
                    fontFamily="monospace"
                  >
                    {activeCandle.time}
                  </text>
                </g>
              )}
            </g>
          )}

          {/* Camada de Desenhos e Ferramentas Técnicas TradingView */}
          {showDrawings && (
            <g>
              {drawings.map((d) => {
                if (d.type === 'h-line' && d.price !== undefined) {
                  const y = getY(d.price);
                  if (y < 0 || y > mainHeight) return null;
                  return (
                    <g key={d.id}>
                      <line
                        x1={leftMargin}
                        y1={y}
                        x2={width - rightMargin}
                        y2={y}
                        stroke={d.color}
                        strokeWidth="1.5"
                        strokeDasharray="4 2"
                      />
                      <rect
                        x={width - rightMargin + 1}
                        y={y - 8}
                        width={rightMargin - 3}
                        height={16}
                        rx="3"
                        fill="#1E3A8A"
                        stroke={d.color}
                        strokeWidth="0.8"
                      />
                      <text
                        x={width - rightMargin + 5}
                        y={y + 3.5}
                        fill="#FFFFFF"
                        fontSize="9"
                        fontFamily="monospace"
                        fontWeight="bold"
                      >
                        ${fmtPrice(d.price)}
                      </text>
                    </g>
                  );
                }

                if (
                  (d.type === 'trendline' || d.type === 'measure') &&
                  d.candleIndexStart !== undefined &&
                  d.candleIndexEnd !== undefined &&
                  d.priceStart !== undefined &&
                  d.priceEnd !== undefined
                ) {
                  const x1 = leftMargin + d.candleIndexStart * candleSlotWidth + candleSlotWidth / 2;
                  const y1 = getY(d.priceStart);
                  const x2 = leftMargin + d.candleIndexEnd * candleSlotWidth + candleSlotWidth / 2;
                  const y2 = getY(d.priceEnd);

                  const priceDelta = d.priceEnd - d.priceStart;
                  const pctDelta = d.priceStart > 0 ? (priceDelta / d.priceStart) * 100 : 0;
                  const candlesDelta = Math.abs(d.candleIndexEnd - d.candleIndexStart);

                  return (
                    <g key={d.id}>
                      {d.type === 'measure' && (
                        <rect
                          x={Math.min(x1, x2)}
                          y={Math.min(y1, y2)}
                          width={Math.max(1, Math.abs(x2 - x1))}
                          height={Math.max(1, Math.abs(y2 - y1))}
                          fill={priceDelta >= 0 ? '#10B981' : '#F43F5E'}
                          opacity="0.12"
                        />
                      )}
                      <line
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke={d.color}
                        strokeWidth={d.type === 'measure' ? '1.8' : '2'}
                        strokeDasharray={d.type === 'measure' ? '3 2' : undefined}
                      />
                      {/* Ponto inicial e final */}
                      <circle cx={x1} cy={y1} r="3.5" fill={d.color} />
                      <circle cx={x2} cy={y2} r="3.5" fill={d.color} />
                      {/* Badge Informativo da Régua/Medição */}
                      <g>
                        <rect
                          x={(x1 + x2) / 2 - 46}
                          y={(y1 + y2) / 2 - 18}
                          width={92}
                          height={20}
                          rx="4"
                          fill="#0F172A"
                          stroke={d.color}
                          strokeWidth="1"
                        />
                        <text
                          x={(x1 + x2) / 2}
                          y={(y1 + y2) / 2 - 4}
                          fill="#FFFFFF"
                          fontSize="9"
                          textAnchor="middle"
                          fontFamily="monospace"
                          fontWeight="bold"
                        >
                          {pctDelta >= 0 ? '+' : ''}{pctDelta.toFixed(2)}% ({candlesDelta}v)
                        </text>
                      </g>
                    </g>
                  );
                }

                if (
                  d.type === 'fibonacci' &&
                  d.candleIndexStart !== undefined &&
                  d.candleIndexEnd !== undefined &&
                  d.priceStart !== undefined &&
                  d.priceEnd !== undefined
                ) {
                  const x1 = leftMargin + d.candleIndexStart * candleSlotWidth + candleSlotWidth / 2;
                  const x2 = leftMargin + d.candleIndexEnd * candleSlotWidth + candleSlotWidth / 2;
                  const leftX = Math.min(x1, x2);
                  const rightX = Math.max(x1, x2, width - rightMargin);
                  const pStart = d.priceStart;
                  const pEnd = d.priceEnd;
                  const pDiff = pEnd - pStart;

                  const fibLevels = [
                    { ratio: 0, label: '0.0% (Base)', color: '#94A3B8' },
                    { ratio: 0.236, label: '23.6%', color: '#38BDF8' },
                    { ratio: 0.382, label: '38.2%', color: '#34D399' },
                    { ratio: 0.5, label: '50.0%', color: '#FBBF24' },
                    { ratio: 0.618, label: '61.8% (Golden)', color: '#F97316' },
                    { ratio: 0.786, label: '78.6%', color: '#A855F7' },
                    { ratio: 1, label: '100.0% (Topo)', color: '#EC4899' }
                  ];

                  return (
                    <g key={d.id}>
                      {fibLevels.map((lvl) => {
                        const lvlPrice = pStart + pDiff * lvl.ratio;
                        const lvlY = getY(lvlPrice);
                        if (lvlY < 0 || lvlY > mainHeight) return null;
                        return (
                          <g key={`${d.id}-fib-${lvl.ratio}`}>
                            <line
                              x1={leftX}
                              y1={lvlY}
                              x2={rightX}
                              y2={lvlY}
                              stroke={lvl.color}
                              strokeWidth="1.2"
                              strokeDasharray={lvl.ratio === 0.618 ? undefined : '2 2'}
                              opacity="0.9"
                            />
                            <text
                              x={leftX + 4}
                              y={lvlY - 3}
                              fill={lvl.color}
                              fontSize="8"
                              fontFamily="monospace"
                              fontWeight="600"
                            >
                              {lvl.label}: ${fmtPrice(lvlPrice)}
                            </text>
                          </g>
                        );
                      })}
                    </g>
                  );
                }

                return null;
              })}

              {/* Prévia interativa do desenho em andamento (primeiro ponto já marcado) */}
              {pendingDrawingStart && crosshairPos && (
                <g>
                  <circle cx={pendingDrawingStart.x} cy={pendingDrawingStart.y} r="4" fill="#3B82F6" />
                  <line
                    x1={pendingDrawingStart.x}
                    y1={pendingDrawingStart.y}
                    x2={crosshairPos.x}
                    y2={crosshairPos.y}
                    stroke="#3B82F6"
                    strokeWidth="1.5"
                    strokeDasharray="3 3"
                  />
                  <rect
                    x={crosshairPos.x + 8}
                    y={crosshairPos.y - 12}
                    width={110}
                    height={18}
                    rx="3"
                    fill="#1E293B"
                    stroke="#3B82F6"
                    strokeWidth="0.8"
                  />
                  <text
                    x={crosshairPos.x + 14}
                    y={crosshairPos.y}
                    fill="#FFFFFF"
                    fontSize="8.5"
                    fontFamily="monospace"
                  >
                    Clique para fixar
                  </text>
                </g>
              )}
            </g>
          )}

          {/* Sub-painel do RSI (14) */}
          {showRsi && (
            <g transform={`translate(0, ${mainHeight})`}>
              <rect x="0" y="0" width={width} height={subPanelHeight} fill="#070A10" />
              <line x1={leftMargin} y1="0" x2={width - rightMargin} y2="0" stroke="#1E293B" strokeWidth="1" />
              {/* Zona Sobrecomprada (70) e Sobrevendida (30) */}
              <rect
                x={leftMargin}
                y={subPanelHeight * 0.3}
                width={width - leftMargin - rightMargin}
                height={subPanelHeight * 0.4}
                fill="#F59E0B"
                opacity="0.04"
              />
              <line
                x1={leftMargin}
                y1={subPanelHeight * 0.3}
                x2={width - rightMargin}
                y2={subPanelHeight * 0.3}
                stroke="#F59E0B"
                strokeDasharray="2 2"
                strokeWidth="0.8"
                opacity="0.45"
              />
              <line
                x1={leftMargin}
                y1={subPanelHeight * 0.7}
                x2={width - rightMargin}
                y2={subPanelHeight * 0.7}
                stroke="#F59E0B"
                strokeDasharray="2 2"
                strokeWidth="0.8"
                opacity="0.45"
              />
              <text x={width - rightMargin + 6} y={subPanelHeight * 0.3 + 3} fill="#F59E0B" fontSize="8" fontFamily="monospace">
                70
              </text>
              <text x={width - rightMargin + 6} y={subPanelHeight * 0.7 + 3} fill="#F59E0B" fontSize="8" fontFamily="monospace">
                30
              </text>
              <text x={leftMargin + 4} y="12" fill="#F59E0B" fontSize="9" fontWeight="bold">
                RSI (14)
              </text>

              {/* Linha do RSI */}
              <polyline
                fill="none"
                stroke="#F59E0B"
                strokeWidth="1.5"
                points={visibleCandles
                  .map((c, i) => {
                    if (c.rsi === undefined) return null;
                    const x = leftMargin + i * candleSlotWidth + candleSlotWidth / 2;
                    const y = subPanelHeight - (c.rsi / 100) * subPanelHeight;
                    return `${x.toFixed(1)},${y.toFixed(1)}`;
                  })
                  .filter(Boolean)
                  .join(' ')}
              />
            </g>
          )}

          {/* Sub-painel do MACD (12, 26, 9) */}
          {showMacd && (
            <g transform={`translate(0, ${mainHeight + (showRsi ? subPanelHeight : 0)})`}>
              <rect x="0" y="0" width={width} height={subPanelHeight} fill="#080C14" />
              <line x1={leftMargin} y1="0" x2={width - rightMargin} y2="0" stroke="#1E293B" strokeWidth="1" />
              <line
                x1={leftMargin}
                y1={subPanelHeight / 2}
                x2={width - rightMargin}
                y2={subPanelHeight / 2}
                stroke="#1E293B"
                strokeDasharray="2 2"
                strokeWidth="0.8"
                opacity="0.6"
              />

              <text x={leftMargin + 4} y="12" fill="#06B6D4" fontSize="9" fontWeight="bold">
                MACD (12, 26, 9)
              </text>
              <text x={leftMargin + 82} y="12" fill="#06B6D4" fontSize="8">
                Linha
              </text>
              <text x={leftMargin + 110} y="12" fill="#F59E0B" fontSize="8">
                Sinal
              </text>

              {/* Histograma do MACD */}
              {visibleCandles.map((c, i) => {
                if (!c.macd) return null;
                const x = leftMargin + i * candleSlotWidth + candleGap / 2;
                const hist = c.macd.histogram;
                const midY = subPanelHeight / 2;
                const normalizedHeight = (Math.abs(hist) / maxMacdAbs) * (midY * 0.75);
                const hHeight = Math.max(1, Math.min(midY, normalizedHeight));
                const y = hist >= 0 ? midY - hHeight : midY;
                return (
                  <rect
                    key={`hist-${i}`}
                    x={x}
                    y={y}
                    width={candleWidth}
                    height={hHeight}
                    fill={hist >= 0 ? '#10B981' : '#F43F5E'}
                    opacity="0.6"
                  />
                );
              })}

              {/* Linha MACD */}
              {macdLinePoints && (
                <polyline
                  fill="none"
                  stroke="#06B6D4"
                  strokeWidth="1.3"
                  points={macdLinePoints}
                />
              )}

              {/* Linha de Sinal */}
              {macdSignalPoints && (
                <polyline
                  fill="none"
                  stroke="#F59E0B"
                  strokeWidth="1.3"
                  strokeDasharray="2 1"
                  points={macdSignalPoints}
                />
              )}
            </g>
          )}
        </svg>

        {/* Botão Flutuante de Retornar ao Presente (quando navegado para o histórico) */}
        {panOffset > 0 && (
          <button
            onClick={() => setPanOffset(0)}
            className="absolute bottom-3 right-20 bg-blue-600/90 hover:bg-blue-600 text-white text-[11px] font-medium px-2.5 py-1 rounded-full shadow-lg border border-blue-400/30 flex items-center gap-1 transition-all"
          >
            <span>Ir para o tempo real</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}
        </div>
      </div>

      {/* Rodapé de Navegação e Ajuda */}
      <div className="px-3 py-1.5 bg-[#0b0f17] border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
        <div className="flex items-center gap-2">
          <span>Arraste para navegar no histórico</span>
          <span>·</span>
          <span>Scroll do mouse para zoom</span>
          {isExpanded && (
            <>
              <span>·</span>
              <span className="text-slate-400">Esc para fechar</span>
              {isRotated && (
                <>
                  <span>·</span>
                  <span className="text-purple-400 font-medium">Modo Paisagem 90° Ativo</span>
                </>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 font-mono text-[10px]">
          {activeTool !== 'crosshair' && activeTool !== 'cursor' && (
            <span className="text-blue-400 font-sans hidden sm:inline">
              Ferramenta ativa: <strong>{activeTool}</strong> (clique no gráfico para aplicar)
            </span>
          )}
          <span>{visibleCandles.length} velas exibidas</span>
          {onOpenTradeModal && isExpanded && (
            <button
              onClick={onOpenTradeModal}
              className="ml-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-3 py-1 rounded text-xs transition-colors"
            >
              Simular Ordem
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

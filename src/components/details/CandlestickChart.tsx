import React, { useState, useMemo } from 'react';
import { CandleData } from '../../types/crypto';

interface CandlestickChartProps {
  candles: CandleData[];
  chartType: 'candle' | 'line';
  showEma20: boolean;
  showEma50: boolean;
  showVolume: boolean;
  showRsi: boolean;
  showMacd: boolean;
  height?: number;
}

export const CandlestickChart: React.FC<CandlestickChartProps> = ({
  candles,
  chartType,
  showEma20,
  showEma50,
  showVolume,
  showRsi,
  showMacd,
  height = 360
}) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // Dimensões do gráfico
  const width = 600;
  const mainHeight = height * (showRsi && showMacd ? 0.52 : showRsi || showMacd ? 0.68 : 0.85);
  const volumeHeight = showVolume ? mainHeight * 0.22 : 0;
  const subPanelHeight = 58;

  // Cálculos de Escala do Gráfico Principal
  const { minPrice, maxPrice, priceRange, maxVol } = useMemo(() => {
    if (!candles.length) return { minPrice: 0, maxPrice: 1, priceRange: 1, maxVol: 1 };
    let min = Infinity;
    let max = -Infinity;
    let mv = 0;

    candles.forEach((c) => {
      if (c.low < min) min = c.low;
      if (c.high > max) max = c.high;
      if (c.volume > mv) mv = c.volume;
    });

    const pad = (max - min) * 0.06;
    return {
      minPrice: min - pad,
      maxPrice: max + pad,
      priceRange: (max + pad) - (min - pad) || 1,
      maxVol: mv || 1
    };
  }, [candles]);

  const candleWidth = Math.max(3, (width - 40) / candles.length);
  const candleGap = candleWidth * 0.28;
  const candleBodyWidth = candleWidth - candleGap;

  const getY = (price: number) => {
    return mainHeight - ((price - minPrice) / priceRange) * mainHeight;
  };

  // Linhas das EMAs
  const ema20Points = useMemo(() => {
    return candles
      .map((c, i) => {
        if (!c.ema20) return null;
        const x = 20 + i * candleWidth + candleBodyWidth / 2;
        const y = getY(c.ema20);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .filter(Boolean)
      .join(' ');
  }, [candles, minPrice, priceRange, candleWidth, candleBodyWidth, mainHeight]);

  const ema50Points = useMemo(() => {
    return candles
      .map((c, i) => {
        if (!c.ema50) return null;
        const x = 20 + i * candleWidth + candleBodyWidth / 2;
        const y = getY(c.ema50);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .filter(Boolean)
      .join(' ');
  }, [candles, minPrice, priceRange, candleWidth, candleBodyWidth, mainHeight]);

  // Linha contínua caso modo seja 'line'
  const linePoints = useMemo(() => {
    return candles
      .map((c, i) => {
        const x = 20 + i * candleWidth + candleBodyWidth / 2;
        const y = getY(c.close);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [candles, minPrice, priceRange, candleWidth, candleBodyWidth, mainHeight]);

  // Escala normalizada do MACD
  const { maxMacdAbs, macdLinePoints, macdSignalPoints } = useMemo(() => {
    if (!showMacd || !candles.length) {
      return { maxMacdAbs: 1, macdLinePoints: '', macdSignalPoints: '' };
    }
    let maxAbs = 0.0001;
    candles.forEach((c) => {
      if (c.macd) {
        maxAbs = Math.max(maxAbs, Math.abs(c.macd.macd), Math.abs(c.macd.signal), Math.abs(c.macd.histogram));
      }
    });

    const midY = subPanelHeight / 2;
    const linePts = candles
      .map((c, i) => {
        if (!c.macd) return null;
        const x = 20 + i * candleWidth + candleBodyWidth / 2;
        const y = midY - (c.macd.macd / maxAbs) * (midY * 0.8);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .filter(Boolean)
      .join(' ');

    const sigPts = candles
      .map((c, i) => {
        if (!c.macd) return null;
        const x = 20 + i * candleWidth + candleBodyWidth / 2;
        const y = midY - (c.macd.signal / maxAbs) * (midY * 0.8);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .filter(Boolean)
      .join(' ');

    return { maxMacdAbs: maxAbs, macdLinePoints: linePts, macdSignalPoints: sigPts };
  }, [candles, showMacd, candleWidth, candleBodyWidth, subPanelHeight]);

  const activeCandle = hoverIndex !== null && candles[hoverIndex] ? candles[hoverIndex] : candles[candles.length - 1];

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const ratio = clientX / rect.width;
    const svgX = ratio * width;
    const idx = Math.floor((svgX - 20) / candleWidth);
    if (idx >= 0 && idx < candles.length) {
      setHoverIndex(idx);
    }
  };

  const handlePointerLeave = () => {
    setHoverIndex(null);
  };

  return (
    <div className="w-full bg-[#0D111A] border border-slate-800 rounded-2xl overflow-hidden select-none">
      {/* HUD de informações da vela inspecionada */}
      <div className="px-3 py-2 bg-slate-900/80 border-b border-slate-800/80 flex flex-wrap items-center justify-between text-[11px] gap-2 font-mono">
        <div className="flex items-center gap-2">
          <span className="text-slate-400">{activeCandle?.time}</span>
          <span className="text-slate-400">
            A: <strong className="text-slate-200">${activeCandle?.open.toFixed(2)}</strong>
          </span>
          <span className="text-slate-400">
            MÁX: <strong className="text-emerald-400">${activeCandle?.high.toFixed(2)}</strong>
          </span>
          <span className="text-slate-400">
            MÍN: <strong className="text-rose-400">${activeCandle?.low.toFixed(2)}</strong>
          </span>
          <span className="text-slate-400">
            F: <strong className={activeCandle?.close >= activeCandle?.open ? 'text-emerald-400' : 'text-rose-400'}>
              ${activeCandle?.close.toFixed(2)}
            </strong>
          </span>
        </div>

        {/* Indicadores no cabeçalho */}
        <div className="flex items-center gap-2 text-[10px]">
          {showEma20 && activeCandle?.ema20 && (
            <span className="text-cyan-400">EMA20: ${activeCandle.ema20.toLocaleString()}</span>
          )}
          {showEma50 && activeCandle?.ema50 && (
            <span className="text-purple-400">EMA50: ${activeCandle.ema50.toLocaleString()}</span>
          )}
          {showRsi && activeCandle?.rsi && (
            <span className="text-amber-400">RSI: {activeCandle.rsi.toFixed(1)}</span>
          )}
          {showMacd && activeCandle?.macd && (
            <span className="text-cyan-400">MACD: {activeCandle.macd.macd} | Sig: {activeCandle.macd.signal}</span>
          )}
        </div>
      </div>

      {/* SVG Canvas Principal */}
      <div className="relative touch-none">
        <svg
          viewBox={`0 0 ${width} ${mainHeight + (showRsi ? subPanelHeight : 0) + (showMacd ? subPanelHeight : 0)}`}
          className="w-full h-auto block"
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
        >
          {/* Grade de Preços Horizontal */}
          {[0.2, 0.4, 0.6, 0.8].map((ratio) => {
            const y = mainHeight * ratio;
            const price = maxPrice - ratio * priceRange;
            return (
              <g key={ratio}>
                <line
                  x1="10"
                  y1={y}
                  x2={width - 50}
                  y2={y}
                  stroke="#1E293B"
                  strokeDasharray="3 3"
                  strokeWidth="0.8"
                />
                <text
                  x={width - 45}
                  y={y + 3}
                  fill="#64748B"
                  fontSize="9"
                  fontFamily="monospace"
                >
                  ${price.toFixed(price < 10 ? 3 : 1)}
                </text>
              </g>
            );
          })}

          {/* Volume de Fundo */}
          {showVolume &&
            candles.map((c, i) => {
              const x = 20 + i * candleWidth;
              const isUp = c.close >= c.open;
              const vHeight = (c.volume / maxVol) * volumeHeight;
              const y = mainHeight - vHeight;
              return (
                <rect
                  key={`vol-${i}`}
                  x={x}
                  y={y}
                  width={candleBodyWidth}
                  height={vHeight}
                  fill={isUp ? '#10B981' : '#F43F5E'}
                  opacity={0.18}
                />
              );
            })}

          {/* Candlesticks ou Linha */}
          {chartType === 'candle' ? (
            candles.map((c, i) => {
              const x = 20 + i * candleWidth;
              const centerX = x + candleBodyWidth / 2;
              const isUp = c.close >= c.open;
              const color = isUp ? '#10B981' : '#F43F5E';

              const openY = getY(c.open);
              const closeY = getY(c.close);
              const highY = getY(c.high);
              const lowY = getY(c.low);

              const bodyTop = Math.min(openY, closeY);
              const bodyHeight = Math.max(1.8, Math.abs(closeY - openY));

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
                    width={candleBodyWidth}
                    height={bodyHeight}
                    fill={isUp ? color : color}
                    rx="1"
                  />
                </g>
              );
            })
          ) : (
            <polyline
              fill="none"
              stroke="#10B981"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={linePoints}
            />
          )}

          {/* Linhas de Médias Móveis */}
          {showEma20 && (
            <polyline
              fill="none"
              stroke="#06B6D4"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={ema20Points}
            />
          )}

          {showEma50 && (
            <polyline
              fill="none"
              stroke="#A855F7"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={ema50Points}
            />
          )}

          {/* Linha Vertical da Mira (Crosshair) */}
          {hoverIndex !== null && (
            <g>
              <line
                x1={20 + hoverIndex * candleWidth + candleBodyWidth / 2}
                y1={0}
                x2={20 + hoverIndex * candleWidth + candleBodyWidth / 2}
                y2={mainHeight + (showRsi ? subPanelHeight : 0) + (showMacd ? subPanelHeight : 0)}
                stroke="#64748B"
                strokeDasharray="2 2"
                strokeWidth="1"
              />
              {/* Linha Horizontal da Mira */}
              <line
                x1={10}
                y1={getY(activeCandle.close)}
                x2={width - 50}
                y2={getY(activeCandle.close)}
                stroke="#64748B"
                strokeDasharray="2 2"
                strokeWidth="1"
              />
            </g>
          )}

          {/* Painel do RSI Sub-chart */}
          {showRsi && (
            <g transform={`translate(0, ${mainHeight})`}>
              <rect x="0" y="0" width={width} height={subPanelHeight} fill="#090D14" />
              <line x1="10" y1="0" x2={width - 50} y2="0" stroke="#1E293B" strokeWidth="1" />
              {/* Linhas 70 e 30 */}
              <line
                x1="10"
                y1={subPanelHeight * 0.3}
                x2={width - 50}
                y2={subPanelHeight * 0.3}
                stroke="#F59E0B"
                strokeDasharray="2 2"
                strokeWidth="0.8"
                opacity="0.4"
              />
              <line
                x1="10"
                y1={subPanelHeight * 0.7}
                x2={width - 50}
                y2={subPanelHeight * 0.7}
                stroke="#F59E0B"
                strokeDasharray="2 2"
                strokeWidth="0.8"
                opacity="0.4"
              />
              <text x={width - 45} y={subPanelHeight * 0.3 + 3} fill="#F59E0B" fontSize="8" fontFamily="monospace">
                70
              </text>
              <text x={width - 45} y={subPanelHeight * 0.7 + 3} fill="#F59E0B" fontSize="8" fontFamily="monospace">
                30
              </text>
              <text x="12" y="12" fill="#F59E0B" fontSize="9" fontWeight="bold">
                RSI (14)
              </text>

              {/* Linha do RSI */}
              <polyline
                fill="none"
                stroke="#F59E0B"
                strokeWidth="1.5"
                points={candles
                  .map((c, i) => {
                    const rsiVal = c.rsi ?? 50;
                    const x = 20 + i * candleWidth + candleBodyWidth / 2;
                    const y = subPanelHeight - (rsiVal / 100) * subPanelHeight;
                    return `${x.toFixed(1)},${y.toFixed(1)}`;
                  })
                  .join(' ')}
              />
            </g>
          )}

          {/* Painel do MACD Sub-chart */}
          {showMacd && (
            <g transform={`translate(0, ${mainHeight + (showRsi ? subPanelHeight : 0)})`}>
              <rect x="0" y="0" width={width} height={subPanelHeight} fill="#0A0E16" />
              <line x1="10" y1="0" x2={width - 50} y2="0" stroke="#1E293B" strokeWidth="1" />
              <line x1="10" y1={subPanelHeight / 2} x2={width - 50} y2={subPanelHeight / 2} stroke="#1E293B" strokeDasharray="2 2" strokeWidth="0.8" opacity="0.6" />
              
              <text x="12" y="12" fill="#06B6D4" fontSize="9" fontWeight="bold">
                MACD (12, 26, 9)
              </text>
              <text x="88" y="12" fill="#06B6D4" fontSize="8">
                Linha
              </text>
              <text x="114" y="12" fill="#F59E0B" fontSize="8">
                Sinal
              </text>

              {/* Histograma do MACD com escala normalizada */}
              {candles.map((c, i) => {
                if (!c.macd) return null;
                const x = 20 + i * candleWidth;
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
                    width={candleBodyWidth}
                    height={hHeight}
                    fill={hist >= 0 ? '#10B981' : '#F43F5E'}
                    opacity="0.5"
                  />
                );
              })}

              {/* Linha MACD (Cyan) */}
              {macdLinePoints && (
                <polyline
                  fill="none"
                  stroke="#06B6D4"
                  strokeWidth="1.3"
                  points={macdLinePoints}
                />
              )}

              {/* Linha de Sinal (Amber) */}
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
      </div>
    </div>
  );
};

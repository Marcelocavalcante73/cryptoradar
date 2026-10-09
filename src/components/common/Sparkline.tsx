import React from 'react';

interface SparklineProps {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
  isPositive?: boolean;
}

export const Sparkline: React.FC<SparklineProps> = ({
  data,
  width = 80,
  height = 28,
  isPositive = true
}) => {
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const paddingY = 3;
  const points = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * width;
    const y = height - paddingY - ((val - min) / range) * (height - paddingY * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const strokeColor = isPositive ? '#10B981' : '#F43F5E';

  return (
    <svg width={width} height={height} className="overflow-visible shrink-0">
      <polyline
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
};

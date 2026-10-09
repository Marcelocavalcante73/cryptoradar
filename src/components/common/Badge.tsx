import React from 'react';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'green' | 'red' | 'neutral' | 'demo' | 'warning' | 'cyan' | 'purple';
  size?: 'sm' | 'md';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  size = 'sm',
  className = ''
}) => {
  const variantStyles = {
    green: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
    red: 'bg-rose-500/15 text-rose-400 border border-rose-500/30',
    neutral: 'bg-slate-800 text-slate-300 border border-slate-700/60',
    demo: 'bg-amber-500/15 text-amber-300 border border-amber-500/40 font-mono tracking-wide',
    warning: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
    cyan: 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30',
    purple: 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
  };

  const sizeStyles = {
    sm: 'text-[11px] px-2 py-0.5 rounded font-medium',
    md: 'text-xs px-2.5 py-1 rounded-md font-medium'
  };

  return (
    <span className={`inline-flex items-center gap-1 leading-none ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}>
      {children}
    </span>
  );
};

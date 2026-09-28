import React, { useEffect, useState } from 'react';
import { formatCurrencyINR, formatNumberINR } from '../shared/incentive';

interface AnimatedCounterProps {
  value: number;
  format?: 'currency' | 'number' | 'percent';
  decimals?: number;
  className?: string;
  duration?: number;
}

export const AnimatedCounter: React.FC<AnimatedCounterProps> = ({
  value,
  format = 'currency',
  decimals = 0,
  className = '',
  duration = 750,
}) => {
  const [displayValue, setDisplayValue] = useState(value);

  useEffect(() => {
    let startVal = displayValue;
    const endVal = value;
    if (startVal === endVal) return;

    const startTime = performance.now();
    let animId: number;

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Easing: easeOutExpo
      const ease = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      const current = startVal + (endVal - startVal) * ease;

      setDisplayValue(current);

      if (progress < 1) {
        animId = requestAnimationFrame(animate);
      } else {
        setDisplayValue(endVal);
      }
    };

    animId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animId);
  }, [value, duration]);

  const formatted =
    format === 'currency'
      ? formatCurrencyINR(Math.round(displayValue))
      : format === 'percent'
      ? `${formatNumberINR(displayValue, decimals)}%`
      : formatNumberINR(Math.round(displayValue));

  return <span className={`tabular-nums ${className}`}>{formatted}</span>;
};

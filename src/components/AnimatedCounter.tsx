import { useEffect, useRef, useState } from "react";

interface AnimatedCounterProps {
  value: number;
  duration?: number;
  format?: (n: number) => string;
  className?: string;
}

export default function AnimatedCounter({ value, duration = 800, format, className = "" }: AnimatedCounterProps) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  const rafRef = useRef(0);

  useEffect(() => {
    const from = prevRef.current;
    const to = value;
    if (from === to) return;

    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setDisplay(Math.round(from + (to - from) * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        prevRef.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  const formatted = format ? format(display) : display.toLocaleString();

  return <span className={className}>{formatted}</span>;
}

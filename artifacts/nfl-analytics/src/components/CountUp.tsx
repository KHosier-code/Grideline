import { useEffect, useRef, useState } from 'react';

const NUMBER = /\d+(?:\.\d+)?/g;

/** `text` with every number scaled by `progress` (0..1), keeping each number's decimals. */
export function scaleNumbers(text: string, progress: number) {
  return text.replace(NUMBER, match => {
    const decimals = match.includes('.') ? match.split('.')[1].length : 0;
    return (Number(match) * progress).toFixed(decimals);
  });
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Counts the numbers in a stat ("10–6", "64.2%", "28/40") up from zero the
 * first time it scrolls into view. Screen readers and reduced-motion users
 * get the final text straight away.
 */
export function CountUp({ text, duration = 900 }: { text: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [progress, setProgress] = useState(() => (reducedMotion() || typeof IntersectionObserver === 'undefined' ? 1 : 0));
  useEffect(() => {
    if (progress === 1 || !ref.current) return;
    let frame = 0;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        setProgress(1 - (1 - t) ** 3);
        if (t < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    }, { threshold: 0.4 });
    observer.observe(ref.current);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
    // Runs once per mount: a refetch with new numbers shows them directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (progress >= 1) return <span ref={ref} className="gl-countup">{text}</span>;
  return <span ref={ref} className="gl-countup">
    <span aria-hidden="true">{scaleNumbers(text, progress)}</span>
    <span className="sr-only">{text}</span>
  </span>;
}

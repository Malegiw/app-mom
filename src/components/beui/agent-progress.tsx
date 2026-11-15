import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

/**
 * Agent progress indicator, adapted from beUI "Agent Loading States" (beui.dev/components/agents/loading-states):
 * a 3x3 grid of cells that pulse in a wave, the current activity, and the elapsed time.
 * Rewritten with plain CSS instead of Tailwind classes so it fits this project.
 */
const DELAYS = [0, 0.14, 0.28, 0.42, 0.56, 0.7, 0.84, 0.98, 1.12];
const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;

function formatElapsed(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return minutes > 0 ? `${minutes} mnt ${seconds} dtk` : `${seconds} dtk`;
}

export function AgentProgress({ label, running = true, className }: { label: string; running?: boolean; className?: string }) {
  const reduce = useReducedMotion() ?? false;
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!running) return;
    const startedAt = performance.now();
    const timer = window.setInterval(() => setSeconds((performance.now() - startedAt) / 1000), 250);
    return () => window.clearInterval(timer);
  }, [running]);

  return (
    <span role="status" aria-label={`${label}, sedang berjalan`} className={className} style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
      <span aria-hidden="true" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 3, width: 28, height: 28, color: "var(--brand-orange, #fe5000)" }}>
        {DELAYS.map((delay, index) => (
          <motion.span
            key={index}
            style={{ borderRadius: 2, background: "currentColor" }}
            animate={reduce ? { opacity: [0.35, 0.8, 0.35] } : { opacity: [0.28, 1, 0.28], scale: [0.72, 1, 0.72] }}
            transition={{ duration: 1.55, ease: EASE_IN_OUT, repeat: Infinity, delay }}
          />
        ))}
      </span>
      <span style={{ fontWeight: 500 }}>{label}</span>
      <span aria-hidden="true" style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-secondary)" }}>
        {formatElapsed(seconds)}
      </span>
    </span>
  );
}

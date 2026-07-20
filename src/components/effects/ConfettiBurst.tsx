import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

interface ConfettiBurstProps {
  /** Bump this to fire a new burst */
  trigger: number;
  className?: string;
}

const COLORS = ["#B5C96A", "#77995C", "#EDE6D1", "#B34F4F", "#43653F"];

/**
 * One-shot confetti celebration (connect / big wins).
 */
export function ConfettiBurst({ trigger, className }: ConfettiBurstProps) {
  const [active, setActive] = useState(false);

  const pieces = useMemo(
    () =>
      Array.from({ length: 42 }, (_, i) => {
        const angle = (i / 42) * Math.PI * 2 + (i % 5) * 0.15;
        const dist = 80 + (i % 7) * 28;
        return {
          id: i,
          color: COLORS[i % COLORS.length],
          x: Math.cos(angle) * dist,
          y: Math.sin(angle) * dist - 40,
          rot: (i * 37) % 360,
          delay: `${(i % 8) * 0.02}s`,
          size: 6 + (i % 5),
        };
      }),
    []
  );

  useEffect(() => {
    if (trigger <= 0) return;
    setActive(true);
    const t = window.setTimeout(() => setActive(false), 1400);
    return () => window.clearTimeout(t);
  }, [trigger]);

  if (!active) return null;

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-0 z-[80] flex items-center justify-center",
        className
      )}
      aria-hidden="true"
    >
      {pieces.map((p) => (
        <span
          key={`${trigger}-${p.id}`}
          className="confetti-piece"
          style={{
            background: p.color,
            width: p.size,
            height: p.size * 0.55,
            // CSS vars for the keyframe
            ["--cx" as string]: `${p.x}px`,
            ["--cy" as string]: `${p.y}px`,
            ["--rot" as string]: `${p.rot}deg`,
            animationDelay: p.delay,
          }}
        />
      ))}
    </div>
  );
}

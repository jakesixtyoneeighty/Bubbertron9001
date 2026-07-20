import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface SparkleFieldProps {
  count?: number;
  className?: string;
}

/**
 * Soft floating sparkles for the forest-glass backdrop.
 * Pure CSS motion — no canvas, no extra deps.
 */
export function SparkleField({ count = 28, className }: SparkleFieldProps) {
  const sparkles = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const seed = (i * 47) % 97;
        return {
          id: i,
          left: `${(seed * 1.3) % 100}%`,
          top: `${(seed * 2.1 + i * 3) % 100}%`,
          size: 2 + (seed % 4),
          delay: `${(seed % 12) * 0.35}s`,
          duration: `${4 + (seed % 7)}s`,
          tone: seed % 3 === 0 ? "brick" : seed % 3 === 1 ? "lime" : "cream",
        };
      }),
    [count]
  );

  return (
    <div
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
      aria-hidden="true"
    >
      {sparkles.map((s) => (
        <span
          key={s.id}
          className={cn("sparkle-dot", `sparkle-${s.tone}`)}
          style={{
            left: s.left,
            top: s.top,
            width: s.size,
            height: s.size,
            animationDelay: s.delay,
            animationDuration: s.duration,
          }}
        />
      ))}
    </div>
  );
}

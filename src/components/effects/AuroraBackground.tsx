import { SparkleField } from "@/components/effects/SparkleField";

interface AuroraBackgroundProps {
  sparkleCount?: number;
}

/** Shared Forest Glass backdrop for the main app and guided setup. */
export function AuroraBackground({ sparkleCount = 32 }: AuroraBackgroundProps) {
  return (
    <div
      className="fixed inset-0 overflow-hidden pointer-events-none"
      aria-hidden="true"
    >
      <div className="aurora-blob aurora-1" />
      <div className="aurora-blob aurora-2" />
      <div className="aurora-blob aurora-3" />
      <div className="absolute inset-0 bg-grid" />
      <SparkleField count={sparkleCount} />
      <div className="absolute inset-0 bg-noise" />
    </div>
  );
}

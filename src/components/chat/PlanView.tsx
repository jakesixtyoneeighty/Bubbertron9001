import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleAlert,
  LoaderCircle,
  RotateCcw,
  X,
} from "lucide-react";
import { useAgentStore, type PlanStepStatus } from "@/stores/agent";
import { cn } from "@/lib/utils";

const phaseLabels = {
  idle: "Idle",
  planning: "Planning",
  executing: "Executing",
  verifying: "Verifying",
  repairing: "Correcting",
  completed: "Completed",
  error: "Needs attention",
  cancelled: "Cancelled",
};

function StepIcon({ status }: { status: PlanStepStatus }) {
  if (status === "completed") {
    return <Check className="h-3.5 w-3.5 text-primary" />;
  }
  if (status === "in_progress") {
    return <LoaderCircle className="h-3.5 w-3.5 animate-spin text-primary" />;
  }
  if (status === "error") {
    return <CircleAlert className="h-3.5 w-3.5 text-brick" />;
  }
  if (status === "skipped") {
    return <X className="h-3.5 w-3.5 text-muted-foreground" />;
  }
  return <Circle className="h-3.5 w-3.5 text-muted-foreground" />;
}

export function PlanView() {
  const phase = useAgentStore((state) => state.phase);
  const plan = useAgentStore((state) => state.plan);
  const lastError = useAgentStore((state) => state.lastError);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (phase === "planning" || phase === "repairing" || phase === "error") {
      setExpanded(true);
    }
    if (phase === "completed") {
      setExpanded(false);
    }
  }, [phase]);

  const skillNames = useMemo(
    () =>
      plan
        ? Array.from(
            new Set(plan.steps.flatMap((step) => step.skillNames))
          )
        : [],
    [plan]
  );

  if (!plan) return null;

  const completed = plan.steps.filter(
    (step) => step.status === "completed" || step.status === "skipped"
  ).length;

  return (
    <section className="rounded-xl glass border border-primary/20 overflow-hidden animate-pop-in">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-primary/5 transition-colors"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{plan.goal}</span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px]",
                phase === "error" || phase === "repairing"
                  ? "bg-destructive/20 text-red-200"
                  : phase === "completed"
                    ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground"
              )}
            >
              {phaseLabels[phase]}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {completed}/{plan.steps.length} steps
            {skillNames.length > 0
              ? ` · ${skillNames.length} skill${skillNames.length === 1 ? "" : "s"}`
              : ""}
          </p>
        </div>
        {phase === "repairing" ? (
          <RotateCcw className="h-4 w-4 text-amber-300" />
        ) : null}
      </button>

      {expanded ? (
        <div className="border-t border-border/60 px-4 py-3 space-y-3">
          <p className="text-xs text-muted-foreground">{plan.summary}</p>
          {skillNames.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {skillNames.map((name) => (
                <span
                  key={name}
                  className="rounded-md bg-primary/10 border border-primary/20 px-2 py-1 text-[11px] text-primary"
                >
                  {name}
                </span>
              ))}
            </div>
          ) : null}
          <ol className="space-y-2">
            {plan.steps.map((step) => (
              <li key={step.id} className="flex gap-2.5 text-sm">
                <span className="mt-0.5">
                  <StepIcon status={step.status} />
                </span>
                <div className="min-w-0">
                  <p
                    className={cn(
                      "font-medium",
                      step.status === "completed" &&
                        "text-muted-foreground line-through"
                    )}
                  >
                    {step.title}
                  </p>
                  {step.status === "in_progress" || step.status === "error" ? (
                    <p className="text-xs text-muted-foreground">
                      {step.notes || step.description}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          {lastError ? (
            <p className="rounded-lg bg-destructive/20 border border-destructive/30 px-3 py-2 text-xs text-red-200">
              {lastError}
            </p>
          ) : null}
          {plan.verification ? (
            <p className="rounded-lg bg-primary/15 border border-primary/25 px-3 py-2 text-xs text-primary">
              Verified: {plan.verification}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}


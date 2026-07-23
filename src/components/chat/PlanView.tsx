import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleAlert,
  LoaderCircle,
  RotateCcw,
  Users,
  X,
} from "lucide-react";
import type { WorkerState } from "@/lib/agent/subagents";
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

const workerRoleLabels = {
  studio_explorer: "Studio Explorer",
  roblox_researcher: "Roblox Researcher",
  plan_reviewer: "Plan Reviewer",
};

const workerStateLabels: Record<WorkerState, string> = {
  queued: "Queued",
  running: "Working",
  completed: "Contributed",
  failed: "Failed",
  cancelled: "Cancelled",
  timed_out: "Timed out",
  dismissed: "Dismissed",
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

export function PlanView({ embedded = false }: { embedded?: boolean }) {
  const phase = useAgentStore((state) => state.phase);
  const plan = useAgentStore((state) => state.plan);
  const workers = useAgentStore((state) => state.workers);
  const lastError = useAgentStore((state) => state.lastError);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (embedded) return;
    if (phase === "planning" || phase === "repairing" || phase === "error") {
      setExpanded(true);
    }
    if (phase === "completed") {
      setExpanded(false);
    }
  }, [embedded, phase]);

  const skillNames = useMemo(
    () =>
      plan
        ? Array.from(
            new Set(plan.steps.flatMap((step) => step.skillNames))
          )
        : [],
    [plan]
  );
  const workersByStep = useMemo(() => {
    const grouped = new Map<string, typeof workers>();
    for (const worker of workers) {
      const stepId = worker.assignment.ownership.stepId;
      grouped.set(stepId, [...(grouped.get(stepId) ?? []), worker]);
    }
    return grouped;
  }, [workers]);

  if (!plan) return null;

  const completed = plan.steps.filter(
    (step) => step.status === "completed" || step.status === "skipped"
  ).length;

  const header = (
    <>
      {!embedded && (
        expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{plan.goal}</span>
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
    </>
  );

  return (
    <section className={cn(
      embedded
        ? "space-y-3"
        : "animate-pop-in overflow-hidden rounded-xl border border-primary/20 glass",
    )}>
      {embedded ? (
        <div className="flex items-center gap-3 text-left">{header}</div>
      ) : (
        <button
          type="button"
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-primary/5"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {header}
        </button>
      )}

      {embedded || expanded ? (
        <div className={cn(
          "space-y-3",
          !embedded && "border-t border-border/60 px-4 py-3",
        )}>
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
            {plan.steps.map((step) => {
              const stepWorkers = workersByStep.get(step.id) ?? [];
              return (
                <li key={step.id} className="flex gap-2.5 text-sm">
                  <span className="mt-0.5">
                    <StepIcon status={step.status} />
                  </span>
                  <div className="min-w-0 flex-1">
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
                    {stepWorkers.length > 0 ? (
                      <div className="mt-2 space-y-1.5">
                        {stepWorkers.map((worker) => (
                          <div
                            key={worker.assignment.ownership.workerId}
                            className="rounded-lg border border-border/60 bg-background/30 px-2.5 py-2"
                          >
                            <div className="flex items-center gap-2 text-[11px]">
                              <Users className="h-3.5 w-3.5 text-primary" />
                              <span className="font-medium text-foreground">
                                {workerRoleLabels[worker.assignment.role]}
                              </span>
                              <span className="text-muted-foreground">
                                {workerStateLabels[worker.state]}
                              </span>
                              {worker.state === "running" ? (
                                <LoaderCircle className="ml-auto h-3 w-3 animate-spin text-primary" />
                              ) : null}
                            </div>
                            {worker.result?.summary ? (
                              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                                {worker.result.summary}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
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

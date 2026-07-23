import * as React from "react";
import { cn } from "@/lib/utils";
import { Loader } from "./loader";
import {
  ChevronDown,
  ChevronRight,
  Check,
  CircleAlert,
  Wrench,
  HelpCircle,
} from "lucide-react";

export interface ToolCallProps {
  name: string;
  input?: Record<string, unknown>;
  output?: unknown;
  status: "pending" | "running" | "complete" | "error" | "waiting";
  error?: string;
  className?: string;
}

// Pretty print tool name (e.g., roblox_get_script -> Get Script)
function formatToolName(name: string): string {
  const labels: Record<string, string> = {
    agent_create_plan: "Create Plan",
    agent_update_plan: "Update Plan",
    agent_finish_plan: "Verify & Finish",
    skill_search: "Find Roblox Skills",
    skill_load: "Load Roblox Skill",
    web_search: "Search the Web",
  };
  if (labels[name]) return labels[name];

  return name
    .replace(/^(roblox|agent|skill)_/, "")
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function ToolCall({
  name,
  input,
  output,
  status,
  error,
  className,
}: ToolCallProps) {
  const [isExpanded, setIsExpanded] = React.useState(false);

  const statusConfig = {
    pending: {
      icon: <Loader variant="circular" size="sm" />,
      color: "text-muted-foreground",
    },
    running: {
      icon: <Loader variant="circular" size="sm" />,
      color: "text-primary",
    },
    waiting: {
      icon: <HelpCircle className="w-4 h-4" />,
      color: "text-amber-300",
    },
    complete: {
      icon: <Check className="w-4 h-4" />,
      color: "text-primary",
    },
    error: {
      icon: <CircleAlert className="w-4 h-4" />,
      color: "text-brick",
    },
  };

  const { icon, color } = statusConfig[status];

  return (
    <div className={cn("border-b border-border/50 last:border-b-0", className)}>
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-2.5 py-2 text-left text-sm transition-colors hover:text-foreground"
        aria-expanded={isExpanded}
      >
        <span className="text-muted-foreground">
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>
        <span className={cn("shrink-0", color)}>
          <Wrench className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {formatToolName(name)}
        </span>
        <span className={cn("flex shrink-0 items-center", color)}>
          {icon}
        </span>
      </button>

      {isExpanded && (
        <div className="space-y-3 pb-3 pl-6">
          {input && Object.keys(input).length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Input
              </p>
              <pre className="max-h-48 overflow-auto rounded-lg border border-border/60 bg-background/60 p-3 text-xs">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}

          {status === "complete" && output !== undefined && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Output
              </p>
              <pre className="max-h-48 overflow-auto rounded-lg border border-border/60 bg-background/60 p-3 text-xs">
                {typeof output === "string" 
                  ? output 
                  : JSON.stringify(output, null, 2)}
              </pre>
            </div>
          )}

          {/* Error */}
          {status === "error" && error && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-brick uppercase tracking-wide">
                Error
              </p>
              <pre className="overflow-x-auto rounded-lg border border-destructive/30 bg-destructive/20 p-3 text-xs text-red-200">
                {error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Component to show multiple tool calls in a message
export interface ToolCallsProps {
  toolCalls: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
    result?: unknown;
    status: "pending" | "running" | "complete" | "error" | "waiting";
    error?: string;
  }>;
  className?: string;
  isActive?: boolean;
  isWaiting?: boolean;
  mode?: "ask" | "build";
  children?: React.ReactNode;
}

export function getActivityLabel(
  toolCalls: ToolCallsProps["toolCalls"],
  mode: "ask" | "build",
  isActive: boolean,
  isWaiting = false,
) {
  if (!isActive) {
    return toolCalls.some((toolCall) => toolCall.status === "error")
      ? "Worked with issues"
      : "Worked";
  }
  if (isWaiting) return "Waiting for you";

  const currentTool = [...toolCalls]
    .reverse()
    .find((toolCall) =>
      ["pending", "running", "waiting"].includes(toolCall.status),
    )?.name;

  if (currentTool === "agent_create_plan") return "Planning";
  if (currentTool === "agent_finish_plan") return "Verifying";
  if (currentTool === "web_search" || currentTool?.startsWith("skill_")) {
    return "Researching";
  }
  if (
    currentTool &&
    /(create|set|edit|delete|move|clone|bulk|game)/.test(currentTool)
  ) {
    return "Building";
  }
  return mode === "ask" ? "Thinking" : "Working";
}

export function ToolCalls({
  toolCalls,
  className,
  isActive = false,
  isWaiting = false,
  mode = "build",
  children,
}: ToolCallsProps) {
  const [isExpanded, setIsExpanded] = React.useState(isActive);

  React.useEffect(() => {
    setIsExpanded(isActive);
  }, [isActive]);

  if ((!toolCalls || toolCalls.length === 0) && !isActive && !children) {
    return null;
  }

  const label = getActivityLabel(toolCalls, mode, isActive, isWaiting);
  const errorCount = toolCalls.filter((toolCall) => toolCall.status === "error").length;
  const actionLabel = toolCalls.length > 0
    ? `${toolCalls.length} action${toolCalls.length === 1 ? "" : "s"}`
    : mode === "ask"
      ? "Preparing a response"
      : "Preparing the workspace";

  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border border-border/70 bg-background/30",
        isActive && "border-primary/25 bg-primary/5",
        className,
      )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-primary/5"
        onClick={() => setIsExpanded((expanded) => !expanded)}
        aria-expanded={isExpanded}
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        {isActive ? (
          <Loader variant="circular" size="sm" />
        ) : errorCount > 0 ? (
          <CircleAlert className="h-4 w-4 shrink-0 text-brick" />
        ) : (
          <Check className="h-4 w-4 shrink-0 text-primary" />
        )}
        <span className="min-w-0 flex-1 text-sm font-medium">
          {label}{isActive ? "…" : ""}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {actionLabel}
        </span>
      </button>

      {isExpanded && (
        <div className="border-t border-border/60 px-3.5 py-2.5">
          {children}
          {toolCalls.length > 0 ? (
            <div className={cn(children && "mt-3 border-t border-border/50 pt-1")}>
              {toolCalls.map((toolCall) => (
                <ToolCall
                  key={toolCall.id}
                  name={toolCall.name}
                  input={toolCall.args}
                  output={toolCall.result}
                  status={toolCall.status}
                  error={toolCall.error}
                />
              ))}
            </div>
          ) : (
            !children && (
              <p className="py-1 text-xs text-muted-foreground">
                {isWaiting
                  ? "The build will continue after your answer."
                  : "Getting the next step ready."}
              </p>
            )
          )}
        </div>
      )}
    </section>
  );
}

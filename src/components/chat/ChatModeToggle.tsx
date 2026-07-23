import { Hammer, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChatMode } from "@/stores/chat";

interface ChatModeToggleProps {
  mode: ChatMode;
  onChange: (mode: ChatMode) => void;
  disabled?: boolean;
  className?: string;
}

export function ChatModeToggle({
  mode,
  onChange,
  disabled = false,
  className,
}: ChatModeToggleProps) {
  return (
    <div
      className={cn(
        "flex items-center rounded-lg border border-border/80 bg-background/45 p-0.5",
        className,
      )}
      aria-label="Conversation mode"
    >
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={cn(
          "h-7 gap-1.5 rounded-md px-2.5 text-xs",
          mode === "ask" && "bg-secondary text-foreground shadow-sm",
        )}
        aria-pressed={mode === "ask"}
        disabled={disabled}
        onClick={() => onChange("ask")}
        title="Ask mode talks things through without changing Studio"
      >
        <MessageCircle className="h-3.5 w-3.5" />
        Ask
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={cn(
          "h-7 gap-1.5 rounded-md px-2.5 text-xs",
          mode === "build" && "bg-primary text-primary-foreground shadow-sm",
        )}
        aria-pressed={mode === "build"}
        disabled={disabled}
        onClick={() => onChange("build")}
        title="Build mode can plan, use tools, and change Studio"
      >
        <Hammer className="h-3.5 w-3.5" />
        Build
      </Button>
    </div>
  );
}

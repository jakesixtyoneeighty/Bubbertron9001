import { useState } from "react";
import { Bug, Gamepad2, Play, ScanSearch, Sparkles, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const PLAYTEST_FIX_PROMPT = `[Playtest & Fix]
Inspect the current Roblox Studio playtest state and the recent Studio warnings and errors. Ignore routine bubbertron9001 bridge connection messages. If Studio is running or paused, tell me to press Stop and make no changes. Only diagnose and repair persistent game content while Studio is back in edit mode. If there is no relevant recent runtime evidence, tell me to press Play, reproduce the issue, press Stop, and try Playtest & Fix again. If the logs show a game issue, inspect the relevant scripts, create a plan, fix the root cause, verify the changed scripts with structured Studio readbacks, then tell me to run the playtest again.`;

interface PlaytestFixProps {
  onAnalyze: (prompt: string) => void;
  disabled?: boolean;
  studioConnected: boolean;
  compact?: boolean;
}

const STEPS = [
  {
    icon: Play,
    title: "Press Play in Studio",
    description: "Start the game with Roblox Studio’s Play button.",
  },
  {
    icon: Gamepad2,
    title: "Try the part you built",
    description: "Play until you see the problem—or confirm it feels right.",
  },
  {
    icon: Square,
    title: "Press Stop in Studio",
    description: "Return to edit mode so any repair B9 makes will be saved.",
  },
  {
    icon: ScanSearch,
    title: "Let B9 inspect it",
    description: "B9 reads recent warnings and errors, then repairs the cause.",
  },
];

export function PlaytestFix({
  onAnalyze,
  disabled = false,
  studioConnected,
  compact = false,
}: PlaytestFixProps) {
  const [open, setOpen] = useState(false);

  const handleAnalyze = () => {
    setOpen(false);
    onAnalyze(PLAYTEST_FIX_PROMPT);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size={compact ? "sm" : "default"}
          disabled={disabled}
          className={cn(
            "gap-2 border-primary/30 bg-primary/[0.07] text-primary hover:bg-primary/15 hover:text-primary",
            !compact && "rounded-xl",
          )}
        >
          <Bug className="h-4 w-4" />
          Playtest &amp; Fix
        </Button>
      </DialogTrigger>
      <DialogContent className="glass-strong rounded-2xl border-primary/20 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-heading">
            <Bug className="h-5 w-5 text-primary" />
            Playtest &amp; Fix
          </DialogTitle>
          <DialogDescription>
            Catch problems that only appear while the game is running.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-3">
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            return (
              <div
                key={step.title}
                className="flex gap-3 rounded-xl border border-border bg-muted/30 p-3"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium">
                    {index + 1}. {step.title}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {step.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {!studioConnected && (
          <p className="rounded-xl border border-destructive/30 bg-destructive/15 p-3 text-sm text-destructive-foreground">
            Connect Roblox Studio before analyzing a playtest.
          </p>
        )}

        <Button
          onClick={handleAnalyze}
          disabled={!studioConnected}
          className="w-full gap-2 rounded-xl glow-lime"
        >
          <Sparkles className="h-4 w-4" />
          Analyze the playtest now
        </Button>
      </DialogContent>
    </Dialog>
  );
}

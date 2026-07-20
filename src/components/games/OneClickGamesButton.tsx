import { useState, type ComponentType } from "react";
import { Gamepad2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { cn } from "@/lib/utils";

interface LauncherProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studioConnected: boolean;
  onPlaytestFix?: () => void;
}

interface OneClickGamesButtonProps {
  studioConnected: boolean;
  disabled?: boolean;
  compact?: boolean;
  onPlaytestFix?: () => void;
}

let launcherPromise: Promise<{ OneClickGamesDialog: ComponentType<LauncherProps> }> | null = null;

function loadLauncher() {
  launcherPromise ??= import("./OneClickGamesDialog");
  return launcherPromise;
}

export function OneClickGamesButton({
  studioConnected,
  disabled = false,
  compact = false,
  onPlaytestFix,
}: OneClickGamesButtonProps) {
  const [Launcher, setLauncher] = useState<ComponentType<LauncherProps> | null>(null);
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const handleOpen = async () => {
    if (Launcher) {
      setOpen(true);
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    try {
      const module = await loadLauncher();
      setLauncher(() => module.OneClickGamesDialog);
      setOpen(true);
    } catch {
      launcherPromise = null;
      setLoadError("Starter games could not be opened. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const unavailable = disabled || !studioConnected || isLoading;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={compact ? "sm" : "default"}
        disabled={unavailable}
        onClick={() => void handleOpen()}
        className={cn(
          "gap-2 border-primary/30 bg-primary/[0.07] text-primary hover:bg-primary/15 hover:text-primary",
          !compact && "rounded-xl",
        )}
        title={
          studioConnected
            ? "Build a ready-to-play starter game"
            : "Connect Roblox Studio to build a starter game"
        }
      >
        {isLoading ? (
          <Loader variant="circular" size="sm" />
        ) : (
          <Gamepad2 className="h-4 w-4" />
        )}
        Starter game
      </Button>

      {loadError ? (
        <span className="sr-only" role="alert">
          {loadError}
        </span>
      ) : null}

      {Launcher ? (
        <Launcher
          open={open}
          onOpenChange={setOpen}
          studioConnected={studioConnected}
          onPlaytestFix={onPlaytestFix}
        />
      ) : null}
    </>
  );
}

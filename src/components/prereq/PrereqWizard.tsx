import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Check,
  CheckCircle2,
  Download,
  ExternalLink,
  KeyRound,
  Monitor,
  Play,
  PlugZap,
  RefreshCw,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { AuroraBackground } from "@/components/effects/AuroraBackground";
import { Logo, LogoMark } from "@/components/icons/Logo";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { usePrereqStore, type PrereqCheck } from "@/stores/prereq";
import { useRobloxStore } from "@/stores/roblox";
import { useSettingsStore } from "@/stores/settings";

const SETUP_STEP_IDS = [
  "roblox-studio",
  "bubbertron9001-plugin",
  "api-provider",
  "studio-connection",
] as const;

type SetupStepId = (typeof SETUP_STEP_IDS)[number];

const STEP_CONTENT: Record<
  SetupStepId,
  { title: string; description: string; icon: React.ElementType }
> = {
  "roblox-studio": {
    title: "Get Roblox Studio",
    description: "The free app where your Roblox games are built.",
    icon: Monitor,
  },
  "bubbertron9001-plugin": {
    title: "Add B9 to Studio",
    description: "B9 installs its secure, paired Studio plugin for you.",
    icon: PlugZap,
  },
  "api-provider": {
    title: "Sign in to ChatGPT",
    description: "Use a Plus or Pro subscription, with no API key required.",
    icon: KeyRound,
  },
  "studio-connection": {
    title: "Connect your first game",
    description: "Open a project, allow HTTP requests, then connect B9.",
    icon: Play,
  },
};

function StatusMark({
  complete,
  active,
  checking,
  step,
}: {
  complete: boolean;
  active: boolean;
  checking: boolean;
  step: number;
}) {
  return (
    <div
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-sm font-semibold transition-all",
        complete && "border-primary/35 bg-primary/15 text-primary glow-lime",
        active && !complete && "border-primary/35 bg-primary/10 text-primary",
        !active && !complete && "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {checking ? (
        <Loader variant="circular" size="sm" />
      ) : complete ? (
        <Check className="h-5 w-5" />
      ) : (
        step
      )}
    </div>
  );
}

interface SetupStepProps {
  check: PrereqCheck;
  step: number;
  active: boolean;
  busyAction: string | null;
  actionError: string | null;
  onAction: (action: string) => Promise<void>;
}

function SetupStep({
  check,
  step,
  active,
  busyAction,
  actionError,
  onAction,
}: SetupStepProps) {
  const content = STEP_CONTENT[check.id as SetupStepId];
  const Icon = content.icon;
  const complete = check.status === "passed";
  const checking = check.status === "checking";

  return (
    <section
      className={cn(
        "rounded-2xl border p-4 transition-all duration-300 sm:p-5",
        complete && "border-primary/25 bg-primary/[0.07]",
        active && !complete && "glass-strong border-primary/30",
        !active && !complete && "border-border bg-muted/15 opacity-70",
      )}
      aria-current={active ? "step" : undefined}
    >
      <div className="flex items-start gap-4">
        <StatusMark
          complete={complete}
          active={active}
          checking={checking}
          step={step}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Icon
              className={cn(
                "h-4 w-4",
                complete || active ? "text-primary" : "text-muted-foreground",
              )}
            />
            <h2
              className={cn(
                "font-medium",
                complete ? "text-primary" : "text-foreground",
              )}
            >
              {content.title}
            </h2>
            {complete && (
              <span className="ml-auto text-xs font-medium text-primary">
                Ready
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {content.description}
          </p>

          {active && !complete && (
            <div className="mt-4 space-y-3 animate-slide-down">
              {check.message && (
                <p
                  className={cn(
                    "rounded-xl border px-3 py-2 text-sm",
                    check.status === "failed"
                      ? "border-destructive/35 bg-destructive/15 text-destructive-foreground"
                      : "border-primary/20 bg-primary/10 text-foreground",
                  )}
                >
                  {check.message}
                </p>
              )}

              {check.id === "roblox-studio" && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => onAction("download-studio")}
                    disabled={busyAction !== null}
                    className="gap-2"
                  >
                    <Download className="h-4 w-4" />
                    Download Roblox Studio
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => onAction("recheck")}
                    disabled={busyAction !== null}
                    className="gap-2"
                  >
                    <RefreshCw className="h-4 w-4" />
                    I installed it
                  </Button>
                </div>
              )}

              {check.id === "bubbertron9001-plugin" && (
                <Button
                  onClick={() => onAction("install-plugin")}
                  disabled={busyAction !== null}
                  className="gap-2"
                >
                  {busyAction === "install-plugin" ? (
                    <Loader variant="circular" size="sm" />
                  ) : (
                    <PlugZap className="h-4 w-4" />
                  )}
                  {check.status === "warning"
                    ? "Update the B9 plugin"
                    : "Install it for me"}
                </Button>
              )}

              {check.id === "api-provider" && (
                <SettingsDialog>
                  <Button className="gap-2 glow-lime">
                    <Sparkles className="h-4 w-4" />
                    Sign in with ChatGPT
                  </Button>
                </SettingsDialog>
              )}

              {check.id === "studio-connection" && (
                <div className="space-y-4">
                  <ol className="space-y-2 text-sm text-muted-foreground">
                    <li className="flex gap-2">
                      <span className="font-semibold text-primary">1.</span>
                      Open a game in Roblox Studio.
                    </li>
                    <li className="flex gap-2">
                      <span className="font-semibold text-primary">2.</span>
                      Choose File → Experience Settings → Security, then turn on
                      Allow HTTP Requests.
                    </li>
                    <li className="flex gap-2">
                      <span className="font-semibold text-primary">3.</span>
                      Click bubbertron9001 in the Studio toolbar, then Connect.
                    </li>
                  </ol>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => onAction("open-studio")}
                      disabled={busyAction !== null}
                      className="gap-2"
                    >
                      <Play className="h-4 w-4" />
                      Open Roblox Studio
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => onAction("recheck")}
                      disabled={busyAction !== null}
                      className="gap-2"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Check connection
                    </Button>
                  </div>
                </div>
              )}

              {actionError && (
                <p className="text-sm text-destructive-foreground">
                  {actionError}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function PrereqWizard() {
  const {
    checks,
    isChecking,
    hasChecked,
    showWizard,
    runAllChecks,
    completeSetup,
    dismissWizard,
  } = usePrereqStore();
  const oauthAuth = useAuthStore((state) => state.oauthAuth);
  const openAIKey = useSettingsStore((state) => state.apiKeys.openai);
  const anthropicKey = useSettingsStore((state) => state.apiKeys.anthropic);
  const studioStatus = useRobloxStore((state) => state.status);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [installNotice, setInstallNotice] = useState<string | null>(null);
  const previousProvider = useRef(
    `${Boolean(oauthAuth)}:${Boolean(openAIKey)}:${Boolean(anthropicKey)}`,
  );

  useEffect(() => {
    void runAllChecks();
  }, [runAllChecks]);

  const providerSignature = `${Boolean(oauthAuth)}:${Boolean(openAIKey)}:${Boolean(anthropicKey)}`;
  useEffect(() => {
    if (previousProvider.current === providerSignature) return;
    previousProvider.current = providerSignature;
    if (showWizard && hasChecked) {
      void runAllChecks(true);
    }
  }, [hasChecked, providerSignature, runAllChecks, showWizard]);

  useEffect(() => {
    if (showWizard && hasChecked && studioStatus === "connected") {
      void runAllChecks(true);
    }
  }, [hasChecked, runAllChecks, showWizard, studioStatus]);

  const setupChecks = useMemo(
    () =>
      SETUP_STEP_IDS.map((id) => checks.find((check) => check.id === id)).filter(
        (check): check is PrereqCheck => Boolean(check),
      ),
    [checks],
  );
  const bridgeCheck = checks.find((check) => check.id === "bridge-server");
  const activeIndex = setupChecks.findIndex(
    (check) => check.status !== "passed",
  );
  const readyCount = setupChecks.filter(
    (check) => check.status === "passed",
  ).length;
  const allReady =
    setupChecks.length === SETUP_STEP_IDS.length &&
    readyCount === SETUP_STEP_IDS.length &&
    bridgeCheck?.status === "passed";

  const handleAction = async (action: string) => {
    setBusyAction(action);
    setActionError(null);
    if (action === "install-plugin") {
      setInstallNotice(null);
    }
    try {
      switch (action) {
        case "download-studio":
          await openUrl("https://create.roblox.com/docs/studio/setup");
          break;
        case "install-plugin":
          await invoke("install_plugin");
          setInstallNotice(
            "B9 was added to Studio. If Roblox Studio was already open, quit and reopen it before connecting.",
          );
          await runAllChecks(true);
          break;
        case "open-studio":
          await invoke("open_roblox_studio");
          break;
        case "restart-app":
          await invoke("restart_app");
          break;
        case "recheck":
          await runAllChecks(true);
          break;
      }
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setBusyAction(null);
    }
  };

  if (!showWizard) return null;

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-background">
      <AuroraBackground sparkleCount={24} />

      <header className="relative z-10 flex items-center justify-between px-5 py-4 sm:px-8">
        <Logo />
        <span className="text-sm text-muted-foreground">
          {readyCount} of {SETUP_STEP_IDS.length} ready
        </span>
      </header>

      <main className="relative z-10 mx-auto flex min-h-[calc(100vh-76px)] w-full max-w-3xl items-center px-5 py-8 sm:px-8">
        {allReady ? (
          <div className="mx-auto w-full max-w-xl text-center animate-pop-in">
            <div className="relative mx-auto mb-7 w-fit">
              <div className="absolute -inset-5 rounded-full bg-primary/15 blur-2xl" />
              <LogoMark className="relative h-28 w-28 glow-lime-strong" />
              <CheckCircle2 className="absolute -bottom-1 -right-1 h-9 w-9 rounded-full bg-background p-1 text-primary" />
            </div>
            <h1 className="text-4xl font-heading text-gradient-hero">
              You’re ready to build
            </h1>
            <p className="mx-auto mt-4 max-w-md text-muted-foreground">
              B9 is signed in, paired with Roblox Studio, and ready for your
              first mission.
            </p>
            <Button
              size="lg"
              onClick={completeSetup}
              className="mt-8 gap-2 rounded-xl px-8 glow-lime"
            >
              <Sparkles className="h-4 w-4" />
              Start building
            </Button>
          </div>
        ) : (
          <div className="w-full">
            <div className="mb-7 text-center animate-pop-in">
              <LogoMark className="mx-auto mb-5 h-20 w-20 glow-lime" />
              <h1 className="text-3xl font-heading text-gradient-hero sm:text-4xl">
                Let’s get B9 ready
              </h1>
              <p className="mx-auto mt-3 max-w-lg text-muted-foreground">
                Follow the big buttons below. B9 handles the technical parts—no
                Terminal commands needed.
              </p>
            </div>

            {bridgeCheck?.status === "failed" && (
              <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-destructive/35 bg-destructive/15 p-4 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <p className="font-medium text-destructive-foreground">
                    B9’s local connector did not start
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Restart the app, then B9 will check again automatically.
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => handleAction("restart-app")}
                  className="gap-2"
                >
                  <RotateCcw className="h-4 w-4" />
                  Restart B9
                </Button>
              </div>
            )}

            {installNotice && (
              <div className="mb-4 flex gap-3 rounded-2xl border border-primary/25 bg-primary/[0.08] p-4 text-sm">
                <PlugZap className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p>{installNotice}</p>
              </div>
            )}

            <div className="space-y-3">
              {setupChecks.map((check, index) => (
                <SetupStep
                  key={check.id}
                  check={check}
                  step={index + 1}
                  active={activeIndex === index}
                  busyAction={busyAction}
                  actionError={activeIndex === index ? actionError : null}
                  onAction={handleAction}
                />
              ))}
            </div>

            <div className="mt-6 flex flex-col-reverse items-center justify-between gap-3 sm:flex-row">
              <Button
                variant="ghost"
                onClick={dismissWizard}
                className="text-muted-foreground"
              >
                Finish setup later
              </Button>
              <Button
                variant="outline"
                onClick={() => handleAction("recheck")}
                disabled={isChecking || busyAction !== null}
                className="gap-2"
              >
                <RefreshCw
                  className={cn("h-4 w-4", isChecking && "animate-spin")}
                />
                Check again
              </Button>
            </div>
            <p className="mt-4 text-center text-xs text-muted-foreground">
              You can run this guide again anytime from Settings.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

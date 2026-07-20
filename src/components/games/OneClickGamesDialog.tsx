import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  Gamepad2,
  Layers3,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader } from "@/components/ui/loader";
import {
  gameBuilderService,
  type GameBuildDraft,
  type GameInstallResult,
  type GameMutationProgress,
  type GameRemovalResult,
  type GameVerificationResult,
  type ObbyGameOptions,
  type PreparedStudioGameBuild,
  type RemovalPlan,
} from "@/lib/games";
import { cn } from "@/lib/utils";

export interface OneClickGamesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studioConnected: boolean;
  onPlaytestFix?: () => void;
}

type Screen =
  | "configure"
  | "preparing"
  | "review"
  | "installing"
  | "verifying"
  | "ready"
  | "remove-confirm"
  | "removing"
  | "removed"
  | "error";

interface ReadySummary {
  alreadyInstalled: boolean;
  appliedOperations: number;
  verifiedChecks: number;
}

interface RemovalSummary {
  removedPaths: number;
  preservedPaths: number;
}

interface ErrorState {
  title: string;
  message: string;
  action: "prepare" | "install" | "verify" | "remove";
}

const DEFAULT_OPTIONS: ObbyGameOptions = {
  stages: 10,
  difficulty: "standard",
  visualStyle: "bright",
};

const STAGE_OPTIONS = [5, 10, 15] as const;
const DIFFICULTY_OPTIONS = [
  { value: "easy", label: "Easy" },
  { value: "standard", label: "Standard" },
  { value: "challenging", label: "Challenging" },
] as const;
const STYLE_OPTIONS = [
  { value: "bright", label: "Bright" },
  { value: "neon", label: "Neon" },
  { value: "nature", label: "Nature" },
] as const;

function errorText(error: unknown) {
  if (!(error instanceof Error)) {
    return "Something went wrong while talking to Roblox Studio.";
  }
  if (error.name === "AbortError") {
    return "The Studio check was stopped.";
  }
  return error.message;
}

function OptionGroup<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-3 gap-2">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
              className={cn(
                "min-h-10 rounded-xl border px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected
                  ? "border-primary/60 bg-primary/15 text-primary"
                  : "border-border/80 bg-card/30 text-muted-foreground hover:border-primary/30 hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function BusyView({
  title,
  description,
  reviewComplete = false,
  onStop,
  stopRequested = false,
}: {
  title: string;
  description: string;
  reviewComplete?: boolean;
  onStop?: () => void;
  stopRequested?: boolean;
}) {
  return (
    <div
      className="flex min-h-64 flex-col items-center justify-center px-4 py-10 text-center"
      role="status"
      aria-live="polite"
    >
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
        <Loader variant="circular" size="lg" />
      </div>
      <h3 className="font-heading text-lg font-semibold">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
      {onStop ? (
        <Button
          type="button"
          variant="outline"
          onClick={onStop}
          disabled={stopRequested}
          className="mt-5 min-w-32"
        >
          <Square className="h-3.5 w-3.5 fill-current" />
          {stopRequested ? "Stop requested" : "Stop"}
        </Button>
      ) : null}
      {reviewComplete ? (
        <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          Approved changes are locked while Studio installs and checks them
        </div>
      ) : null}
    </div>
  );
}

function mutationTitle(
  progress: GameMutationProgress | null,
  stopRequested: boolean,
  fallback: string,
) {
  if (progress?.phase === "may_complete") return "Studio may still finish"
  if (progress?.phase === "late_completed") return "Studio finished after Stop"
  if (progress?.phase === "readback" && stopRequested) return "Checking what changed"
  if (stopRequested || progress?.phase === "stop_requested") return "Stopping safely"
  return fallback
}

function ReviewCounts({ prepared }: { prepared: PreparedStudioGameBuild }) {
  const additions = prepared.changeSet.preview.additions;
  const remainingOperationIds = new Set(prepared.preflight.remainingOperationIds);
  const remainingOperations = prepared.preflight.status === "resume_available"
    ? prepared.changeSet.operations.filter((operation) => remainingOperationIds.has(operation.operationId))
    : null;
  const counts = [
    {
      label: "Instances",
      value: remainingOperations
        ? remainingOperations.filter((operation) => operation.type === "create_instance").length
        : additions.instances,
    },
    {
      label: "Properties",
      value: remainingOperations
        ? remainingOperations.filter((operation) => operation.type === "set_property").length
        : additions.properties,
    },
    {
      label: "Reviewed scripts",
      value: remainingOperations
        ? remainingOperations.filter((operation) => operation.type === "set_script_source").length
        : additions.scripts,
    },
  ];

  return (
    <div className="grid grid-cols-3 divide-x divide-border overflow-hidden rounded-xl border border-border/80 bg-card/30">
      {counts.map((count) => (
        <div key={count.label} className="px-3 py-3 text-center">
          <p className="text-lg font-semibold text-foreground">{count.value}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{count.label}</p>
        </div>
      ))}
    </div>
  );
}

function ConnectionWarning() {
  return (
    <p className="rounded-xl border border-destructive/30 bg-destructive/15 p-3 text-sm text-destructive-foreground">
      Reconnect Roblox Studio to continue.
    </p>
  );
}

function PathList({ paths }: { paths: readonly string[] }) {
  return (
    <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-border/80 bg-background/35 p-3">
      {paths.map((path) => (
        <code key={path} className="block break-all text-xs text-muted-foreground">
          {path}
        </code>
      ))}
    </div>
  );
}

export function OneClickGamesDialog({
  open,
  onOpenChange,
  studioConnected,
  onPlaytestFix,
}: OneClickGamesDialogProps) {
  const [screen, setScreen] = useState<Screen>("configure");
  const [options, setOptions] = useState<ObbyGameOptions>(DEFAULT_OPTIONS);
  const [draft, setDraft] = useState<GameBuildDraft | null>(null);
  const [prepared, setPrepared] = useState<PreparedStudioGameBuild | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [readySummary, setReadySummary] = useState<ReadySummary | null>(null);
  const [removalPlan, setRemovalPlan] = useState<RemovalPlan | null>(null);
  const [removalSummary, setRemovalSummary] = useState<RemovalSummary | null>(null);
  const [error, setError] = useState<ErrorState | null>(null);
  const [mutationProgress, setMutationProgress] = useState<GameMutationProgress | null>(null);
  const [stopRequested, setStopRequested] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const catalogEntry = useMemo(
    () => gameBuilderService.getCatalog().find((entry) => entry.id === "obby-starter"),
    [],
  );
  const mutationInProgress = screen === "installing" || screen === "removing";

  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  const beginRequest = () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    return controller;
  };

  const finishRequest = (controller: AbortController) => {
    if (controllerRef.current === controller) {
      controllerRef.current = null;
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && mutationInProgress) return;
    if (!nextOpen) controllerRef.current?.abort();
    onOpenChange(nextOpen);
  };

  const showPrepared = (nextPrepared: PreparedStudioGameBuild, nextNotice?: string) => {
    setPrepared(nextPrepared);
    setDraft(nextPrepared.draft);
    setNotice(nextNotice ?? null);
    setError(null);
    setScreen("review");
  };

  const showError = (nextError: ErrorState) => {
    setError(nextError);
    setScreen("error");
  };

  const handleReview = async () => {
    if (!studioConnected) return;
    setScreen("preparing");
    setNotice(null);
    setError(null);
    const nextDraft = gameBuilderService.createDraft({
      templateId: "obby-starter",
      options,
    });
    setDraft(nextDraft);
    const controller = beginRequest();
    try {
      const nextPrepared = await gameBuilderService.prepareAgainstStudio(
        nextDraft,
        controller.signal,
      );
      if (!controller.signal.aborted) showPrepared(nextPrepared);
    } catch (caught) {
      if (!controller.signal.aborted) {
        showError({
          title: "Couldn’t review this game",
          message: errorText(caught),
          action: "prepare",
        });
      }
    } finally {
      finishRequest(controller);
    }
  };

  const finishInstall = (result: GameInstallResult) => {
    setMutationProgress(null);
    setStopRequested(false);
    if (result.status === "blocked") {
      showPrepared(
        result.prepared,
        result.reason === "preview_changed"
          ? "Studio changed after this review. Check the refreshed changes before continuing."
          : "Studio found a conflict. Nothing was added.",
      );
      return;
    }

    if (result.status === "partial_failure") {
      const recovery = result.recovery ?? result.prepared;
      if (recovery) {
        const reconciliationNotice = result.reconciliation?.outcome === "late_completed"
          ? "Studio finished after you pressed Stop. B9 waited for it, then checked the place again."
          : result.reconciliation
            ? "The Stop request is settled and B9 checked the place again."
            : `Setup stopped during ${result.phase}. ${result.error}`;
        showPrepared(
          recovery,
          reconciliationNotice,
        );
        return;
      }
      showError({
        title: "Setup stopped",
        message: result.error,
        action: "install",
      });
      return;
    }

    const complete = result.postflight;
    setPrepared(complete);
    setDraft(complete.draft);
    setReadySummary({
      alreadyInstalled: result.status === "already_installed",
      appliedOperations: result.status === "installed"
        ? result.receipt.appliedOperationIds.length
        : 0,
      verifiedChecks: result.verification.verifiedAssertionIds.length,
    });
    setNotice(null);
    setScreen("ready");
  };

  const handleInstall = async () => {
    if (!studioConnected || !prepared) return;
    setScreen("installing");
    setNotice(null);
    setMutationProgress(null);
    setStopRequested(false);
    const controller = beginRequest();
    try {
      const result = await gameBuilderService.install(
        prepared.draft,
        prepared.changeSet.preview.fingerprint,
        controller.signal,
        (progress) => {
          setMutationProgress(progress);
          if (progress.phase === "stop_requested" || progress.phase === "may_complete") {
            setStopRequested(true);
          }
        },
      );
      finishInstall(result);
    } catch (caught) {
      showError({
        title: "Setup stopped",
        message: errorText(caught),
        action: "install",
      });
    } finally {
      finishRequest(controller);
    }
  };

  const finishVerification = (result: GameVerificationResult) => {
    if (result.status === "not_verified") {
      const recovery = result.recovery ?? result.prepared;
      if (recovery) {
        showPrepared(recovery, `The game needs attention. ${result.error}`);
        return;
      }
      showError({
        title: "Couldn’t check the game",
        message: result.error,
        action: "verify",
      });
      return;
    }

    setPrepared(result.postflight);
    setDraft(result.postflight.draft);
    setReadySummary({
      alreadyInstalled: true,
      appliedOperations: 0,
      verifiedChecks: result.verification.verifiedAssertionIds.length,
    });
    setNotice(null);
    setScreen("ready");
  };

  const handleVerify = async () => {
    if (!studioConnected || !prepared) return;
    setScreen("verifying");
    const controller = beginRequest();
    try {
      const result = await gameBuilderService.verify(prepared.draft, controller.signal);
      if (!controller.signal.aborted) finishVerification(result);
    } catch (caught) {
      if (!controller.signal.aborted) {
        showError({
          title: "Couldn’t check the game",
          message: errorText(caught),
          action: "verify",
        });
      }
    } finally {
      finishRequest(controller);
    }
  };

  const handleAskRemove = async () => {
    if (!prepared) return;
    try {
      const nextPlan = await gameBuilderService.planRemoval(
        prepared.changeSet,
        prepared.snapshot,
      );
      setRemovalPlan(nextPlan);
      setScreen("remove-confirm");
    } catch (caught) {
      showError({
        title: "Couldn’t prepare removal",
        message: errorText(caught),
        action: "remove",
      });
    }
  };

  const finishRemoval = (result: GameRemovalResult) => {
    setMutationProgress(null);
    setStopRequested(false);
    if (result.status === "removed") {
      setRemovalSummary({
        removedPaths: result.receipt.removed.length,
        preservedPaths: result.receipt.preserved.length,
      });
      setPrepared(null);
      setDraft(null);
      setRemovalPlan(null);
      setScreen("removed");
      return;
    }
    if (result.status === "already_removed") {
      setRemovalSummary({ removedPaths: 0, preservedPaths: 0 });
      setPrepared(null);
      setDraft(null);
      setRemovalPlan(null);
      setScreen("removed");
      return;
    }

    const recovery = result.status === "partial_failure"
      ? result.recovery ?? result.prepared
      : result.prepared;
    if (recovery) {
      setPrepared(recovery);
      setDraft(recovery.draft);
    }
    showError({
      title: result.status === "partial_failure"
        && result.reconciliation?.outcome === "late_completed"
        ? "Studio finished after Stop"
        : "Removal needs attention",
      message: result.status === "partial_failure" && result.reconciliation
        ? `${result.error} B9 waited for the operation to settle and checked Studio again.`
        : result.error,
      action: "remove",
    });
  };

  const handleRemove = async () => {
    const activeDraft = prepared?.draft ?? draft;
    if (!studioConnected || !activeDraft) return;
    setScreen("removing");
    setMutationProgress(null);
    setStopRequested(false);
    const controller = beginRequest();
    try {
      const result = await gameBuilderService.remove(
        activeDraft,
        controller.signal,
        (progress) => {
          setMutationProgress(progress);
          if (progress.phase === "stop_requested" || progress.phase === "may_complete") {
            setStopRequested(true);
          }
        },
      );
      finishRemoval(result);
    } catch (caught) {
      showError({
        title: "Removal needs attention",
        message: errorText(caught),
        action: "remove",
      });
    } finally {
      finishRequest(controller);
    }
  };

  const resetToConfigure = () => {
    setScreen("configure");
    setPrepared(null);
    setDraft(null);
    setNotice(null);
    setError(null);
    setReadySummary(null);
    setRemovalPlan(null);
    setRemovalSummary(null);
    setMutationProgress(null);
    setStopRequested(false);
  };

  const handleStopMutation = () => {
    const controller = controllerRef.current;
    if (!controller || controller.signal.aborted) return;
    setStopRequested(true);
    controller.abort();
  };

  const handlePlaytestFix = () => {
    handleOpenChange(false);
    onPlaytestFix?.();
  };

  const preflight = prepared?.preflight;
  const preview = prepared?.changeSet.preview;
  const blockingConflicts = preflight?.status === "blocked";
  const allConflicts = prepared
    ? [
        ...prepared.changeSet.preview.conflicts,
        ...prepared.preflight.conflicts.map((conflict) => conflict.message),
      ]
    : [];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="glass-strong max-h-[88vh] overflow-y-auto rounded-2xl border-primary/20 sm:max-w-2xl"
        showCloseButton={!mutationInProgress}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-heading text-xl">
            <Gamepad2 className="h-5 w-5 text-primary" />
            Starter games
          </DialogTitle>
          <DialogDescription>
            Build a complete starter inside the place currently open in Studio.
          </DialogDescription>
        </DialogHeader>

        {screen === "configure" ? (
          <div className="space-y-5 py-2">
            <div className="overflow-hidden rounded-2xl border border-primary/20 bg-primary/[0.06]">
              <div className="flex items-start gap-4 p-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                  <Layers3 className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-heading text-lg font-semibold">
                      {catalogEntry?.name ?? "Obby Starter"}
                    </h3>
                    <span className="rounded-full border border-border bg-background/40 px-2 py-0.5 text-[10px] text-muted-foreground">
                      v{catalogEntry?.version ?? "1.0.0"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Checkpoints, hazards, a finish, respawning, and a small progress display.
                  </p>
                </div>
              </div>
            </div>

            <OptionGroup
              label="Number of stages"
              value={options.stages}
              options={STAGE_OPTIONS.map((value) => ({ value, label: String(value) }))}
              onChange={(stages) => setOptions((current) => ({ ...current, stages }))}
            />
            <OptionGroup
              label="Difficulty"
              value={options.difficulty}
              options={DIFFICULTY_OPTIONS}
              onChange={(difficulty) => setOptions((current) => ({ ...current, difficulty }))}
            />
            <OptionGroup
              label="Visual style"
              value={options.visualStyle}
              options={STYLE_OPTIONS}
              onChange={(visualStyle) => setOptions((current) => ({ ...current, visualStyle }))}
            />

            {!studioConnected ? <ConnectionWarning /> : null}
            <Button
              type="button"
              onClick={() => void handleReview()}
              disabled={!studioConnected}
              className="w-full gap-2 rounded-xl glow-lime"
            >
              Review changes
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        ) : null}

        {screen === "preparing" ? (
          <BusyView
            title="Checking your place"
            description="B9 is looking for a safe open spot and checking for an earlier Obby Starter setup."
          />
        ) : null}

        {screen === "review" && prepared && preview && preflight ? (
          <div className="space-y-5 py-2">
            <div>
              <p className="text-sm font-medium">{preview.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{preview.summary}</p>
            </div>

            {notice ? (
              <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">
                {notice}
              </p>
            ) : null}

            {preflight.status === "resume_available" ? (
              <div className="flex gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3">
                <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                <div>
                  <p className="text-sm font-medium text-amber-100">Setup can resume</p>
                  <p className="mt-0.5 text-xs text-amber-200/80">
                    B9 found an unfinished Obby Starter and will add only the {preflight.remainingOperationIds.length} missing changes.
                  </p>
                </div>
              </div>
            ) : null}

            {preflight.status === "already_installed" ? (
              <div className="flex gap-3 rounded-xl border border-primary/30 bg-primary/10 p-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-medium">This starter is already in Studio</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Check every expected piece before playtesting, or remove only the generated game.
                  </p>
                </div>
              </div>
            ) : null}

            <ReviewCounts prepared={prepared} />

            <div className="flex flex-wrap gap-2">
              {preview.optionLabels.map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-border bg-card/40 px-2.5 py-1 text-xs text-muted-foreground"
                >
                  {label}
                </span>
              ))}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Studio locations</p>
              <div className="space-y-1 rounded-xl border border-border/80 bg-background/35 p-3">
                {preview.claimedPaths.map((path) => (
                  <code key={path} className="block break-all text-xs text-muted-foreground">
                    {path}
                  </code>
                ))}
              </div>
            </div>

            {allConflicts.length > 0 ? (
              <div className={cn(
                "space-y-2 rounded-xl border p-3",
                blockingConflicts
                  ? "border-destructive/35 bg-destructive/15"
                  : "border-amber-400/30 bg-amber-400/10",
              )}>
                <p className="flex items-center gap-2 text-sm font-medium">
                  <AlertTriangle className="h-4 w-4" />
                  {blockingConflicts ? "Conflicts must be cleared first" : "Recovery details"}
                </p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {allConflicts.map((conflict, index) => (
                    <li key={`${conflict}-${index}`}>• {conflict}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm text-primary">
                <ShieldCheck className="h-4 w-4" />
                No conflicts found. Existing unrelated work will stay untouched.
              </p>
            )}

            {!studioConnected ? <ConnectionWarning /> : null}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={resetToConfigure}>
                <ArrowLeft className="h-4 w-4" />
                Options
              </Button>
              {preflight.status === "already_installed" ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleAskRemove()}
                    disabled={!studioConnected}
                    className="text-brick hover:bg-destructive/15 hover:text-destructive-foreground"
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove generated game
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void handleVerify()}
                    disabled={!studioConnected}
                    className="rounded-xl"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    Check game
                  </Button>
                </>
              ) : null}
              {preflight.canInstall ? (
                <Button
                  type="button"
                  onClick={() => void handleInstall()}
                  disabled={!studioConnected}
                  className="rounded-xl glow-lime"
                >
                  {preflight.status === "resume_available" ? (
                    <RotateCcw className="h-4 w-4" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {preflight.status === "resume_available" ? "Resume setup" : "Generate game"}
                </Button>
              ) : null}
              {preflight.status === "blocked" ? (
                <Button
                  type="button"
                  onClick={() => void handleReview()}
                  disabled={!studioConnected}
                >
                  Check again
                </Button>
              ) : null}
            </DialogFooter>
          </div>
        ) : null}

        {screen === "installing" ? (
          <BusyView
            title={mutationTitle(
              mutationProgress,
              stopRequested,
              "Building and checking your game",
            )}
            description={mutationProgress?.message
              ?? "Studio is adding the approved Obby Starter, then B9 will read it back and check every required piece."}
            reviewComplete
            onStop={handleStopMutation}
            stopRequested={stopRequested}
          />
        ) : null}

        {screen === "verifying" ? (
          <BusyView
            title="Checking the generated game"
            description="B9 is checking every expected part, setting, and reviewed script in Studio."
          />
        ) : null}

        {screen === "ready" && prepared && readySummary ? (
          <div className="space-y-5 py-3">
            <div className="flex flex-col items-center py-4 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary glow-lime">
                <Check className="h-7 w-7" />
              </div>
              <h3 className="font-heading text-xl font-semibold">Ready to playtest</h3>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                {readySummary.alreadyInstalled
                  ? "Your Obby Starter was already installed and passed a fresh Studio check."
                  : "Your Obby Starter was installed and passed a complete Studio check."}
              </p>
            </div>

            <div className="flex items-center justify-center gap-6 rounded-xl border border-border/80 bg-card/30 px-4 py-3 text-center">
              {!readySummary.alreadyInstalled ? (
                <div>
                  <p className="font-semibold">{readySummary.appliedOperations}</p>
                  <p className="text-[11px] text-muted-foreground">Changes applied</p>
                </div>
              ) : null}
              <div>
                <p className="font-semibold">{readySummary.verifiedChecks}</p>
                <p className="text-[11px] text-muted-foreground">Checks passed</p>
              </div>
            </div>

            <div className="rounded-xl border border-primary/25 bg-primary/[0.07] p-4">
              <p className="text-sm font-medium">Next: try it in Studio</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Close this window, press Play in Roblox Studio, run through the course, then press Stop. Use Playtest &amp; Fix if anything feels wrong.
              </p>
            </div>

            <DialogFooter className="sm:flex-wrap">
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleAskRemove()}
                disabled={!studioConnected}
                className="text-brick hover:bg-destructive/15 hover:text-destructive-foreground"
              >
                <Trash2 className="h-4 w-4" />
                Remove generated game
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleOpenChange(false)}
              >
                Done
              </Button>
              {onPlaytestFix ? (
                <Button type="button" onClick={handlePlaytestFix} className="glow-lime">
                  <Gamepad2 className="h-4 w-4" />
                  Playtest &amp; Fix
                </Button>
              ) : null}
            </DialogFooter>
          </div>
        ) : null}

        {screen === "remove-confirm" && removalPlan ? (
          <div className="space-y-5 py-3">
            <div className="flex gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive/15 text-brick">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-heading text-lg font-semibold">Remove generated game?</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  B9 will remove only the {removalPlan.paths.length} paths owned by this Obby Starter. Unrelated Studio work stays untouched.
                </p>
              </div>
            </div>

            {removalPlan.paths.length > 0 ? (
              <PathList paths={removalPlan.paths} />
            ) : (
              <p className="rounded-xl border border-border p-3 text-sm text-muted-foreground">
                No generated paths remain to remove.
              </p>
            )}

            {removalPlan.preservedParentPaths.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {removalPlan.preservedParentPaths.length} customized generated parent {removalPlan.preservedParentPaths.length === 1 ? "path will" : "paths will"} be preserved:
                </p>
                <PathList paths={removalPlan.preservedParentPaths} />
              </div>
            ) : null}
            {!studioConnected ? <ConnectionWarning /> : null}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setScreen(readySummary ? "ready" : "review")}
              >
                Keep game
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void handleRemove()}
                disabled={
                  !studioConnected
                  || (
                    removalPlan.paths.length === 0
                    && removalPlan.preservedParentPaths.length === 0
                  )
                }
              >
                <Trash2 className="h-4 w-4" />
                Remove generated game
              </Button>
            </DialogFooter>
          </div>
        ) : null}

        {screen === "removing" ? (
          <BusyView
            title={mutationTitle(
              mutationProgress,
              stopRequested,
              "Removing the generated game",
            )}
            description={mutationProgress?.message
              ?? "Studio is removing only paths owned by this Obby Starter, then B9 will check what remains."}
            onStop={handleStopMutation}
            stopRequested={stopRequested}
          />
        ) : null}

        {screen === "removed" && removalSummary ? (
          <div className="flex min-h-64 flex-col items-center justify-center px-4 py-8 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <h3 className="font-heading text-xl font-semibold">Generated game removed</h3>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              {removalSummary.removedPaths > 0
                ? `${removalSummary.removedPaths} generated paths were removed${removalSummary.preservedPaths > 0 ? ` and ${removalSummary.preservedPaths} customized paths were preserved` : ""}.`
                : "The generated game had already been removed."}
            </p>
            <div className="mt-6 flex gap-2">
              <Button type="button" variant="outline" onClick={resetToConfigure}>
                Build another
              </Button>
              <Button type="button" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
            </div>
          </div>
        ) : null}

        {screen === "error" && error ? (
          <div className="space-y-5 py-4">
            <div className="flex gap-3 rounded-xl border border-destructive/35 bg-destructive/15 p-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-brick" />
              <div>
                <h3 className="font-heading text-lg font-semibold">{error.title}</h3>
                <p className="mt-1 break-words text-sm text-muted-foreground">{error.message}</p>
              </div>
            </div>
            {!studioConnected ? <ConnectionWarning /> : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={resetToConfigure}>
                Back to options
              </Button>
              {prepared && error.action === "remove" ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleAskRemove()}
                  disabled={!studioConnected}
                >
                  Review removal
                </Button>
              ) : null}
              {error.action !== "remove" ? (
                <Button
                  type="button"
                  onClick={() => void handleReview()}
                  disabled={!studioConnected}
                >
                  Try again
                </Button>
              ) : null}
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

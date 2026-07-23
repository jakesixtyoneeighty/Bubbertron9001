import { useState, useCallback, useEffect, useRef } from "react";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputActions,
  PromptInputAction,
} from "@/components/ui/prompt-input";
import { Button } from "@/components/ui/button";
import { PromptSuggestion } from "@/components/ui/prompt-suggestion";
import {
  ChatContainerRoot,
  ChatContainerContent,
} from "@/components/ui/chat-container";
import { ScrollButton } from "@/components/ui/scroll-button";
import { Message, MessageContent } from "@/components/ui/message";
import { ToolCalls } from "@/components/ui/tool-call";
import { Loader } from "@/components/ui/loader";
import { Logo, LogoMark } from "@/components/icons/Logo";
import { BotAvatar, UserAvatar } from "@/components/icons/Avatars";
import { Icon } from "@/components/icons/Icon";
import { ModelSelector } from "@/components/chat/ModelSelector";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { ContextChips, ChipAction } from "@/components/chat/ContextChips";
import { QuestionPrompt } from "@/components/chat/QuestionPrompt";
import { InstancePicker } from "@/components/chat/InstancePicker";
import { PlanView } from "@/components/chat/PlanView";
import { UserPrompt } from "@/components/chat/UserPrompt";
import { SourceList } from "@/components/chat/SourceList";
import { ChatModeToggle } from "@/components/chat/ChatModeToggle";
import { ConversationHistory } from "@/components/chat/ConversationHistory";
import { PlaytestFix, PLAYTEST_FIX_PROMPT } from "@/components/chat/PlaytestFix";
import { OneClickGamesButton } from "@/components/games/OneClickGamesButton";
import { ChatActions } from "@/components/QuickActions";
import { CommandPalette } from "@/components/CommandPalette";
import { EmptyState } from "@/components/EmptyState";
import { useChatStore } from "@/stores/chat";
import { useSettingsStore } from "@/stores/settings";
import { useRobloxStore, ConnectionStatus } from "@/stores/roblox";
import { usePluginStore } from "@/stores/plugin";
import { useAuthStore } from "@/stores/auth";
import { useChat } from "@/lib/ai/providers";
import {
  cancelPendingQuestions,
  setAskUserHandler,
} from "@/lib/roblox/questions";
import { useAgentStore } from "@/stores/agent";
import { isAbortError } from "@/lib/ai/errors";
import {
  completedTaskMessage,
  failedTaskMessage,
} from "@/lib/ai/task-status-message";
import { BRAND } from "@/config/brand";
import { useAppShortcuts } from "@/hooks/useKeyboardShortcuts";
import { improvePrompt } from "@/lib/ai/prompt-improver";
import { downloadPairedStudioPlugin } from "@/lib/plugin-download";
import { cn } from "@/lib/utils";
import { playSound, isMuted, toggleMuted } from "@/lib/sounds";
import { AuroraBackground } from "@/components/effects/AuroraBackground";
import { ConfettiBurst } from "@/components/effects/ConfettiBurst";
import { ArrowUp, Square, CheckCircle2, Download, FolderOpen, RefreshCw, Box, FileText, Globe, Play, ListTodo, Sparkles, Volume2, VolumeX } from "lucide-react";

const SUGGESTIONS = [
  // Gameplay systems
  "Create an NPC that follows players",
  "Add a currency system with DataStore",
  "Make a gun that shoots projectiles",
  "Design a shop GUI with items",
  "Build a checkpoint system for an obby",
  "Create a leaderboard that saves scores",
  "Make doors that require keys to open",
  "Add a day/night cycle with lighting",
  // UI & Effects
  "Design a main menu with play button",
  "Create floating damage numbers",
  "Add a health bar above players",
  "Make a settings menu with sound toggle",
  // Mechanics
  "Create a sprinting system with stamina",
  "Add double jump ability",
  "Make a grappling hook tool",
  "Build a vehicle spawner",
  // World building
  "Find free models for a forest scene",
  "Create a teleporter between areas",
  "Add ambient sounds to the game",
  "Make parts that change color on touch",
  // Advanced
  "Set up a round-based game system",
  "Create an inventory system",
  "Add achievements that unlock badges",
  "Build a trading system between players",
];

const ASK_SUGGESTIONS = [
  "How should I structure a round-based game?",
  "Explain RemoteEvents like I'm new to Roblox",
  "What makes an obby feel fun and fair?",
  "Help me think through a game idea",
  "What's the difference between server and client scripts?",
  "How can I make my game work well on mobile?",
];

// Mute/unmute button for the synthesized sound effects
function SoundToggle() {
  const [muted, setMutedState] = useState(isMuted());

  const handleToggle = () => {
    const nowMuted = toggleMuted();
    setMutedState(nowMuted);
    if (!nowMuted) playSound("click");
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        "h-8 w-8 rounded-lg transition-all",
        muted
          ? "text-muted-foreground hover:text-foreground"
          : "text-primary hover:bg-primary/15 animate-wiggle-hover"
      )}
      onClick={handleToggle}
      title={muted ? "Turn sounds on" : "Turn sounds off"}
    >
      {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
    </Button>
  );
}

// Step indicator for connection flow
function ConnectionStep({ 
  step, 
  title, 
  description, 
  status 
}: { 
  step: number;
  title: string;
  description: string;
  status: "pending" | "active" | "complete";
}) {
  return (
    <div className="flex items-start gap-4">
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all",
            status === "complete" && "bg-primary/20 text-primary glow-lime",
            status === "active" && "bg-primary/10 text-primary animate-glow",
            status === "pending" && "bg-muted text-muted-foreground"
          )}
        >
          {status === "complete" ? (
            <CheckCircle2 className="w-5 h-5" />
          ) : status === "active" ? (
            <Loader variant="circular" size="sm" />
          ) : (
            step
          )}
        </div>
      </div>
      <div className="flex-1 pt-1">
        <h3 className={cn(
          "font-medium",
          status === "complete" && "text-primary",
          status === "active" && "text-foreground",
          status === "pending" && "text-muted-foreground"
        )}>
          {title}
        </h3>
        <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
      </div>
    </div>
  );
}

// Connection screen shown when bridge is not connected
function ConnectionScreen({
  status,
  onContinueOffline,
}: {
  status: ConnectionStatus;
  onContinueOffline: () => void;
}) {
  const { 
    status: pluginStatus, 
    isChecking, 
    isInstalling, 
    checkPlugin, 
    installPlugin 
  } = usePluginStore();
  
  const [installMessage, setInstallMessage] = useState<string | null>(null);
  const [showManualPath, setShowManualPath] = useState(false);

  // Check plugin status on mount
  useEffect(() => {
    checkPlugin();
  }, [checkPlugin]);

  const handleInstallPlugin = async () => {
    try {
      const result = await installPlugin();
      setInstallMessage(result.message);
    } catch (error) {
      setInstallMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleDownloadPlugin = async () => {
    try {
      const filename = await downloadPairedStudioPlugin();
      setShowManualPath(true);
      setInstallMessage(
        `${filename} downloaded with this app's secure pairing. Move it to the Plugins folder below, then restart Roblox Studio.`
      );
    } catch (error) {
      setShowManualPath(false);
      setInstallMessage(
        `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  const getStepStatus = (step: 1 | 2 | 3): "pending" | "active" | "complete" => {
    if (status === "connected") return "complete";
    if (status === "bridge_only") {
      if (step === 1) return "complete";
      if (step === 2) return "active";
      return "pending";
    }
    // disconnected
    if (step === 1) return "active";
    return "pending";
  };

  const pluginInstalled = pluginStatus?.installed && pluginStatus?.is_current_version;

  return (
    <div className="h-screen flex flex-col bg-background relative">
      <AuroraBackground />
      {/* Minimal header */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4">
        <Logo />
        <div className="flex items-center gap-2">
          <SoundToggle />
          <SettingsDialog />
        </div>
      </header>

      {/* Centered content */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 pb-24">
        <div className="w-full max-w-md space-y-6 animate-pop-in">
          {/* Main heading */}
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-3xl bg-primary/10 mb-4 animate-glow animate-float glow-lime">
              <Loader variant="wave" size="lg" />
            </div>
            <h1 className="text-2xl font-heading text-gradient-hero">
              Connecting to Roblox Studio
            </h1>
            <div className="text-muted-foreground">
              <Loader variant="terminal" text="Waiting for connection" size="sm" />
            </div>
          </div>

          {/* Connection steps */}
          <div className="glass rounded-2xl p-6 space-y-6">
            <ConnectionStep
              step={1}
              title={`Start ${BRAND.name} Desktop`}
              description="The bridge server starts automatically with this app"
              status={getStepStatus(1)}
            />
            
            <div className="border-l-2 border-dashed border-border ml-4 h-4" />
            
            <ConnectionStep
              step={2}
              title="Open Roblox Studio"
              description="Launch Roblox Studio and open your project"
              status={getStepStatus(2)}
            />
            
            <div className="border-l-2 border-dashed border-border ml-4 h-4" />
            
            <ConnectionStep
              step={3}
              title={`Connect ${BRAND.name} Bridge`}
              description={`Click Connect in the ${BRAND.name} plugin toolbar`}
              status={getStepStatus(3)}
            />
          </div>

          {/* Plugin Installation Card */}
          <div className="glass rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">Plugin Status</span>
                {isChecking ? (
                  <Loader variant="circular" size="sm" />
                ) : pluginInstalled ? (
                  <span className="flex items-center gap-1 text-xs text-primary bg-primary/15 px-2 py-0.5 rounded-full">
                    <CheckCircle2 className="w-3 h-3" />
                    Installed
                  </span>
                ) : pluginStatus?.installed ? (
                  <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">
                    Update Available
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    Not Installed
                  </span>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => checkPlugin()}
                disabled={isChecking}
              >
                <RefreshCw className={cn("w-4 h-4", isChecking && "animate-spin")} />
              </Button>
            </div>

            {/* Install Message */}
            {installMessage && (
              <p className={cn(
                "text-sm p-2 rounded-lg",
                installMessage.startsWith("Error")
                  ? "bg-destructive/15 text-red-300"
                  : "bg-primary/15 text-primary"
              )}>
                {installMessage}
              </p>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2">
              <Button
                onClick={handleInstallPlugin}
                disabled={isInstalling || (pluginInstalled ?? false)}
                className="flex-1"
              >
                {isInstalling ? (
                  <>
                    <Loader variant="circular" size="sm" className="mr-2" />
                    Installing...
                  </>
                ) : pluginInstalled ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Up to Date
                  </>
                ) : pluginStatus?.installed ? (
                  <>
                    <Download className="w-4 h-4 mr-2" />
                    Update Plugin
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-2" />
                    Install Automatically
                  </>
                )}
              </Button>
              
              <Button
                variant="outline"
                onClick={handleDownloadPlugin}
                title="Download securely paired plugin for manual installation"
              >
                <FolderOpen className="w-4 h-4 mr-2" />
                Download Paired
              </Button>
            </div>

            {/* Manual path info */}
            {showManualPath && pluginStatus && (
              <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3 space-y-1">
                <p className="font-medium text-foreground">Manual Installation:</p>
                <p>Move the downloaded paired plugin to your Roblox Plugins folder:</p>
                <code className="block bg-background px-2 py-1 rounded text-xs break-all">
                  {pluginStatus.plugins_folder}
                </code>
              </div>
            )}
          </div>

          <Button
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={onContinueOffline}
          >
            Continue in research mode
          </Button>
        </div>
      </main>
    </div>
  );
}

// Status badge for the header
function StatusBadge({ status }: { status: ConnectionStatus }) {
  const config = {
    disconnected: {
      color: "bg-studio-disconnected",
      ping: false,
      label: "Offline",
    },
    bridge_only: {
      color: "bg-amber-400",
      ping: true,
      label: "Waiting",
    },
    connected: {
      color: "bg-primary",
      ping: true,
      label: "Connected",
    },
  };

  const { color, ping, label } = config[status];

  return (
    <div
      className={cn(
        "flex items-center gap-2 text-sm px-2 sm:px-3 py-1 rounded-full border transition-colors",
        status === "connected"
          ? "text-primary border-primary/30 bg-primary/10"
          : "text-muted-foreground border-border bg-muted/30"
      )}
    >
      <span className="relative flex w-2 h-2">
        {ping && (
          <span
            className={cn(
              "absolute inline-flex w-full h-full rounded-full opacity-75",
              color
            )}
            style={{ animation: "status-ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite" }}
          />
        )}
        <span className={cn("relative inline-flex w-2 h-2 rounded-full", color)} />
      </span>
      <span className="hidden md:inline">{label}</span>
    </div>
  );
}

export function Home() {
  const [input, setInput] = useState("");
  const [activeChips, setActiveChips] = useState<ChipAction[]>([]);
  const [isImproving, setIsImproving] = useState(false);
  const [workOffline, setWorkOffline] = useState(false);
  const [displayedSuggestions, setDisplayedSuggestions] = useState<string[]>([]);
  const [confettiTrigger, setConfettiTrigger] = useState(0);
  const {
    messages,
    mode,
    isStreaming,
    error,
    pendingQuestion,
    addMessage,
    updateMessage,
    editMessageAndTruncate,
    addToolCall,
    updateToolCall,
    addSource,
    setStreaming,
    setError,
    setPendingQuestion,
    setQuestionResolver,
    answerQuestion,
    clearMessages,
    setMode,
  } = useChatStore();
  const agentPlan = useAgentStore((state) => state.plan);
  const { hasApiKey } = useSettingsStore();
  const hasOAuthSession = useAuthStore((state) =>
    state.isOAuthAuthenticated()
  );
  const { status: studioStatus, startPolling } = useRobloxStore();
  const { sendMessage } = useChat();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Keyboard shortcuts
  useAppShortcuts({
    onClearChat: () => {
      if (messages.length > 0 && !isStreaming) {
        clearMessages();
      }
    },
    onFocusInput: () => {
      inputRef.current?.focus();
    },
  });

  // Start polling for connection on mount
  useEffect(() => {
    const cleanup = startPolling();
    return cleanup;
  }, [startPolling]);

  // Once the workspace has opened, keep research mode available if Studio drops.
  useEffect(() => {
    if (studioStatus === "connected") {
      setWorkOffline(true);
      playSound("connect");
      setConfettiTrigger((n) => n + 1);
    }
  }, [studioStatus]);

  // Shuffle suggestions for the active mode and refresh them for a new chat.
  useEffect(() => {
    const shuffled = [...(mode === "ask" ? ASK_SUGGESTIONS : SUGGESTIONS)].sort(
      () => Math.random() - 0.5,
    );
    setDisplayedSuggestions(shuffled.slice(0, 4));
  }, [messages.length === 0, mode]);

  // Set up the ask_user handler
  useEffect(() => {
    setAskUserHandler((questions) => {
      return new Promise((resolve) => {
        setPendingQuestion({
          id: crypto.randomUUID(),
          toolCallId: "",
          messageId: "",
          questions,
        });
        setQuestionResolver(resolve);
      });
    });

    return () => {
      setAskUserHandler(null);
      cancelPendingQuestions("bubbertron9001 closed the question");
    };
  }, [setPendingQuestion, setQuestionResolver]);

  const hasConfiguredProvider =
    hasApiKey("openai") || hasApiKey("anthropic") || hasOAuthSession;
  const isConnected = studioStatus === "connected";

  // Improve prompt handler
  const handleImprovePrompt = useCallback(async () => {
    if (!input.trim() || isImproving || isStreaming) return;

    setIsImproving(true);
    try {
      const result = await improvePrompt(input);
      if (result.improved && result.improved !== input) {
        setInput(result.improved);
      }
      if (result.error) {
        console.warn("[Home] Prompt improvement error:", result.error);
      }
    } catch (err) {
      console.error("[Home] Failed to improve prompt:", err);
    } finally {
      setIsImproving(false);
    }
  }, [input, isImproving, isStreaming]);

  const handleSubmit = useCallback(async (
    override?: string,
    editedMessageId?: string,
  ) => {
    const submittedInput = typeof override === "string" ? override : input;
    if (!submittedInput.trim() || isStreaming) return;

    const userMessage = submittedInput.trim();
    const editedMessageIndex = editedMessageId
      ? messages.findIndex((message) => message.id === editedMessageId)
      : -1;
    if (editedMessageId && editedMessageIndex < 0) return;
    const editedMessage = editedMessageIndex >= 0
      ? messages[editedMessageIndex]
      : undefined;
    const requestChips = editedMessageId
      ? ([...(editedMessage?.contextChips ?? [])] as ChipAction[])
      : [...activeChips];
    const conversationHistory = editedMessageIndex >= 0
      ? messages.slice(0, editedMessageIndex)
      : messages;

    // Build context prefix based on active chips
    const prefixes: string[] = [];
    if (requestChips.includes("docs")) {
      prefixes.push("[Search Roblox documentation first]");
    }
    if (requestChips.includes("web")) {
      prefixes.push("[Search the web for information]");
    }
    if (mode === "build" && requestChips.includes("search-models")) {
      prefixes.push("[Search the Creator Store for free models if needed]");
    }
    if (mode === "build" && requestChips.includes("plan")) {
      prefixes.push("[Create a detailed plan before making changes]");
    }
    const chipContext = prefixes.join(" ");
    const fullMessage = chipContext ? `${chipContext}\n\n${userMessage}` : userMessage;

    setInput("");
    if (!editedMessageId) setActiveChips([]);
    playSound("send");

    console.log("[Home] Submitting message:", userMessage, "with context:", chipContext);

    if (editedMessageId) {
      editMessageAndTruncate(editedMessageId, userMessage);
    } else {
      // Show context as chips in the UI while sending the expanded prompt.
      addMessage({
        role: "user",
        content: userMessage,
        contextChips: requestChips.length > 0 ? requestChips : undefined,
      });
    }

    // Add placeholder for assistant
    const assistantId = addMessage({ role: "assistant", content: "" });

    setStreaming(true);
    setError(null);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const chatMessages = [
        ...conversationHistory.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        { role: "user" as const, content: fullMessage },
      ];

      console.log("[Home] Sending", chatMessages.length, "messages to AI");

      let fullText = "";

      await sendMessage(chatMessages, {
        onToken: (token) => {
          fullText += token;
          updateMessage(assistantId, fullText);
        },
        onToolCall: (toolCall) => {
          console.log("[Home] Tool call received:", toolCall.name);
          playSound("tool");
          // Add tool call to the assistant message
          addToolCall(assistantId, {
            id: toolCall.id,
            name: toolCall.name,
            args: toolCall.input,
          });
          // Mark it as running
          updateToolCall(assistantId, toolCall.id, { status: "running" });
        },
        onToolResult: (toolResult) => {
          console.log("[Home] Tool result received:", toolResult.id);
          playSound("toolDone");
          // Update the tool call with the result
          updateToolCall(assistantId, toolResult.id, {
            status: "complete",
            result: toolResult.output,
          });
        },
        onToolError: (toolError) => {
          console.error(
            "[Home] Tool error received:",
            toolError.name,
            toolError.error
          );
          playSound("error");
          updateToolCall(assistantId, toolError.id, {
            status: "error",
            error: toolError.error,
          });
          useAgentStore.getState().setPhase("repairing");
        },
        onSource: (source) => {
          addSource(assistantId, source);
        },
        onFinish: () => {
          console.log("[Home] Stream finished, total length:", fullText.length);
          playSound("receive");
          let agent = useAgentStore.getState();
          if (!agent.plan && agent.phase !== "completed") {
            agent.completeRun("Response completed");
            agent = useAgentStore.getState();
          }
          if (!fullText.trim()) {
            updateMessage(
              assistantId,
              completedTaskMessage({
                summary: agent.plan?.completionSummary,
                verification: agent.plan?.verification,
              }),
            );
          }
        },
        onError: (error) => {
          if (!isAbortError(error)) {
            console.error("[Home] Stream error:", error);
            playSound("error");
            setError(error.message);
            updateMessage(assistantId, failedTaskMessage(error.message));
            useAgentStore.getState().failRun(error.message);
          }
        },
        signal: controller.signal,
        mode,
        forcePlan: mode === "build" && requestChips.includes("plan"),
        forceWebSearch:
          requestChips.includes("web") || requestChips.includes("docs"),
        officialDocsOnly:
          requestChips.includes("docs") && !requestChips.includes("web"),
      });
    } catch (error) {
      if (!isAbortError(error)) {
        console.error("[Home] Chat error:", error);
        const message = error instanceof Error ? error.message : String(error);
        setError(message);
        useAgentStore.getState().failRun(message);
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setStreaming(false);
    }
  }, [
    input,
    isStreaming,
    messages,
    activeChips,
    mode,
    addMessage,
    updateMessage,
    editMessageAndTruncate,
    addToolCall,
    updateToolCall,
    addSource,
    setStreaming,
    setError,
    sendMessage,
  ]);

  const handleSuggestionClick = (suggestion: string) => {
    playSound("click");
    setInput(suggestion);
  };

  const handleChipClick = (chipId: ChipAction) => {
    playSound("click");
    // Toggle chip
    setActiveChips(prev =>
      prev.includes(chipId)
        ? prev.filter(c => c !== chipId)
        : [...prev, chipId]
    );

    // For "run-code" chip, pre-fill input template
    if (chipId === "run-code" && !activeChips.includes(chipId)) {
      setInput(prev => prev || "Run this code in Studio:\n```lua\n\n```");
    }
  };

  const handleModeChange = (nextMode: "ask" | "build") => {
    playSound("click");
    setMode(nextMode);
    setActiveChips((current) =>
      nextMode === "ask"
        ? current.filter((chip) => chip === "docs" || chip === "web")
        : current,
    );
    useAgentStore.getState().reset();
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    cancelPendingQuestions("Agent run stopped by the user");
    setPendingQuestion(null);
    setQuestionResolver(null);
    useAgentStore.getState().cancelRun();
    setStreaming(false);
  };

  // Show connection screen if not connected
  if (!isConnected && !workOffline) {
    return (
      <ConnectionScreen
        status={studioStatus}
        onContinueOffline={() => setWorkOffline(true)}
      />
    );
  }

  // Empty state - show centered input (connected but no messages)
  if (messages.length === 0) {
    return (
      <div className="h-screen flex flex-col bg-background relative">
        <AuroraBackground />
        {/* Header */}
        <header className="relative z-10 flex items-center justify-between px-3 sm:px-6 py-4 border-b glass-bar">
          <Logo className="gap-2 [&>span]:text-lg sm:[&>span]:text-2xl" />
          <div className="flex items-center gap-1 sm:gap-3">
            <ConversationHistory disabled={isStreaming} />
            <StatusBadge status={studioStatus} />
            <SoundToggle />
            <SettingsDialog />
          </div>
        </header>

        {!isConnected && (
          <div className="relative z-10 border-b border-amber-400/20 bg-amber-400/10 px-4 py-2 text-center text-sm text-amber-300">
            {mode === "ask"
              ? "Ask mode — talk things through without changing Studio."
              : "Research mode — web, documentation, planning, and skills are available; Studio editing is paused."}
          </div>
        )}

        {/* Centered content */}
        <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 pb-24">
          <div className="w-full max-w-2xl space-y-8">
            {/* Welcome message */}
            <div className="text-center space-y-4 animate-pop-in">
              <div className="inline-flex animate-float">
                <LogoMark className="w-24 h-24 glow-lime" />
              </div>
              <h1 className="text-4xl font-heading text-gradient-hero">
                {mode === "ask" ? "Let's talk Roblox" : "Let's build some cool shit!"}
              </h1>
              <p className="text-muted-foreground max-w-md mx-auto">
                {mode === "ask"
                  ? "Ask questions, explore ideas, or talk through code. B9 won't change Studio until you switch to Build."
                  : "Meet B9, your Roblox master builder. He's a beast. Drop your ideas below — scripts, systems, GUIs, the whole world. If it can be built, B9 can build it."}
              </p>
            </div>

            {/* Input */}
            <div className="space-y-3 animate-slide-up stagger-2">
              <ContextChips
                onChipClick={handleChipClick}
                activeChips={activeChips}
                disabled={isStreaming || !hasConfiguredProvider}
                visibleChips={mode === "ask" ? ["docs", "web"] : undefined}
              />
              <PromptInput
                value={input}
                onValueChange={setInput}
                onSubmit={() => void handleSubmit()}
                isLoading={isStreaming}
                className={cn(
                  "rounded-2xl glass-strong transition-shadow duration-300 focus-within:glow-lime",
                  isImproving && "relative overflow-hidden"
                )}
              >
                {/* Skeleton shimmer overlay when improving */}
                {isImproving && (
                  <div className="absolute inset-0 pointer-events-none z-10">
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/25 to-transparent animate-shimmer" />
                  </div>
                )}
                <PromptInputTextarea
                  placeholder={
                    isImproving
                      ? "Powering up your prompt..."
                      : hasConfiguredProvider
                        ? mode === "ask"
                          ? "Talk through an idea or ask a question..."
                          : "Tell B9 what you want to build..."
                        : "Configure an API key in settings to start..."
                  }
                  disabled={!hasConfiguredProvider || isImproving}
                  className={cn(
                    "min-h-[60px] text-base text-cream placeholder:text-muted-foreground",
                    isImproving && "opacity-60"
                  )}
                />
                <PromptInputActions className="justify-between px-3 py-2">
                  <div className="flex items-center gap-1">
                    <PromptInputAction tooltip="Attach file">
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" disabled>
                        <Icon name="link" size="sm" />
                      </Button>
                    </PromptInputAction>
                    {mode === "build" && (
                      <InstancePicker
                        onSelect={(path) => setInput((prev) => prev + `@${path} `)}
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <ChatModeToggle
                      mode={mode}
                      onChange={handleModeChange}
                      disabled={isStreaming}
                    />
                    <div className="hidden sm:block">
                      <ModelSelector disabled={!hasConfiguredProvider} />
                    </div>
                    {/* Improve Prompt Button */}
                    <PromptInputAction
                      tooltip={`Improve prompt for ${BRAND.name}`}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                          "h-8 w-8 rounded-lg transition-all",
                          isImproving && "animate-pulse",
                          input.trim() && !isImproving && !isStreaming && "text-primary hover:text-primary hover:bg-primary/15"
                        )}
                        onClick={handleImprovePrompt}
                        disabled={!input.trim() || isImproving || isStreaming || !hasConfiguredProvider}
                      >
                        {isImproving ? (
                          <Loader variant="circular" size="sm" />
                        ) : (
                          <Sparkles className="h-4 w-4" />
                        )}
                      </Button>
                    </PromptInputAction>
                    <Button
                      size="icon"
                      className={cn(
                        "h-9 w-9 rounded-xl",
                        input.trim() && !isStreaming && hasConfiguredProvider && "send-ready"
                      )}
                      onClick={() => void handleSubmit()}
                      disabled={!input.trim() || isStreaming || !hasConfiguredProvider}
                    >
                      {isStreaming ? (
                        <Square className="h-4 w-4 fill-current" />
                      ) : (
                        <ArrowUp className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </PromptInputActions>
              </PromptInput>
            </div>

            {/* Suggestions */}
            <div className="flex flex-wrap justify-center gap-2 animate-slide-up stagger-3">
              {displayedSuggestions.map((suggestion, i) => (
                <PromptSuggestion
                  key={suggestion}
                  onClick={() => handleSuggestionClick(suggestion)}
                  className={cn(
                    "h-auto min-h-10 max-w-full whitespace-normal px-4 py-2 text-center",
                    `stagger-${(i % 5) + 1}`,
                  )}
                >
                  {suggestion}
                </PromptSuggestion>
              ))}
            </div>

            {mode === "build" && (
              <div className="flex flex-wrap justify-center gap-2 animate-slide-up stagger-4">
                <OneClickGamesButton
                  studioConnected={isConnected}
                  disabled={isStreaming}
                  onPlaytestFix={() => void handleSubmit(PLAYTEST_FIX_PROMPT)}
                />
                <PlaytestFix
                  onAnalyze={(prompt) => void handleSubmit(prompt)}
                  disabled={isStreaming || !hasConfiguredProvider}
                  studioConnected={isConnected}
                />
              </div>
            )}

            {/* Not configured warning */}
            {!hasConfiguredProvider && (
              <div className="text-center animate-fade-in">
                <p className="text-sm text-amber-300">
                  <Icon name="key" size="sm" className="inline mr-1" />
                  Sign in with ChatGPT or add an API key.{" "}
                  <SettingsDialog>
                    <button className="underline hover:no-underline text-primary">
                      Open settings
                    </button>
                  </SettingsDialog>{" "}
                  to get started.
                </p>
              </div>
            )}
          </div>
        </main>
        <ConfettiBurst trigger={confettiTrigger} />
      </div>
    );
  }

  // Chat view
  return (
    <div className="h-screen flex flex-col bg-background relative">
      <AuroraBackground />
      <ConfettiBurst trigger={confettiTrigger} />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-3 sm:px-6 py-3 border-b glass-bar">
        <div className="flex items-center gap-2 sm:gap-3">
          <ConversationHistory disabled={isStreaming} />
          <LogoMark className="w-8 h-8 rounded-xl glow-lime" />
          <span className="hidden text-lg font-logo tracking-tight sm:inline">{BRAND.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={studioStatus} />
          <div className="h-4 w-px bg-border mx-1" />
          <div className="hidden sm:block">
            <SoundToggle />
          </div>
          {mode === "build" && (
            <div className="hidden items-center gap-2 lg:flex">
              <OneClickGamesButton
                compact
                studioConnected={isConnected}
                disabled={isStreaming}
                onPlaytestFix={() => void handleSubmit(PLAYTEST_FIX_PROMPT)}
              />
              <PlaytestFix
                compact
                onAnalyze={(prompt) => void handleSubmit(prompt)}
                disabled={isStreaming || !hasConfiguredProvider}
                studioConnected={isConnected}
              />
            </div>
          )}
          <ChatActions
            onClear={() => {
              playSound("click");
              clearMessages();
            }}
            disabled={messages.length === 0 || isStreaming}
          />
          <SettingsDialog />
        </div>
      </header>

      {!isConnected && (
        <div className="relative z-10 border-b border-amber-400/20 bg-amber-400/10 px-4 py-2 text-center text-sm text-amber-300">
          {mode === "ask"
            ? "Ask mode — talk things through without changing Studio."
            : "Research mode — Studio editing tools will resume after the bridge reconnects."}
        </div>
      )}

      {/* Chat messages */}
      <ChatContainerRoot className="relative z-10 flex-1">
        <ChatContainerContent className="max-w-3xl mx-auto px-4 py-6 space-y-6">
          {/* Error alert */}
          {error && (
            <div className="bg-destructive/15 border border-destructive/40 text-red-200 rounded-xl p-4 flex items-start gap-3 animate-pop-in">
              <div className="flex-shrink-0 w-5 h-5 mt-0.5 text-brick">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="font-medium text-cream">Error</p>
                <p className="text-sm mt-1 opacity-90">{error}</p>
              </div>
              <button
                onClick={() => setError(null)}
                className="flex-shrink-0 text-brick hover:text-cream transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}

          {/* Empty state when no messages */}
          {messages.length === 0 && !isStreaming && (
            <EmptyState className="py-8" />
          )}

          {messages.map((message, messageIndex) => {
            const isLatestAssistant =
              message.role === "assistant" && messageIndex === messages.length - 1;

            return (
              <Message key={message.id} className="gap-4 message-enter">
              {message.role === "assistant" ? (
                <BotAvatar />
              ) : (
                <UserAvatar />
              )}
              <div className="flex-1 space-y-3 min-w-0">
                {/* Context chips indicator for user messages */}
                {message.role === "user" && message.contextChips && message.contextChips.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {message.contextChips.map((chip) => (
                      <span
                        key={chip}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-primary/15 text-primary rounded-full border border-primary/25"
                      >
                        {chip === "search-models" && <><Box className="w-3 h-3" /> Models</>}
                        {chip === "docs" && <><FileText className="w-3 h-3" /> Docs</>}
                        {chip === "web" && <><Globe className="w-3 h-3" /> Web</>}
                        {chip === "run-code" && <><Play className="w-3 h-3" /> Run</>}
                        {chip === "plan" && <><ListTodo className="w-3 h-3" /> Plan</>}
                      </span>
                    ))}
                  </div>
                )}

                {/* One compact work log replaces the individual tool-call cards. */}
                {message.role === "assistant" && (
                  (message.toolCalls?.length ?? 0) > 0 ||
                  (isLatestAssistant && (isStreaming || agentPlan))
                ) && (
                  <ToolCalls
                    toolCalls={message.toolCalls ?? []}
                    isActive={isLatestAssistant && isStreaming}
                    isWaiting={isLatestAssistant && Boolean(pendingQuestion)}
                    mode={mode}
                  >
                    {isLatestAssistant && agentPlan ? <PlanView embedded /> : undefined}
                  </ToolCalls>
                )}

                {/* Message content */}
                {message.role === "user" ? (
                  <UserPrompt
                    content={message.content}
                    disabled={isStreaming}
                    onEditAndRerun={(content) =>
                      handleSubmit(content, message.id)
                    }
                  />
                ) : message.content ? (
                  <MessageContent
                    markdown
                    className="bubble-assistant rounded-2xl px-4 py-3 prose prose-sm max-w-none prose-invert"
                  >
                    {message.content}
                  </MessageContent>
                ) : null}

                {message.role === "assistant" && message.sources && (
                  <SourceList sources={message.sources} />
                )}
              </div>
              </Message>
            );
          })}

          {/* Pending question from AI */}
          {pendingQuestion && (
            <div className="max-w-2xl mx-auto animate-pop-in">
              <QuestionPrompt
                questions={pendingQuestion.questions}
                onSubmit={answerQuestion}
                disabled={false}
              />
            </div>
          )}

        </ChatContainerContent>
        
        {/* Scroll to bottom button */}
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2">
          <ScrollButton className="shadow-lg rounded-full glow-lime border border-primary/30" />
        </div>
      </ChatContainerRoot>

      {/* Input */}
      <div className="relative z-10 border-t glass-bar px-4 py-4">
        <div className="max-w-3xl mx-auto space-y-3">
          <ContextChips
            onChipClick={handleChipClick}
            activeChips={activeChips}
            disabled={isStreaming}
            visibleChips={mode === "ask" ? ["docs", "web"] : undefined}
          />
          <PromptInput
            value={input}
            onValueChange={setInput}
            onSubmit={() => void handleSubmit()}
            isLoading={isStreaming}
            className={cn(
              "rounded-2xl glass-strong transition-shadow duration-300 focus-within:glow-lime",
              isImproving && "relative overflow-hidden"
            )}
          >
            {/* Skeleton shimmer overlay when improving */}
            {isImproving && (
              <div className="absolute inset-0 pointer-events-none z-10">
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/25 to-transparent animate-shimmer" />
              </div>
            )}
            <PromptInputTextarea
              placeholder={
                isImproving
                  ? "Powering up your prompt..."
                  : mode === "ask"
                    ? "Keep talking..."
                    : "Ask a follow-up or request a change..."
              }
              className={cn(
                "min-h-[44px] text-base text-cream placeholder:text-muted-foreground",
                isImproving && "opacity-60"
              )}
              disabled={isImproving}
            />
            <PromptInputActions className="justify-between px-3 py-2">
              <div className="flex items-center gap-1">
                <PromptInputAction tooltip="Attach file">
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" disabled>
                    <Icon name="link" size="sm" />
                  </Button>
                </PromptInputAction>
                {mode === "build" && (
                  <InstancePicker
                    onSelect={(path) => setInput((prev) => prev + `@${path} `)}
                  />
                )}
              </div>
              <div className="flex items-center gap-2">
                <ChatModeToggle
                  mode={mode}
                  onChange={handleModeChange}
                  disabled={isStreaming}
                />
                <div className="hidden sm:block">
                  <ModelSelector />
                </div>
                {/* Improve Prompt Button */}
                <PromptInputAction
                  tooltip={`Improve prompt for ${BRAND.name} (AI enhances your message)`}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-8 w-8 rounded-lg transition-all",
                      isImproving && "animate-pulse",
                      input.trim() && !isImproving && !isStreaming && "text-primary hover:text-primary hover:bg-primary/15"
                    )}
                    onClick={handleImprovePrompt}
                    disabled={!input.trim() || isImproving || isStreaming}
                  >
                    {isImproving ? (
                      <Loader variant="circular" size="sm" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                  </Button>
                </PromptInputAction>
                {isStreaming ? (
                  <Button
                    size="icon"
                    variant="destructive"
                    className="h-9 w-9 rounded-xl"
                    onClick={() => {
                      playSound("click");
                      handleStop();
                    }}
                  >
                    <Square className="h-4 w-4 fill-current" />
                  </Button>
                ) : (
                  <Button
                    size="icon"
                    className={cn(
                      "h-9 w-9 rounded-xl",
                      input.trim() && "send-ready"
                    )}
                    onClick={() => void handleSubmit()}
                    disabled={!input.trim()}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </PromptInputActions>
          </PromptInput>
        </div>
      </div>

      {/* Command Palette */}
      <CommandPalette
        onCommand={(cmd, payload) => {
          if (cmd === "prompt" && typeof payload === "string") {
            setInput(payload);
          }
        }}
        onClearChat={clearMessages}
      />
    </div>
  );
}

export default Home;

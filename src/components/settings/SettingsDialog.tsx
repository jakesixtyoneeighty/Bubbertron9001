import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Icon } from "@/components/icons/Icon";
import { ProviderIcon } from "@/components/icons/ProviderIcon";
import { Loader } from "@/components/ui/loader";
import { useSettingsStore } from "@/stores/settings";
import { useAuthStore } from "@/stores/auth";
import { useModelsStore } from "@/stores/models";
import { usePrereqStore } from "@/stores/prereq";
import { useRobloxStore } from "@/stores/roblox";
import { cn } from "@/lib/utils";
import { BRAND } from "@/config/brand";
import { LogOut, Sparkles, Key, Copy, Check, X, RefreshCw, Bug, PlugZap, RotateCcw } from "lucide-react";
import { toast } from "sonner";

// Debug panel to show current auth/model status
function DebugPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const { authMethod, isOAuthAuthenticated, oauthAuth } = useAuthStore();
  const { selectedModel, selectedProvider, apiKeys } = useSettingsStore();
  const { codexModels, lastFetched, isLoading } = useModelsStore();

  const isOAuth = isOAuthAuthenticated();

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground pt-4"
      >
        <Bug className="w-3 h-3" />
        Show Debug Info
      </button>
    );
  }

  return (
    <div className="pt-4 border-t space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Debug Info
        </h3>
        <button
          onClick={() => setIsOpen(false)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Hide
        </button>
      </div>
      <div className="bg-muted/50 rounded-lg p-3 font-mono text-xs space-y-1">
        <div><span className="text-muted-foreground">Auth Method:</span> {authMethod}</div>
        <div><span className="text-muted-foreground">OAuth Authenticated:</span> {isOAuth ? "true" : "false"}</div>
        <div><span className="text-muted-foreground">OAuth Auth Object:</span> {oauthAuth ? "exists" : "null"}</div>
        <div><span className="text-muted-foreground">Has OpenAI Key:</span> {apiKeys.openai ? "true" : "false"}</div>
        <div><span className="text-muted-foreground">Has Anthropic Key:</span> {apiKeys.anthropic ? "true" : "false"}</div>
        <div><span className="text-muted-foreground">Selected Provider:</span> {selectedProvider}</div>
        <div><span className="text-muted-foreground">Selected Model:</span> {selectedModel}</div>
        <div><span className="text-muted-foreground">Models Count:</span> {codexModels.length}</div>
        <div><span className="text-muted-foreground">Models Loading:</span> {isLoading ? "true" : "false"}</div>
        <div><span className="text-muted-foreground">Last Fetched:</span> {lastFetched ? new Date(lastFetched).toLocaleString() : "never"}</div>
      </div>
      <p className="text-xs text-muted-foreground">
        Check browser console (F12) for detailed logs when sending messages.
      </p>
    </div>
  );
}

interface ApiKeyInputProps {
  provider: "openai" | "anthropic";
  label: string;
  placeholder: string;
}

function ApiKeyInput({ provider, label, placeholder }: ApiKeyInputProps) {
  const { apiKeys, setApiKey, hasApiKey } = useSettingsStore();
  const [showKey, setShowKey] = useState(false);
  const [value, setValue] = useState(apiKeys[provider] || "");
  const [isSaving, setIsSaving] = useState(false);
  const isConfigured = hasApiKey(provider);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await setApiKey(provider, value);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save the API key",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    setIsSaving(true);
    try {
      await setApiKey(provider, "");
      setValue("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not clear the API key",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ProviderIcon id={provider} size="sm" />
          <label className="text-sm font-medium">{label}</label>
        </div>
        {isConfigured && (
          <span className="flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">
            <Icon name="check" size="sm" />
            Configured
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            type={showKey ? "text" : "password"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="pr-10 rounded-xl"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            aria-label={`${showKey ? "Hide" : "Show"} ${label} API key`}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <Icon name={showKey ? "eye-off" : "eye"} size="sm" />
          </button>
        </div>
        {value !== (apiKeys[provider] || "") ? (
          <Button
            onClick={() => void handleSave()}
            disabled={isSaving}
            size="sm"
            className="rounded-xl"
          >
            Save
          </Button>
        ) : isConfigured ? (
          <Button
            onClick={() => void handleClear()}
            disabled={isSaving}
            variant="outline"
            size="sm"
            className="rounded-xl text-destructive"
          >
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// ChatGPT Plus/Pro OAuth component
function ChatGPTAuth() {
  const {
    isLoggingIn,
    loginError,
    loginUrl,
    startLogin,
    logout,
    cancelLogin,
    checkOAuthCallback,
    isOAuthAuthenticated,
  } = useAuthStore();
  const { codexModels, isLoading: isLoadingModels, refreshModels, lastFetched } = useModelsStore();

  const [copied, setCopied] = useState(false);
  const isAuthenticated = isOAuthAuthenticated();

  // Poll for OAuth callback when logging in
  useEffect(() => {
    if (!isLoggingIn) return;

    let stopped = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const completed = await checkOAuthCallback();
      if (!stopped && !completed) {
        pollTimer = setTimeout(poll, 1000);
      }
    };
    void poll();

    const timeout = setTimeout(() => {
      stopped = true;
      void cancelLogin();
    }, 5 * 60 * 1000);
    
    return () => {
      stopped = true;
      if (pollTimer) clearTimeout(pollTimer);
      clearTimeout(timeout);
    };
  }, [isLoggingIn, checkOAuthCallback, cancelLogin]);

  const handleCopyUrl = async () => {
    if (loginUrl) {
      await navigator.clipboard.writeText(loginUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not remove credentials",
      );
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-full border border-primary/30 bg-primary/15">
            <Sparkles className="h-3 w-3 text-primary" />
          </div>
          <label className="text-sm font-medium">ChatGPT Plus/Pro</label>
        </div>
        {isAuthenticated && (
          <span className="flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">
            <Icon name="check" size="sm" />
            Signed In
          </span>
        )}
      </div>
      
      <p className="text-xs text-muted-foreground">
        Sign in with your ChatGPT Plus or Pro subscription. No API key needed!
      </p>

      {loginError && (
        <p className="rounded-lg border border-destructive/35 bg-destructive/15 p-2 text-xs text-destructive-foreground">
          {loginError}
        </p>
      )}

      {isAuthenticated ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between rounded-xl border border-primary/20 bg-primary/10 p-3">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-primary" />
              <span className="text-sm text-primary">Connected to ChatGPT</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleLogout()}
              className="text-brick hover:bg-destructive/15 hover:text-destructive-foreground"
            >
              <LogOut className="w-4 h-4 mr-1" />
              Sign Out
            </Button>
          </div>
          {/* Model info and refresh */}
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-muted-foreground">
              {codexModels.length} models available
              {lastFetched && (
                <span className="ml-1">
                  · Updated {new Date(lastFetched).toLocaleTimeString()}
                </span>
              )}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={refreshModels}
              disabled={isLoadingModels}
              className="h-6 px-2 text-xs"
            >
              <RefreshCw className={cn("w-3 h-3 mr-1", isLoadingModels && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>
      ) : isLoggingIn ? (
        <div className="space-y-3">
          {/* Signing in state with URL fallback */}
          <div className="flex items-center justify-between p-3 bg-primary/5 rounded-xl">
            <div className="flex items-center gap-2">
              <Loader variant="dots" size="sm" />
              <Loader variant="text-shimmer" text="Signing in" size="sm" />
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={cancelLogin}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* URL fallback */}
          {loginUrl && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Browser didn't open? Copy this URL and paste it in your browser:
              </p>
              <div className="flex gap-2">
                <Input
                  value={loginUrl}
                  readOnly
                  className="text-xs font-mono rounded-lg h-9"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyUrl}
                  className="shrink-0 h-9 w-9 p-0 rounded-lg"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-primary" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground text-center">
            Complete sign-in in your browser. This window will update automatically.
          </p>
        </div>
      ) : (
        <Button 
          onClick={startLogin}
          disabled={isLoggingIn}
          className="w-full rounded-xl glow-lime"
        >
          <Sparkles className="w-4 h-4 mr-2" />
          Sign in with ChatGPT
        </Button>
      )}
    </div>
  );
}

// Auth method tabs
function AuthMethodTabs() {
  const { authMethod, setAuthMethod, isOAuthAuthenticated } = useAuthStore();
  const { hasApiKey } = useSettingsStore();
  
  const isOAuth = isOAuthAuthenticated();
  const hasKey = hasApiKey("openai") || hasApiKey("anthropic");

  return (
    <div className="flex gap-2 p-1 bg-muted rounded-xl">
      <button
        onClick={() => setAuthMethod("oauth")}
        className={cn(
          "flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-all",
          authMethod === "oauth" 
            ? "bg-background shadow-sm text-foreground" 
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Sparkles className="w-4 h-4" />
        ChatGPT Plus/Pro
        {isOAuth && <span className="h-2 w-2 rounded-full bg-primary" />}
      </button>
      <button
        onClick={() => setAuthMethod("api_key")}
        className={cn(
          "flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-all",
          authMethod === "api_key" 
            ? "bg-background shadow-sm text-foreground" 
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Key className="w-4 h-4" />
        API Keys
        {hasKey && <span className="h-2 w-2 rounded-full bg-primary" />}
      </button>
    </div>
  );
}

interface SettingsDialogProps {
  children?: React.ReactNode;
}

export function SettingsDialog({ children }: SettingsDialogProps) {
  const { authMethod } = useAuthStore();
  const { appSettings, updateAppSettings, resetAppSettings } = useSettingsStore();
  const studioStatus = useRobloxStore((state) => state.status);
  const openSetup = usePrereqStore((state) => state.openWizard);
  const [open, setOpen] = useState(false);
  const studioConnected = studioStatus === "connected";

  const handleOpenSetup = () => {
    setOpen(false);
    window.setTimeout(openSetup, 0);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild aria-label="Open settings">
        {children || (
          <Button variant="ghost" size="icon" className="rounded-xl">
            <Icon name="settings-gear" size="md" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="glass-strong max-h-[85vh] overflow-y-auto rounded-2xl border-primary/20 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">Settings</DialogTitle>
          <DialogDescription>
            Configure your AI provider to start chatting.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-4">
          {/* Auth method tabs */}
          <AuthMethodTabs />

          {/* Auth content based on selected method */}
          <div className="space-y-4">
            {authMethod === "oauth" ? (
              <ChatGPTAuth />
            ) : (
              <>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  API Keys
                </h3>
                <ApiKeyInput
                  provider="openai"
                  label="OpenAI"
                  placeholder="sk-..."
                />
                <ApiKeyInput
                  provider="anthropic"
                  label="Anthropic"
                  placeholder="sk-ant-..."
                />
              </>
            )}
          </div>
          
          <div className="pt-4 border-t">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Roblox Studio
            </h3>
            <div className="flex items-center justify-between rounded-xl border border-border bg-muted/40 p-3">
              <div className="flex items-center gap-2">
                <div className={cn(
                  "w-2 h-2 rounded-full",
                  studioConnected ? "bg-primary" : "bg-muted-foreground"
                )} />
                <span className="text-sm">Studio Connection</span>
              </div>
              <span className={cn(
                "text-xs",
                studioConnected ? "text-primary" : "text-muted-foreground",
              )}>
                {studioConnected ? "Connected" : "Not connected"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Install the {BRAND.name} plugin in Roblox Studio to enable AI-powered editing.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenSetup}
              className="mt-3 w-full gap-2"
            >
              <PlugZap className="h-4 w-4" />
              Run guided setup
            </Button>
          </div>

          <div className="space-y-3 border-t pt-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Preferences
            </h3>
            <PreferenceToggle
              label="Automatic planning"
              description="Make a clear plan before larger Studio changes"
              checked={appSettings.autoPlan}
              onCheckedChange={(autoPlan) => updateAppSettings({ autoPlan })}
            />
            <PreferenceToggle
              label="Confirm Studio changes"
              description="Ask before B9 changes the open game"
              checked={appSettings.confirmDestructiveActions}
              onCheckedChange={(confirmDestructiveActions) =>
                updateAppSettings({ confirmDestructiveActions })
              }
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={resetAppSettings}
              className="w-full gap-2 text-muted-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset preferences
            </Button>
          </div>

          {/* Debug Panel - shows auth status */}
          {import.meta.env.DEV && <DebugPanel />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PreferenceToggle({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-muted/30 p-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        aria-label={label}
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

export default SettingsDialog;

import { useEffect, useState } from "react";
import { Check, Copy, Pencil, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  MessageAction,
  MessageActions,
  MessageContent,
} from "@/components/ui/message";

interface UserPromptProps {
  content: string;
  disabled?: boolean;
  onEditAndRerun: (content: string) => void | Promise<void>;
}

export function UserPrompt({
  content,
  disabled = false,
  onEditAndRerun,
}: UserPromptProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [copied, setCopied] = useState(false);
  const trimmedDraft = draft.trim();
  const hasChanged = trimmedDraft.length > 0 && trimmedDraft !== content;

  useEffect(() => {
    if (!isEditing) setDraft(content);
  }, [content, isEditing]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast.success("Prompt copied");
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      toast.error("Couldn’t copy the prompt");
    }
  };

  if (isEditing) {
    return (
      <div className="space-y-2 rounded-2xl border border-primary/30 bg-primary/5 p-3">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="min-h-28 w-full resize-y rounded-xl border border-border/70 bg-background/70 px-3 py-2 text-sm text-cream outline-none transition-colors focus:border-primary/50"
          aria-label="Edit prompt"
          autoFocus
          disabled={disabled}
        />
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setDraft(content);
              setIsEditing(false);
            }}
            disabled={disabled}
          >
            <X className="h-3.5 w-3.5" />
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setIsEditing(false);
              void onEditAndRerun(trimmedDraft);
            }}
            disabled={disabled || !hasChanged}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Save & rerun
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group space-y-1.5">
      <MessageContent className="bubble-user rounded-2xl px-4 py-3 prose prose-sm max-w-none prose-invert">
        {content}
      </MessageContent>
      <MessageActions className="justify-end pr-1 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <MessageAction tooltip={copied ? "Copied" : "Copy prompt"}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-lg"
            onClick={() => void handleCopy()}
            disabled={disabled}
            aria-label="Copy prompt"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
        </MessageAction>
        <MessageAction tooltip="Edit and rerun prompt">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-lg"
            onClick={() => setIsEditing(true)}
            disabled={disabled}
            aria-label="Edit and rerun prompt"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </MessageAction>
      </MessageActions>
    </div>
  );
}

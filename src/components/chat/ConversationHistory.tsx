import { History, MessageSquare, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/agent";
import { useChatStore } from "@/stores/chat";

function conversationDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Saved";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function ConversationHistory({ disabled = false }: { disabled?: boolean }) {
  const {
    conversations,
    activeConversationId,
    newConversation,
    openConversation,
    deleteConversation,
  } = useChatStore();

  const resetRun = () => useAgentStore.getState().reset();

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={disabled}
          title="Saved conversations"
          aria-label="Open saved conversations"
        >
          <History className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="glass-strong w-[88vw] sm:max-w-sm">
        <SheetHeader className="border-b border-border/70 pb-4">
          <SheetTitle>Saved conversations</SheetTitle>
          <SheetDescription>
            Chats are saved automatically on this device.
          </SheetDescription>
          <SheetClose asChild>
            <Button
              className="mt-3 w-full"
              onClick={() => {
                newConversation();
                resetRun();
              }}
            >
              <Plus className="h-4 w-4" />
              New conversation
            </Button>
          </SheetClose>
        </SheetHeader>

        <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-4">
          {conversations.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
              <MessageSquare className="h-8 w-8 opacity-60" />
              <p className="text-sm">Your conversations will show up here.</p>
            </div>
          ) : (
            conversations.map((conversation) => (
              <div
                key={conversation.id}
                className={cn(
                  "group flex items-center gap-2 rounded-xl border p-2 transition-colors",
                  conversation.id === activeConversationId
                    ? "border-primary/35 bg-primary/10"
                    : "border-transparent hover:border-border hover:bg-muted/45",
                )}
              >
                <SheetClose asChild>
                  <button
                    type="button"
                    className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => {
                      openConversation(conversation.id);
                      resetRun();
                    }}
                  >
                    <span className="block truncate text-sm font-medium text-foreground">
                      {conversation.title}
                    </span>
                    <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{conversation.mode === "ask" ? "Ask" : "Build"}</span>
                      <span aria-hidden="true">·</span>
                      <span>{conversationDate(conversation.updatedAt)}</span>
                    </span>
                  </button>
                </SheetClose>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground opacity-70 hover:bg-destructive/15 hover:text-brick group-hover:opacity-100"
                  onClick={() => {
                    deleteConversation(conversation.id);
                    if (conversation.id === activeConversationId) resetRun();
                  }}
                  title={`Delete ${conversation.title}`}
                  aria-label={`Delete ${conversation.title}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

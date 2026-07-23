import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { STORAGE_KEYS } from "@/config/brand";
import { createConversationStorage } from "@/lib/storage";

export type ChatMode = "ask" | "build";

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: "pending" | "running" | "complete" | "error" | "waiting";
  error?: string;
}

export interface MessageSource {
  id: string;
  url: string;
  title?: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  sources?: MessageSource[];
  contextChips?: string[]; // Which context chips were applied to this message
  createdAt: string;
}

export interface SavedConversation {
  id: string;
  title: string;
  messages: Message[];
  mode: ChatMode;
  createdAt: string;
  updatedAt: string;
}

export interface QuestionOption {
  label: string;
  value?: string; // If different from label
  imageUrl?: string;
  description?: string;
}

export interface Question {
  question: string;
  options?: (string | QuestionOption)[];
  type: "single" | "multi" | "text";
}

export interface PendingQuestion {
  id: string;
  toolCallId: string;
  messageId: string;
  questions: Question[];
  answers?: (string | string[])[];
}

export interface ChatState {
  messages: Message[];
  conversations: SavedConversation[];
  activeConversationId: string | null;
  mode: ChatMode;
  isStreaming: boolean;
  error: string | null;
  pendingQuestion: PendingQuestion | null;
  questionResolver: ((answers: (string | string[])[]) => void) | null;

  // Actions
  addMessage: (message: Omit<Message, "id" | "createdAt">) => string;
  updateMessage: (id: string, content: string) => void;
  editMessageAndTruncate: (id: string, content: string) => void;
  addToolCall: (messageId: string, toolCall: Omit<ToolCall, "status">) => void;
  updateToolCall: (messageId: string, toolCallId: string, update: Partial<ToolCall>) => void;
  addSource: (messageId: string, source: MessageSource) => void;
  setStreaming: (streaming: boolean) => void;
  setError: (error: string | null) => void;
  clearMessages: () => void;
  newConversation: () => void;
  openConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  setMode: (mode: ChatMode) => void;

  // Question handling
  setPendingQuestion: (question: PendingQuestion | null) => void;
  setQuestionResolver: (resolver: ((answers: (string | string[])[]) => void) | null) => void;
  answerQuestion: (answers: (string | string[])[]) => void;
}

const DEFAULT_TITLE = "New conversation";

function createId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function conversationTitle(messages: Message[]) {
  const firstUserMessage = messages.find((message) => message.role === "user");
  if (!firstUserMessage) return DEFAULT_TITLE;
  const oneLine = firstUserMessage.content.replace(/\s+/g, " ").trim();
  return oneLine.length > 52 ? `${oneLine.slice(0, 49)}...` : oneLine;
}

function withSavedMessages(
  state: ChatState,
  messages: Message[],
): Pick<ChatState, "messages" | "conversations" | "activeConversationId"> {
  const now = new Date().toISOString();
  const conversationId = state.activeConversationId || createId();
  const existing = state.conversations.find(
    (conversation) => conversation.id === conversationId,
  );
  const saved: SavedConversation = {
    id: conversationId,
    title: conversationTitle(messages),
    messages,
    mode: state.mode,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  return {
    messages,
    activeConversationId: conversationId,
    conversations: [
      saved,
      ...state.conversations.filter(
        (conversation) => conversation.id !== conversationId,
      ),
    ],
  };
}

const initialTransientState = {
  isStreaming: false,
  error: null,
  pendingQuestion: null,
  questionResolver: null,
};

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      messages: [],
      conversations: [],
      activeConversationId: null,
      mode: "build",
      ...initialTransientState,

  addMessage: (message) => {
    const id = createId();
    set((state) =>
      withSavedMessages(state, [
        ...state.messages,
        { ...message, id, createdAt: new Date().toISOString() },
      ]),
    );
    return id;
  },

  updateMessage: (id, content) =>
    set((state) =>
      withSavedMessages(
        state,
        state.messages.map((msg) =>
          msg.id === id ? { ...msg, content } : msg,
        ),
      ),
    ),

  editMessageAndTruncate: (id, content) =>
    set((state) => {
      const messageIndex = state.messages.findIndex(
        (message) => message.id === id && message.role === "user",
      );
      if (messageIndex < 0) return state;

      const messages = state.messages
        .slice(0, messageIndex + 1)
        .map((message) =>
          message.id === id ? { ...message, content } : message,
        );
      return withSavedMessages(state, messages);
    }),

  addToolCall: (messageId, toolCall) =>
    set((state) =>
      withSavedMessages(state, state.messages.map((msg) =>
        msg.id === messageId
          ? {
              ...msg,
              toolCalls: [
                ...(msg.toolCalls || []),
                { ...toolCall, status: "pending" as const },
              ],
            }
          : msg
      )),
    ),

  updateToolCall: (messageId, toolCallId, update) =>
    set((state) =>
      withSavedMessages(state, state.messages.map((msg) =>
        msg.id === messageId
          ? {
              ...msg,
              toolCalls: msg.toolCalls?.map((tc) =>
                tc.id === toolCallId ? { ...tc, ...update } : tc
              ),
            }
          : msg
      )),
    ),

  addSource: (messageId, source) =>
    set((state) =>
      withSavedMessages(state, state.messages.map((message) => {
        if (message.id !== messageId) return message;
        const sources = message.sources || [];
        if (sources.some((item) => item.url === source.url)) return message;
        return { ...message, sources: [...sources, source] };
      })),
    ),

  setStreaming: (streaming) => set({ isStreaming: streaming }),
  
  setError: (error) => set({ error }),

  clearMessages: () =>
    set((state) => ({
      conversations: state.activeConversationId
        ? state.conversations.filter(
            (conversation) => conversation.id !== state.activeConversationId,
          )
        : state.conversations,
      messages: [],
      activeConversationId: null,
      mode: "build",
      ...initialTransientState,
    })),

  newConversation: () =>
    set({
      messages: [],
      activeConversationId: null,
      mode: "build",
      ...initialTransientState,
    }),

  openConversation: (id) =>
    set((state) => {
      const conversation = state.conversations.find((item) => item.id === id);
      if (!conversation || state.isStreaming) return state;
      return {
        messages: conversation.messages,
        activeConversationId: conversation.id,
        mode: conversation.mode,
        ...initialTransientState,
      };
    }),

  deleteConversation: (id) =>
    set((state) => {
      const conversations = state.conversations.filter(
        (conversation) => conversation.id !== id,
      );
      if (state.activeConversationId !== id) return { conversations };
      return {
        conversations,
        messages: [],
        activeConversationId: null,
        mode: "build",
        ...initialTransientState,
      };
    }),

  setMode: (mode) =>
    set((state) => {
      if (!state.activeConversationId) return { mode };
      return {
        mode,
        conversations: state.conversations.map((conversation) =>
          conversation.id === state.activeConversationId
            ? { ...conversation, mode, updatedAt: new Date().toISOString() }
            : conversation,
        ),
      };
    }),

  // Question handling
  setPendingQuestion: (question) => set({ pendingQuestion: question }),

  setQuestionResolver: (resolver) => set({ questionResolver: resolver }),

  answerQuestion: (answers) => {
    const { questionResolver, pendingQuestion } = get();
    if (questionResolver && pendingQuestion) {
      questionResolver(answers);
      set({ pendingQuestion: null, questionResolver: null });
    }
  },
    }),
    {
      name: STORAGE_KEYS.conversations,
      version: 1,
      storage: createJSONStorage(createConversationStorage),
      partialize: (state) => ({
        messages: state.messages,
        conversations: state.conversations,
        activeConversationId: state.activeConversationId,
        mode: state.mode,
      }),
    },
  ),
);

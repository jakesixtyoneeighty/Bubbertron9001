import { beforeEach, describe, expect, it } from "vitest";
import { useChatStore } from "@/stores/chat";

describe("chat conversations", () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: [],
      conversations: [],
      activeConversationId: null,
      mode: "build",
      isStreaming: false,
      error: null,
      pendingQuestion: null,
      questionResolver: null,
    });
  });

  it("automatically saves and titles a new conversation", () => {
    useChatStore.getState().addMessage({
      role: "user",
      content: "How should my round system work?",
    });

    const state = useChatStore.getState();
    expect(state.activeConversationId).toBeTruthy();
    expect(state.conversations).toHaveLength(1);
    expect(state.conversations[0]).toMatchObject({
      title: "How should my round system work?",
      mode: "build",
    });
    expect(state.conversations[0].messages).toHaveLength(1);
  });

  it("keeps a saved chat when starting a new one and restores its mode", () => {
    const store = useChatStore.getState();
    store.setMode("ask");
    store.addMessage({ role: "user", content: "Explain RemoteEvents" });
    const conversationId = useChatStore.getState().activeConversationId!;

    useChatStore.getState().newConversation();
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().conversations).toHaveLength(1);

    useChatStore.getState().openConversation(conversationId);
    expect(useChatStore.getState().mode).toBe("ask");
    expect(useChatStore.getState().messages[0].content).toBe(
      "Explain RemoteEvents",
    );
  });

  it("updates the saved conversation when mode changes mid-chat", () => {
    useChatStore.getState().addMessage({ role: "user", content: "Make an obby" });
    useChatStore.getState().setMode("ask");

    expect(useChatStore.getState().mode).toBe("ask");
    expect(useChatStore.getState().conversations[0].mode).toBe("ask");
  });
});

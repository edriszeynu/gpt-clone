import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  streaming?: boolean;
  status?: string;        // shown while waiting: "Thinking...", "Using calculator...", etc.
  source?: "llm" | "tools";
  tools_used?: string[];
}

export interface Thread {
  id: string;
  title: string;
  createdAt: number;
  pinned?: boolean;
  systemPrompt?: string;
}

interface ChatStore {
  token: string | null;
  username: string | null;
  _hydrated: boolean;
  threads: Thread[];
  activeThreadId: string | null;
  messages: Record<string, Message[]>;
  selectedModel: string;

  setAuth: (token: string, username: string) => void;
  logout: () => void;
  newThread: () => string;
  setActiveThread: (id: string) => void;
  deleteThread: (id: string) => void;
  renameThread: (id: string, title: string) => void;
  pinThread: (id: string) => void;
  setSystemPrompt: (id: string, prompt: string) => void;
  setModel: (model: string) => void;
  addMessage: (threadId: string, msg: Message) => void;
  updateLastMessage: (threadId: string, content: string, streaming: boolean) => void;
  setMessageMeta: (threadId: string, source: string, tools_used: string[]) => void;
  setMessageStatus: (threadId: string, status: string) => void;
  removeLastMessage: (threadId: string) => void;
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      token: null,
      username: null,
      _hydrated: false,
      threads: [],
      activeThreadId: null,
      messages: {},
      selectedModel: "openai/gpt-4o-mini",

      setAuth: (token, username) => {
        if (typeof window !== "undefined") {
          localStorage.setItem("token", token);
        }
        // Clear old session data and start fresh
        const id = `thread_${Date.now()}`;
        set({
          token,
          username,
          threads: [{ id, title: "New Chat", createdAt: Date.now() }],
          activeThreadId: id,
          messages: {},
        });
      },

      logout: () => {
        if (typeof window !== "undefined") {
          localStorage.removeItem("token");
        }
        set({ token: null, username: null, threads: [], activeThreadId: null, messages: {} });
      },

      newThread: () => {
        const id = `thread_${Date.now()}`;
        const thread: Thread = { id, title: "New Chat", createdAt: Date.now() };
        set((s) => ({ threads: [thread, ...s.threads], activeThreadId: id }));
        return id;
      },

      setActiveThread: (id) => set({ activeThreadId: id }),

      renameThread: (id, title) =>
        set((s) => ({ threads: s.threads.map((t) => t.id === id ? { ...t, title } : t) })),

      pinThread: (id) =>
        set((s) => ({ threads: s.threads.map((t) => t.id === id ? { ...t, pinned: !t.pinned } : t) })),

      setSystemPrompt: (id, prompt) =>
        set((s) => ({ threads: s.threads.map((t) => t.id === id ? { ...t, systemPrompt: prompt } : t) })),

      setModel: (model) => set({ selectedModel: model }),

      deleteThread: (id) =>
        set((s) => ({
          threads: s.threads.filter((t) => t.id !== id),
          activeThreadId: s.activeThreadId === id ? (s.threads[0]?.id || null) : s.activeThreadId,
          messages: Object.fromEntries(Object.entries(s.messages).filter(([k]) => k !== id)),
        })),

      addMessage: (threadId, msg) =>
        set((s) => {
          const prev = s.messages[threadId] || [];
          // Update thread title from first user message
          const threads = s.threads.map((t) =>
            t.id === threadId && t.title === "New Chat" && msg.role === "user"
              ? { ...t, title: msg.content.slice(0, 40) }
              : t
          );
          return { messages: { ...s.messages, [threadId]: [...prev, msg] }, threads };
        }),

      updateLastMessage: (threadId, content, streaming) =>
        set((s) => {
          const msgs = [...(s.messages[threadId] || [])];
          if (msgs.length === 0) return s;
          msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content, streaming };
          return { messages: { ...s.messages, [threadId]: msgs } };
        }),

      setMessageMeta: (threadId, source, tools_used) =>
        set((s) => {
          const msgs = [...(s.messages[threadId] || [])];
          if (msgs.length === 0) return s;
          msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], source: source as any, tools_used };
          return { messages: { ...s.messages, [threadId]: msgs } };
        }),

      setMessageStatus: (threadId, status) =>
        set((s) => {
          const msgs = [...(s.messages[threadId] || [])];
          if (msgs.length === 0) return s;
          msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], status };
          return { messages: { ...s.messages, [threadId]: msgs } };
        }),

      removeLastMessage: (threadId) =>
        set((s) => {
          const msgs = [...(s.messages[threadId] || [])];
          if (msgs.length === 0) return s;
          return { messages: { ...s.messages, [threadId]: msgs.slice(0, -1) } };
        }),
    }),
    { 
      name: "chat-store",
      partialize: (s) => ({ token: s.token, username: s.username, threads: s.threads, messages: s.messages, activeThreadId: s.activeThreadId, selectedModel: s.selectedModel }),
      onRehydrateStorage: () => (state) => {
        if (state) state._hydrated = true;
      },
    }
  )
);

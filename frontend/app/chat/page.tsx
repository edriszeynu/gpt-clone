"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChatStore } from "@/lib/store";
import Sidebar from "@/components/Sidebar";
import ChatMessage from "@/components/ChatMessage";
import ChatInput from "@/components/ChatInput";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api";

const MODELS = [
  { id: "openai/gpt-4o-mini", label: "GPT-4o Mini" },
  { id: "openai/gpt-4o", label: "GPT-4o" },
  { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
  { id: "google/gemini-flash-1.5", label: "Gemini Flash 1.5" },
  { id: "meta-llama/llama-3.1-8b-instruct", label: "Llama 3.1 8B" },
];

const CARDS = [
  { title: "Search the web",    sub: "What\'s happening in AI today?" },
  { title: "Write some code",   sub: "Python function to flatten a nested list" },
  { title: "Do the math",       sub: "Compound interest on $10k at 7% for 20 years" },
  { title: "Explain something", sub: "How does quantum entanglement work?" },
];

export default function ChatPage() {
  const router = useRouter();
  const store = useChatStore();
  const { token, activeThreadId, threads, messages, newThread, addMessage,
          updateLastMessage, logout, setAuth, setMessageMeta, setMessageStatus,
          removeLastMessage, selectedModel, setModel } = store;
  const hydrated = useChatStore((s) => s._hydrated);
  const activeThread = threads.find((t) => t.id === activeThreadId);

  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const isStreaming = useRef(false);
  const [streaming, setStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [systemPromptDraft, setSystemPromptDraft] = useState("");

  useEffect(() => { if (hydrated && !token) router.replace("/login"); }, [hydrated, token]);
  useEffect(() => { if (hydrated && token && threads.length === 0) newThread(); }, [hydrated, token]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, activeThreadId]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); newThread(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "/") { e.preventDefault(); setShowSystemPrompt((v) => !v); }
      if (e.key === "Escape") { setShowModelPicker(false); setShowSystemPrompt(false); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // OAuth redirect
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const oauthToken = params.get("token");
    const oauthUsername = params.get("username");
    if (oauthToken && oauthUsername) {
      logout();
      setAuth(oauthToken, oauthUsername);
      window.history.replaceState({}, "", "/chat");
    }
  }, []);

  const msgs = activeThreadId ? (messages[activeThreadId] || []) : [];

  function stopGeneration() {
    abortRef.current?.abort();
    isStreaming.current = false;
    setStreaming(false);
  }

  async function handleSend(text: string, think: boolean = false) {
    if (isStreaming.current || !activeThreadId || !token) return;

    addMessage(activeThreadId, { id: `u_${Date.now()}`, role: "user", content: text, timestamp: Date.now() });
    addMessage(activeThreadId, { id: `a_${Date.now()}`, role: "assistant", content: "", timestamp: Date.now(), streaming: true, status: "Thinking..." });

    isStreaming.current = true;
    setStreaming(true);
    const tid = activeThreadId;
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch(`${BASE_URL}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          message: text,
          thread_id: tid,
          think,
          model: selectedModel,
          system_prompt: activeThread?.systemPrompt || "",
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        if (res.status === 401) { logout(); router.replace("/login"); return; }
        throw new Error(`${res.status}: ${await res.text()}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let full = "";
      let done = false;

      while (!done) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        for (const line of decoder.decode(value, { stream: true }).split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") { done = true; break; }
          try {
            const parsed = JSON.parse(data);
            if (parsed.chunk) { full += parsed.chunk; updateLastMessage(tid, full, true); }
            if (parsed.tool_start) {
              const labels: Record<string, string> = {
                duckduckgo_results_json: "Searching the web",
                DuckDuckGoSearch: "Searching the web",
                calculator: "Calculating",
                wikipedia_search: "Looking up Wikipedia",
                get_weather: "Checking weather",
                call_api: "Calling API",
                python_repl: "Running code",
              };
              setMessageStatus(tid, `${labels[parsed.tool_start] || `Using ${parsed.tool_start}`}...`);
            }
            if (parsed.meta) { setMessageMeta(tid, parsed.meta.source, parsed.meta.tools_used); }
          } catch {}
        }
      }
      updateLastMessage(tid, full || "Sorry, I could not generate a response.", false);
    } catch (err: any) {
      if (err?.name === "AbortError") {
        updateLastMessage(tid, msgs.find((m) => m.streaming)?.content || "Generation stopped.", false);
      } else {
        console.error(err);
        updateLastMessage(tid, "Something went wrong. Please try again.", false);
      }
    } finally {
      isStreaming.current = false;
      setStreaming(false);
      abortRef.current = null;
    }
  }

  async function handleRegenerate() {
    if (!activeThreadId || isStreaming.current) return;
    const threadMsgs = messages[activeThreadId] || [];
    let lastUserMsg = "";
    for (let i = threadMsgs.length - 1; i >= 0; i--) {
      if (threadMsgs[i].role === "user") { lastUserMsg = threadMsgs[i].content; break; }
    }
    if (!lastUserMsg) return;
    removeLastMessage(activeThreadId);
    await handleSend(lastUserMsg);
  }

  function handleExport() {
    if (!activeThreadId || !token) return;
    fetch(`${BASE_URL}/threads/${activeThreadId}/export`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.blob()).then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `chat-${activeThreadId}.md`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  if (!hydrated) return null;
  if (!token) return null;

  const selectedModelLabel = MODELS.find((m) => m.id === selectedModel)?.label || selectedModel;

  return (
    <div className="app-layout">
      {!sidebarCollapsed && (
        <div className="sidebar-desktop">
          <Sidebar open={true} onClose={() => {}} onCollapse={() => setSidebarCollapsed(true)} />
        </div>
      )}
      {sidebarOpen && (
        <div className="sidebar-mobile">
          <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} isMobile />
        </div>
      )}
      {!sidebarOpen && (
        <button className="sidebar-mobile-open-btn" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>
      )}

      <div className="main-area">
        {/* Toolbar */}
        <div className="chat-toolbar">
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ position: "relative" }}>
              <button className="toolbar-btn" onClick={() => setShowModelPicker((v) => !v)} title="Select model">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
                </svg>
                <span>{selectedModelLabel}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              {showModelPicker && (
                <div className="model-dropdown">
                  {MODELS.map((m) => (
                    <button key={m.id} className={"model-option" + (selectedModel === m.id ? " active" : "")}
                      onClick={() => { setModel(m.id); setShowModelPicker(false); }}>
                      {m.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {msgs.length > 0 && !streaming && (
              <button className="toolbar-btn" onClick={handleExport} title="Export as Markdown">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                <span>Export</span>
              </button>
            )}
            {msgs.length > 1 && !streaming && (
              <button className="toolbar-btn" onClick={handleRegenerate} title="Regenerate">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.51"/>
                </svg>
                <span>Retry</span>
              </button>
            )}
            {streaming && (
              <button className="toolbar-btn stop-btn" onClick={stopGeneration} title="Stop generation">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="4" y="4" width="16" height="16" rx="2"/>
                </svg>
                <span>Stop</span>
              </button>
            )}
          </div>
        </div>

        {msgs.length === 0 ? (
          <div className="welcome">
            <h1 className="welcome-title">What can I help with?</h1>
            <div className="welcome-grid">
              {CARDS.map((c) => (
                <button key={c.title} className="welcome-card" onClick={() => handleSend(c.sub, false)}>
                  <span className="welcome-card-title">{c.title}</span>
                  <span className="welcome-card-sub">{c.sub}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="messages-area">
            <div className="messages-list">
              {msgs.map((msg) => <ChatMessage key={msg.id} msg={msg} />)}
              <div ref={bottomRef} />
            </div>
          </div>
        )}

        <ChatInput onSend={handleSend} disabled={streaming} token={token} />
      </div>

      {sidebarCollapsed && (
        <button className="sidebar-restore-btn" onClick={() => setSidebarCollapsed(false)} aria-label="Open sidebar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/>
          </svg>
        </button>
      )}

      {showSystemPrompt && (
        <div className="modal-overlay" onClick={() => setShowSystemPrompt(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: 12, fontSize: 15, fontWeight: 600 }}>System Prompt</h3>
            <p style={{ fontSize: 12, color: "var(--gray-3)", marginBottom: 10 }}>
              Set a persona or instructions for this conversation.
            </p>
            <textarea
              className="system-prompt-textarea"
              placeholder="e.g. You are a senior Python developer. Be concise and use code examples."
              value={systemPromptDraft}
              onChange={(e) => setSystemPromptDraft(e.target.value)}
              rows={5}
              autoFocus
            />
            <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
              <button className="modal-btn-cancel" onClick={() => setShowSystemPrompt(false)}>Cancel</button>
              <button className="modal-btn-save" onClick={() => {
                if (activeThreadId) store.setSystemPrompt(activeThreadId, systemPromptDraft);
                setShowSystemPrompt(false);
              }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Message } from "@/lib/store";

export default function ChatMessage({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  const [copied, setCopied] = useState(false);
  const isEmpty = msg.content === "" && msg.streaming;

  function copy() {
    navigator.clipboard.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (isUser) {
    return (
      <div className="msg-user">
        <div className="msg-user-bubble">{msg.content}</div>
      </div>
    );
  }

  return (
    <div className="msg-ai">
      <div className="msg-ai-inner">
        <div className="msg-ai-icon">
          <svg width="14" height="14" viewBox="0 0 41 41" fill="none">
            <path d="M37.532 16.87a9.963 9.963 0 0 0-.856-8.184 10.078 10.078 0 0 0-10.855-4.835 9.964 9.964 0 0 0-7.505-3.348 10.079 10.079 0 0 0-9.612 6.977 9.967 9.967 0 0 0-6.664 4.834 10.08 10.08 0 0 0 1.24 11.817 9.965 9.965 0 0 0 .856 8.185 10.079 10.079 0 0 0 10.855 4.835 9.965 9.965 0 0 0 7.504 3.347 10.079 10.079 0 0 0 9.617-6.981 9.967 9.967 0 0 0 6.663-4.834 10.079 10.079 0 0 0-1.243-11.813z" fill="white"/>
          </svg>
        </div>
        <div className="msg-ai-body">
          {isEmpty ? (
            <div className="agent-status">
              <span className="agent-status-dot"/><span className="agent-status-dot"/><span className="agent-status-dot"/>
              <span className="agent-status-text">{msg.status || "Thinking..."}</span>
            </div>
          ) : (
            <div className="prose">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
              {msg.streaming && msg.status && (
                <div className="agent-status" style={{ marginTop: 8 }}>
                  <span className="agent-status-dot"/><span className="agent-status-dot"/><span className="agent-status-dot"/>
                  <span className="agent-status-text">{msg.status}</span>
                </div>
              )}
              {msg.streaming && !msg.status && <span className="cursor"/>}
            </div>
          )}
          {!msg.streaming && msg.content && (
            <div className="msg-actions">
              {/* Source badge */}
              {msg.source && (
                <span className={`msg-source-badge ${msg.source === "tools" ? "badge-tools" : "badge-llm"}`}>
                  {msg.source === "tools" ? (
                    <>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                      </svg>
                      {msg.tools_used && msg.tools_used.length > 0 ? msg.tools_used.join(", ") : "tool"}
                    </>
                  ) : (
                    <>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z"/>
                        <path d="M12 8v4l3 3"/>
                      </svg>
                      LLM
                    </>
                  )}
                </span>
              )}
              <button className="msg-action-btn" onClick={copy}>
                {copied ? (
                  <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="20 6 9 17 4 12"/></svg>Copied</>
                ) : (
                  <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy</>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";
import { useState, useRef, useEffect } from "react";

interface Props {
  onSend: (msg: string, think: boolean) => void;
  disabled?: boolean;
  token?: string | null;
}

// Extend Window for webkit speech
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api";

export default function ChatInput({ onSend, disabled, token }: Props) {
  const [value, setValue] = useState("");
  const [think, setThink] = useState(false);
  const [listening, setListening] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);

  // cleanup on unmount
  useEffect(() => {
    return () => { recognitionRef.current?.stop(); };
  }, []);

  function handleSend() {
    const msg = value.trim();
    if (!msg || disabled) return;
    onSend(msg, think);
    setValue("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function toggleMic() {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setToast({ text: "Speech recognition not supported in this browser", ok: false });
      setTimeout(() => setToast(null), 3000);
      return;
    }

    const recognition = new SR();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognitionRef.current = recognition;

    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);

    recognition.onresult = (e: any) => {
      const transcript = Array.from(e.results as SpeechRecognitionResultList)
        .map((r: SpeechRecognitionResult) => r[0].transcript)
        .join("");
      setValue(transcript);
      // auto-send on final result
      if (e.results[e.results.length - 1].isFinal) {
        recognition.stop();
        if (transcript.trim()) onSend(transcript.trim(), think);
        setValue("");
      }
    };

    recognition.start();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    e.target.value = "";
    setUploading(true);
    setToast(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${BASE_URL}/upload`, {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Upload failed" }));
        throw new Error(err.detail || "Upload failed");
      }
      setToast({ text: `"${file.name}" added to knowledge base`, ok: true });
    } catch (err: any) {
      setToast({ text: err.message, ok: false });
    } finally {
      setUploading(false);
      setTimeout(() => setToast(null), 4000);
    }
  }

  const active = value.trim().length > 0 && !disabled;

  return (
    <div className="input-area">
      {(uploading || toast) && (
        <div className={"upload-toast " + (uploading ? "loading" : toast?.ok ? "success" : "error")}>
          {uploading ? "Uploading..." : toast?.text}
        </div>
      )}

      <div className="input-bar">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.txt,.md,.csv"
          className="input-hidden"
          onChange={handleFile}
        />

        {/* + attach button */}
        <button
          type="button"
          className="input-pill-btn"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          title="Attach file"
          aria-label="Attach file"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>

        {/* textarea */}
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={listening ? "Listening..." : "Ask anything"}
          rows={1}
          disabled={disabled}
          className="input-bar-textarea"
        />

        {/* right actions */}
        <div className="input-right-actions">

          {/* Think toggle */}
          <button
            type="button"
            className={"input-pill-btn think-btn" + (think ? " think-active" : "")}
            onClick={() => setThink((v) => !v)}
            title={think ? "Think mode on" : "Think mode off"}
            aria-pressed={think}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
            <span>Think</span>
          </button>

          {/* Mic button */}
          <button
            type="button"
            className={"input-pill-btn" + (listening ? " mic-active" : "")}
            onClick={toggleMic}
            title={listening ? "Stop listening" : "Voice input"}
            aria-label={listening ? "Stop listening" : "Voice input"}
            aria-pressed={listening}
          >
            {listening ? (
              /* pulsing stop icon while recording */
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M19 10a7 7 0 0 1-14 0" />
                <line x1="12" y1="19" x2="12" y2="22" />
                <line x1="8" y1="22" x2="16" y2="22" />
              </svg>
            )}
          </button>

          {/* Send button */}
          <button
            type="button"
            onClick={handleSend}
            disabled={!active}
            className={"input-send-btn" + (active ? " active" : "")}
            title="Send"
            aria-label="Send message"
          >
            {disabled ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <rect x="3" y="8" width="3" height="8" rx="1.5">
                  <animate attributeName="height" values="8;14;8" dur="0.8s" repeatCount="indefinite" begin="0s"/>
                  <animate attributeName="y" values="8;5;8" dur="0.8s" repeatCount="indefinite" begin="0s"/>
                </rect>
                <rect x="10.5" y="8" width="3" height="8" rx="1.5">
                  <animate attributeName="height" values="8;14;8" dur="0.8s" repeatCount="indefinite" begin="0.15s"/>
                  <animate attributeName="y" values="8;5;8" dur="0.8s" repeatCount="indefinite" begin="0.15s"/>
                </rect>
                <rect x="18" y="8" width="3" height="8" rx="1.5">
                  <animate attributeName="height" values="8;14;8" dur="0.8s" repeatCount="indefinite" begin="0.3s"/>
                  <animate attributeName="y" values="8;5;8" dur="0.8s" repeatCount="indefinite" begin="0.3s"/>
                </rect>
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <p className="input-hint">AI can make mistakes. Consider checking important information.</p>
    </div>
  );
}

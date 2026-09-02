"use client";
import { useState, useRef, useEffect } from "react";
import { useChatStore } from "@/lib/store";
import { clearThread } from "@/lib/api";

interface Props {
  open: boolean;
  onClose: () => void;
  isMobile?: boolean;
  onCollapse?: () => void;
}

export default function Sidebar({ open, onClose, isMobile, onCollapse }: Props) {
  const { threads, activeThreadId, username, newThread, setActiveThread, deleteThread, logout, renameThread, pinThread } = useChatStore();
  const [hovered, setHovered] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId) setTimeout(() => renameRef.current?.focus(), 50);
  }, [renamingId]);

  useEffect(() => {
    if (searchOpen) setTimeout(() => searchRef.current?.focus(), 50);
  }, [searchOpen]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setSearchOpen(false); setSearchQuery(""); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    await clearThread(id);
    deleteThread(id);
  }

  const grouped = groupByDate(threads.slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)));
  const filteredThreads = searchQuery.trim()
    ? threads.filter((t) => t.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : null;

  return (
    <>
      {isMobile && open && <div className="sidebar-overlay" onClick={onClose} />}
      <div className="sidebar">

        {/* ── Header: brand + search + collapse ── */}
        <div className="sidebar-header">
          <span className="sidebar-brand">EdrisGPT</span>
          <div style={{ display: "flex", gap: 2 }}>
            <button
              className="sidebar-icon-btn"
              onClick={() => setSearchOpen((v) => !v)}
              title="Search conversations"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </button>
            <button
              className="sidebar-icon-btn"
              onClick={isMobile ? onClose : onCollapse}
              title="Collapse sidebar"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <line x1="9" y1="3" x2="9" y2="21"/>
              </svg>
            </button>
          </div>
        </div>

        {/* ── New chat button ── */}
        <div className="sidebar-new-row">
          <button className="sidebar-new-btn" onClick={() => { newThread(); onClose(); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
            New chat
          </button>
        </div>

        {/* ── Inline search bar ── */}
        {searchOpen && (
          <div className="sidebar-search-wrap">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, color: "var(--gray-3)" }}>
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              ref={searchRef}
              className="sidebar-search-input"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                style={{ background:"none", border:"none", cursor:"pointer", color:"var(--gray-3)", display:"flex", alignItems:"center", padding:2 }}
                onClick={() => setSearchQuery("")}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            )}
          </div>
        )}

        {/* ── Thread list ── */}
        <div className="sidebar-threads">
          {searchOpen && filteredThreads !== null ? (
            filteredThreads.length === 0 ? (
              <p style={{ padding: "20px 10px", fontSize: 13, color: "var(--gray-3)", textAlign: "center" }}>No results</p>
            ) : (
              filteredThreads.map((t) => (
                <div
                  key={t.id}
                  className={`sidebar-thread-item ${activeThreadId === t.id ? "active" : ""}`}
                  onClick={() => { setActiveThread(t.id); setSearchOpen(false); setSearchQuery(""); onClose(); }}
                >
                  <span className="sidebar-thread-title">{t.title}</span>
                </div>
              ))
            )
          ) : threads.length === 0 ? (
            <p style={{ padding: "24px 10px", fontSize: 13, color: "var(--gray-3)", textAlign: "center" }}>No conversations yet</p>
          ) : (
            Object.entries(grouped).map(([label, items]) => (
              <div key={label} className="sidebar-section">
                <p className="sidebar-section-label">{label}</p>
                {items.map((t) => (
                  <div
                    key={t.id}
                    className={`sidebar-thread-item ${activeThreadId === t.id ? "active" : ""}`}
                    onClick={() => { if (renamingId !== t.id) { setActiveThread(t.id); onClose(); } }}
                    onMouseEnter={() => setHovered(t.id)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    {t.pinned && <span style={{ fontSize: 10, color: "var(--green)", flexShrink: 0 }}>📌</span>}
                    {renamingId === t.id ? (
                      <input
                        ref={renameRef}
                        className="sidebar-rename-input"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => { renameThread(t.id, renameValue || t.title); setRenamingId(null); }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { renameThread(t.id, renameValue || t.title); setRenamingId(null); }
                          if (e.key === "Escape") setRenamingId(null);
                          e.stopPropagation();
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="sidebar-thread-title">{t.title}</span>
                    )}
                    {(hovered === t.id || activeThreadId === t.id) && renamingId !== t.id && (
                      <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                        <button className="sidebar-thread-action" onClick={(e) => { e.stopPropagation(); pinThread(t.id); }} title={t.pinned ? "Unpin" : "Pin"}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                          </svg>
                        </button>
                        <button className="sidebar-thread-action" onClick={(e) => { e.stopPropagation(); setRenameValue(t.title); setRenamingId(t.id); }} title="Rename">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                        </button>
                        <button className="sidebar-thread-del" onClick={(e) => handleDelete(e, t.id)} title="Delete">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        {/* ── Footer ── */}
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-avatar">{username?.[0]?.toUpperCase() || "U"}</div>
            <span className="sidebar-username">{username}</span>
            <button className="sidebar-logout" onClick={logout} title="Log out">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
          </div>
        </div>

      </div>
    </>
  );
}

function groupByDate(threads: { id: string; title: string; createdAt: number; pinned?: boolean }[]) {
  const now = Date.now(), d = 86400000;
  const order = ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"];
  const g: Record<string, typeof threads> = {};
  for (const t of threads) {
    const diff = now - t.createdAt;
    const l = diff < d ? "Today" : diff < 2*d ? "Yesterday" : diff < 7*d ? "Previous 7 days" : diff < 30*d ? "Previous 30 days" : "Older";
    (g[l] ??= []).push(t);
  }
  return Object.fromEntries(order.filter((k) => g[k]).map((k) => [k, g[k]]));
}

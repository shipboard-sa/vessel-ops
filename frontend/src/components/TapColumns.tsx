/**
 * Purpose: The shared "tap columns" kit - the full-screen overlay, the trigger button, a column
 *   row, and the "＋ New …" first row - so every tree picker in the app (storage, systems) looks
 *   and behaves the same.
 * Version: v1 (2026-09-24)
 * Scope: PRODUCTION - mx-inv frontend, shared.
 * Architecture: Pure UI, no data. Built out of the container cascade (warehouse/StorageColumns.tsx)
 *   when the same view was carried over to systems (management/SystemColumns.tsx), the owner 2026-09-24:
 *   one interface for every tree. The overlay is portalled to <body> so a host form's descendant
 *   rules cannot restyle it. Styles: components/TapColumns.css (cc-* classes).
 */
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './TapColumns.css'

/** done(newKey) on success, done(null, message) on failure. */
export type Done<K = number> = (key: K | null, error?: string) => void

/** The field's face: the current value's full path + "change ›"; tap opens the overlay. */
export function TapTrigger({ icon, label, empty, disabled, onOpen }: {
  icon: string; label: string | null; empty: string; disabled?: boolean; onOpen: () => void
}) {
  return (
    <button type="button" className="cc-trigger" disabled={disabled} onClick={onOpen}>
      <span className={`cc-trigger-label${label ? '' : ' cc-trigger-label--empty'}`}>{icon} {label ?? empty}</span>
      <span className="cc-trigger-change">{label ? 'change' : 'pick'} ›</span>
    </button>
  )
}

export function TapOverlay({ title, path, onClose, children }: {
  title: string; path: ReactNode; onClose: () => void; children: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="cc-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="cc-sheet">
        <header className="cc-head">
          <strong>{title}</strong>
          <span className="cc-path">{path}</span>
          <button type="button" className="cc-btn" onClick={onClose}>✕ Cancel</button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function TapRow({
  label, hint, count, tag, star, on, off, offTag = 'here now', onClick,
}: {
  label: string
  /** Dimmed words after the label (e.g. the parent, in a search result). */
  hint?: string | null
  count?: number
  tag?: string | null
  /** on = starred; toggle present = tappable star. */
  star?: { on: boolean; toggle?: () => void }
  on: boolean
  off?: boolean
  offTag?: string
  onClick: () => void
}) {
  return (
    <div className={`cc-row${on ? ' cc-row--on' : ''}${off ? ' cc-row--off' : ''}`}>
      <button type="button" className="cc-row-main" disabled={off} onClick={onClick}>
        <span className="cc-row-label">{label}{hint && <span className="cc-dim"> · {hint}</span>}</span>
        {off && <span className="cc-tag">{offTag}</span>}
        {tag && <span className="cc-tag">{tag}</span>}
        {count !== undefined && <span className="cc-count">{count}</span>}
        {count !== undefined && <span className="cc-chev" aria-hidden="true">›</span>}
      </button>
      {star && (star.toggle ? (
        <button
          type="button"
          className={`cc-star${star.on ? ' cc-star--on' : ''}`}
          title={star.on ? 'Favorite - tap to un-star' : 'Make it a favorite (one tap in every picker)'}
          aria-pressed={star.on}
          onClick={star.toggle}
        >
          {star.on ? '★' : '☆'}
        </button>
      ) : <span className="cc-star cc-star--on" aria-label="favorite">★</span>)}
    </div>
  )
}

/** The "＋ New …" first row: tap to open a one-line name box, plus optional extra fields. */
export function TapNewRow<K = number>({
  label, initialName = '', extra, onCreate, onCreated,
}: {
  label: string
  initialName?: string
  /** Extra inputs beside the name (e.g. a container's kind); rendered as given. */
  extra?: ReactNode
  onCreate: (name: string, done: Done<K>) => void
  onCreated: (key: K, name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(initialName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return <button type="button" className="cc-newrow" onClick={() => { setName(initialName); setOpen(true) }}>{label}</button>
  }
  const create = () => {
    const n = name.trim()
    if (!n || busy) return
    setBusy(true); setError(null)
    onCreate(n, (key, err) => {
      setBusy(false)
      if (key === null) { setError(`Could not add it: ${err ?? 'unknown error'}`); return }
      setOpen(false); setName('')
      onCreated(key, n)
    })
  }
  return (
    <div className="cc-new">
      <input
        autoFocus placeholder="Name" value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); create() }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false) }
        }}
      />
      {extra}
      <div className="cc-new-btns">
        <button type="button" className="cc-btn" disabled={!name.trim() || busy} onClick={create}>✓ Add</button>
        <button type="button" className="cc-btn" onClick={() => { setOpen(false); setError(null) }}>✕</button>
      </div>
      {error && <span className="mgmt-status mgmt-status--error">{error}</span>}
    </div>
  )
}

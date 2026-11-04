/**
 * Purpose: The one pick-from-an-established-list control: type to narrow, tap to pick, and
 *   "＋ New …" as the FIRST row so a missing entry is created right here and comes back selected.
 * Version: v1 (2026-09-23)
 * Scope: PRODUCTION - mx-inv frontend, shared (tracker #76 "no-detour workflows").
 * Architecture: Pure UI over a list the caller already has (react-query data) - no fetching.
 *   The caller supplies how to create a new entry (`renderNew`, usually NewStuffItemForm /
 *   NewFoodItemForm / a one-line name box); when that finishes it calls done(key, label) and the
 *   picker selects it even before the caller's list has refetched. Rules (the owner, 2026-09-23): the
 *   "＋ new" choice is always the first row, never at the bottom; keep type-to-match; no detour
 *   to another screen to create the missing thing. Not a <form> - it is used inside forms.
 */
import { useMemo, useRef, useState, type ReactNode } from 'react'
import './SearchPick.css'

export interface SearchPickProps<T> {
  options: T[]
  keyOf: (o: T) => number | string
  labelOf: (o: T) => string
  /** Extra words to match on and show dimmed after the label (type, place, parent...). */
  hintOf?: (o: T) => string | null | undefined
  value: number | string | null
  onPick: (key: number | string | null, option: T | null) => void
  placeholder?: string
  /** Label of the create row; gets what was typed ('' when nothing yet). */
  newLabel?: (typed: string) => string
  /** The inline create form. Call done(key, label) when created, cancel() to back out. */
  renderNew?: (typed: string, done: (key: number | string, label: string) => void, cancel: () => void) => ReactNode
  /** Offer a "— none —" row that picks null. */
  noneLabel?: string
  disabled?: boolean
  /** Max rows shown under the create row. */
  limit?: number
}

export function SearchPick<T>({
  options, keyOf, labelOf, hintOf, value, onPick, placeholder = 'Type to search…',
  newLabel, renderNew, noneLabel, disabled, limit = 40,
}: SearchPickProps<T>) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [creating, setCreating] = useState<string | null>(null)
  // A just-created entry may not be in `options` until the caller's query refetches.
  const [justMade, setJustMade] = useState<{ key: number | string; label: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = options.find((o) => keyOf(o) === value) ?? null
  const selectedLabel = selected ? labelOf(selected) : justMade && justMade.key === value ? justMade.label : ''

  const words = text.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = useMemo(() => options.filter((o) => {
    if (!words.length) return true
    const hay = `${labelOf(o)} ${hintOf?.(o) ?? ''}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  }), [options, words.join(' ')]) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (o: T | null) => {
    onPick(o ? keyOf(o) : null, o)
    setText(''); setOpen(false)
  }

  if (creating !== null && renderNew) {
    return (
      <div className="search-pick search-pick--creating">
        {renderNew(
          creating,
          (key, label) => { setJustMade({ key, label }); setCreating(null); setText(''); setOpen(false); onPick(key, null) },
          () => { setCreating(null); setOpen(true); inputRef.current?.focus() },
        )}
      </div>
    )
  }

  return (
    <div
      className="search-pick"
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false) }}
    >
      <input
        ref={inputRef}
        className="search-pick-input"
        disabled={disabled}
        placeholder={selectedLabel || placeholder}
        value={open ? text : selectedLabel}
        onFocus={() => { setOpen(true); setText('') }}
        onChange={(e) => { setText(e.target.value); setOpen(true) }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); setOpen(false); inputRef.current?.blur() }
          if (e.key === 'Enter') {
            e.preventDefault()
            if (matches.length === 1) pick(matches[0])
            else if (words.length && renderNew && !matches.some((o) => labelOf(o).toLowerCase() === text.trim().toLowerCase())) setCreating(text.trim())
          }
        }}
      />
      {open && !disabled && (
        // mousedown would blur the input first and close the list before the click lands
        <ul className="search-pick-list" role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {renderNew && (
            <li>
              <button type="button" className="search-pick-row search-pick-row--new" onClick={() => setCreating(text.trim())}>
                {newLabel ? newLabel(text.trim()) : text.trim() ? `＋ Add “${text.trim()}” as new` : '＋ New…'}
              </button>
            </li>
          )}
          {noneLabel && (
            <li>
              <button type="button" className="search-pick-row search-pick-row--none" onClick={() => pick(null)}>{noneLabel}</button>
            </li>
          )}
          {matches.slice(0, limit).map((o) => {
            const hint = hintOf?.(o)
            return (
              <li key={keyOf(o)}>
                <button
                  type="button"
                  className={`search-pick-row${keyOf(o) === value ? ' search-pick-row--on' : ''}`}
                  onClick={() => pick(o)}
                >
                  {labelOf(o)}
                  {hint && <span className="search-pick-hint"> {hint}</span>}
                </button>
              </li>
            )
          })}
          {matches.length > limit && (
            <li className="search-pick-more">{matches.length - limit} more - keep typing to narrow</li>
          )}
          {matches.length === 0 && <li className="search-pick-more">No match{renderNew ? ' - add it with the first row' : ''}.</li>}
        </ul>
      )}
    </div>
  )
}

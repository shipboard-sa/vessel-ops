/**
 * Purpose: Shared "focus screen" primitive - repaint the screen with one
 *   record in focus, a breadcrumb trail of where you are, and a "← Back" that goes
 *   exactly ONE level up - plus the trail hook that tracks what is focused.
 * Version: v3 (2026-09-23) - v3: Back names the origin tab when AppNav's anchor sends it
 *   there (focus.returnLabel, tracker #74); v2 2026-09-19
 * Scope: PRODUCTION - mx-inv frontend, used by every feature that opens a
 *   record full-screen (management, projects, schedule, recipes, meal plan,
 *   warehouse locker).
 * Architecture: Pure UI + one hook, no data fetching. A feature owns the list
 *   and keeps it MOUNTED but `hidden` while a record is focused (so expand
 *   state / scroll survive the round trip); it renders <FocusScreen> for the
 *   focused record. The trail is a stack, so a jump inside the focused record
 *   (task -> its system, project -> task, ...) adds a level. v2 (tracker #32,
 *   the owner 2026-09-19): the old "← Back to <list>" button cleared the whole trail,
 *   so Back seemed to skip levels; now "← Back" is one level, and the breadcrumb
 *   "Systems › Propulsion › Main Engine" lets any earlier level be jumped to
 *   directly. Style rule: the owner, 2026-09-18 (see wiki Design-Decisions "focus
 *   screens, not inline" and "one navigation model").
 */
import { useCallback, useState, type ReactNode } from 'react'
import './FocusScreen.css'

export interface FocusTrail<T> {
  /** Everything visited, oldest first; the last is on screen. */
  trail: T[]
  /** The focused record's key, or null when the list is showing. */
  current: T | null
  /** Focus a record from the list (replaces any trail). */
  open: (key: T) => void
  /** Focus a record from the list WITH its ancestors (e.g. [system, device]), so the
   *  breadcrumb shows the whole path and Back walks up it. */
  openPath: (keys: T[]) => void
  /** Jump to another record from inside the focused one (keeps the trail). */
  push: (key: T) => void
  /** Swap the current entry for another key (e.g. after a rename), keeping the rest. */
  replaceCurrent: (key: T) => void
  /** One step back along the trail. */
  back: () => void
  /** Keep only the first `depth` entries (0 = back to the list). */
  goTo: (depth: number) => void
  /** Back to the list. */
  clear: () => void
}

export function useFocusTrail<T = number>(): FocusTrail<T> {
  const [trail, setTrail] = useState<T[]>([])
  const open = useCallback((key: T) => setTrail([key]), [])
  const openPath = useCallback((keys: T[]) => setTrail(keys), [])
  const push = useCallback((key: T) => setTrail((t) => [...t, key]), [])
  const replaceCurrent = useCallback(
    (key: T) => setTrail((t) => (t.length ? [...t.slice(0, -1), key] : t)), [])
  const back = useCallback(() => setTrail((t) => t.slice(0, -1)), [])
  const goTo = useCallback((depth: number) => setTrail((t) => t.slice(0, Math.max(0, depth))), [])
  const clear = useCallback(() => setTrail([]), [])
  return {
    trail, current: trail.length ? trail[trail.length - 1] : null,
    open, openPath, push, replaceCurrent, back, goTo, clear,
  }
}

export function FocusScreen<T>({
  focus, listLabel, labelOf, children,
}: {
  /** `returnLabel` is set by AppNav.useAnchoredFocus when Back leaves for another tab. */
  focus: FocusTrail<T> & { returnLabel?: string }
  /** What the list is called: the root crumb, and "← Back to <listLabel>" from level 1. */
  listLabel: string
  /** Breadcrumb text for one trail entry (a name, not an id). */
  labelOf?: (key: T) => string
  children: ReactNode
}) {
  const label = (k: T) => (labelOf ? labelOf(k) : '…')
  const { trail } = focus
  const root = listLabel.charAt(0).toUpperCase() + listLabel.slice(1)
  // Where Back goes: the previous crumb (or the list from the first level).
  const backTo = focus.returnLabel ?? (trail.length > 1 ? label(trail[trail.length - 2]) : root)
  return (
    <div className="focus-screen">
      <div className="focus-nav">
        <button type="button" className="link-button focus-back-btn" onClick={focus.back}>
          ← Back to {backTo}
        </button>
        <nav className="focus-crumbs" aria-label="Where you are">
          <button type="button" className="link-button focus-crumb" onClick={focus.clear}>
            {root}
          </button>
          {trail.map((k, i) => (
            <span key={i} className="focus-crumb-item">
              <span className="focus-crumb-sep" aria-hidden="true">›</span>
              {i < trail.length - 1 ? (
                <button type="button" className="link-button focus-crumb" onClick={() => focus.goTo(i + 1)}>
                  {label(k)}
                </button>
              ) : (
                <span className="focus-crumb focus-crumb--here" aria-current="page">{label(k)}</span>
              )}
            </span>
          ))}
        </nav>
      </div>
      {children}
    </div>
  )
}

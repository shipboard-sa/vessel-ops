/**
 * Purpose: Cross-tab navigation for the desktop app - lets any screen open any record (item,
 *   task, system/device, project, recipe, container) wherever it lives, and return to exactly
 *   where the user came from when they back out of it.
 * Version: v3 (2026-09-23) - v3 generalises v2's item-only opener to openRecord(ref, returnTo)
 *   for every record kind that has a detail page, makes EVERY tab a valid origin (NavScope, below)
 *   and moves the "anchor" logic LockerTab had into a shared hook (useAnchoredFocus) so each
 *   destination tab gets the same Back-to-origin behaviour (tracker #74, "clickable to detail",
 *   the owner 2026-09-23). v2 (2026-09-22) added the return trip (tracker #58); v1 2026-09-21.
 * Scope: PRODUCTION - mx-inv frontend, used by App.tsx and every feature view.
 * Architecture: App.tsx owns the tab state and provides AppNav; the /cockpit UI has no provider,
 *   so useAppNav() returns null there and <RecordLink> renders plain text.
 *   - openRecord(ref, returnTo) switches to the tab that owns that kind (ROUTE below) and leaves
 *     the request "pending"; that tab's view consumes it with useAnchoredFocus, opens the record,
 *     and remembers returnTo against it. Back/Close from THAT record (not one browsed to after)
 *     calls returnToOrigin, which switches to returnTo.tab and leaves the ReturnTarget pending;
 *     the origin view consumes it with useReturnRestore to put its sub-tab/trail back.
 *   - NavScope: each tab view wraps its content in <NavScopeProvider> saying (a) how to describe
 *     "here" as a ReturnTarget and (b) which refs it can open in place (openLocal - e.g. a task
 *     link inside Management pushes onto Management's own trail instead of leaving the tab).
 *     <RecordLink> (components/RecordLink.tsx) reads the scope, so a link deep inside a shared
 *     component (TaskNeeds inside TaskDetail, rendered by three tabs) does the right thing
 *     without prop-drilling.
 *   One request each way at a time - plain values, not a router.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { FocusTrail } from './FocusScreen'

export type TabId =
  | 'schedule' | 'run-checklist' | 'layup-return' | 'management' | 'projects'
  | 'warehouse' | 'galley' | 'logbook'

/** Everything that has a detail page somewhere in the app. */
export type RecordRef =
  | { kind: 'item'; id: number }
  | { kind: 'task'; id: number }
  | { kind: 'system'; name: string }
  | { kind: 'project'; id: number }
  | { kind: 'recipe'; id: number }
  /** A container has no page of its own - it opens the Locker filtered to it. */
  | { kind: 'container'; id: number }

/** Which tab owns each kind of record. */
export const ROUTE: Record<RecordRef['kind'], TabId> = {
  item: 'warehouse', container: 'warehouse', task: 'management', system: 'management',
  project: 'projects', recipe: 'galley',
}

export const TAB_LABEL: Record<TabId, string> = {
  schedule: 'Active Schedules', 'run-checklist': 'Run a Checklist', 'layup-return': 'Layup Return',
  management: 'Management', projects: 'Projects', warehouse: 'Warehouse', galley: 'Galley',
  logbook: "Ship's Log",
}

/** Sub-tab names, so Back can say "Back to Meal Plan" rather than just "Back to Galley". */
const SUB_LABEL: Record<string, string> = {
  locker: 'Inventory Locker', add: 'Add New Stuff', restock: 'Restock List', stow: 'Work a Container',
  audit: 'Inventory Audit', expiring: 'Expiry / Inspection Due', structure: 'Storage Structure',
  provisioning: 'Galley Provisioning', recipes: 'Recipe Book', mealplan: 'Meal Plan',
  days: "Ship's Log", register: 'Failure Register', passages: 'Passages',
}

export interface ReturnTarget {
  tab: TabId
  /** The origin view's own sub-tab (Warehouse / Galley) to switch back to. */
  sub?: string
  /** The origin screen's own focus trail to restore - omit for a screen with no trail. */
  trail?: unknown[]
  /** Anything else the origin needs to rebuild the screen (e.g. Run a Checklist's picked checklist). */
  extra?: unknown
}

export interface PendingOpen {
  ref: RecordRef
  returnTo: ReturnTarget | null
}

export interface AppNav {
  /** Open any record on the tab that owns it; `returnTo` is where Back should end up. */
  openRecord: (ref: RecordRef, returnTo?: ReturnTarget) => void
  /** Shorthand kept from v2: open one catalog item's record in the Warehouse. */
  openItem: (itemId: number, returnTo?: ReturnTarget) => void
  /** A record some tab has been asked to open and has not yet shown. */
  pendingOpen: PendingOpen | null
  clearPendingOpen: () => void
  /** Switch to returnTo.tab and arm its sub-tab/trail to be restored. */
  returnToOrigin: (returnTo: ReturnTarget) => void
  /** A return the origin view has not yet consumed. */
  pendingReturn: ReturnTarget | null
  clearPendingReturn: () => void
}

const AppNavContext = createContext<AppNav | null>(null)

export const AppNavProvider = AppNavContext.Provider

/** The nav, or null where there is none (the cockpit UI). */
export function useAppNav(): AppNav | null {
  return useContext(AppNavContext)
}

// ---------------------------------------------------------------------------------------------
// NavScope - "where am I" for any link rendered inside a tab.

export interface NavScope {
  /** Describe the screen as it is right now, so Back from a cross-tab open can rebuild it. */
  origin: () => ReturnTarget
  /** Open the ref without leaving this tab, if this tab can; return false to go cross-tab. */
  openLocal?: (ref: RecordRef) => boolean
}

const NavScopeContext = createContext<NavScope | null>(null)

export function NavScopeProvider({ scope, children }: { scope: NavScope; children: ReactNode }) {
  return <NavScopeContext.Provider value={scope}>{children}</NavScopeContext.Provider>
}

/** A function that opens a record from here (in place when the tab can, else cross-tab),
 *  or null where nothing can be opened (the cockpit). */
export function useOpenRecord(): ((ref: RecordRef) => void) | null {
  const nav = useAppNav()
  const scope = useContext(NavScopeContext)
  if (!nav) return null
  return (ref: RecordRef) => {
    if (scope?.openLocal?.(ref)) return
    nav.openRecord(ref, scope?.origin())
  }
}

// ---------------------------------------------------------------------------------------------
// Destination side: consume a pending open aimed at this tab, and send Back to the origin.

/**
 * For a tab that can be the DESTINATION of openRecord. `toTrail` turns a ref into the trail that
 * shows it on this tab (or null if this tab does not handle that ref). Returns a focus trail
 * whose back/clear return to the origin while the user is still on the record they were sent
 * to, plus `returnLabel` (e.g. "Active Schedules") for FocusScreen's Back button.
 */
export function useAnchoredFocus<T>(
  focus: FocusTrail<T>,
  toTrail: (ref: RecordRef) => T[] | null,
): FocusTrail<T> & { returnLabel?: string } {
  const nav = useAppNav()
  const pending = nav?.pendingOpen ?? null
  const [anchor, setAnchor] = useState<{ trail: T[]; returnTo: ReturnTarget | null } | null>(null)
  useEffect(() => {
    if (!pending) return
    const t = toTrail(pending.ref)
    if (!t) return
    focus.openPath(t)
    setAnchor({ trail: t, returnTo: pending.returnTo })
    nav?.clearPendingOpen()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending])
  const anchored = anchor !== null && anchor.returnTo !== null
    && focus.trail.length === anchor.trail.length
    && focus.trail.length > 0
    && JSON.stringify(focus.trail[focus.trail.length - 1]) === JSON.stringify(anchor.trail[anchor.trail.length - 1])
  if (!anchored || !nav) return focus
  const goHome = () => { setAnchor(null); nav.returnToOrigin(anchor!.returnTo!) }
  const r = anchor!.returnTo!
  return { ...focus, back: goHome, clear: goHome, returnLabel: (r.sub && SUB_LABEL[r.sub]) || TAB_LABEL[r.tab] }
}

/** For a view that can be the ORIGIN: once, when a return aimed at `tab` (and, if given, that
 *  sub-tab) arrives, restore it. */
export function useReturnRestore(tab: TabId, restore: (r: ReturnTarget) => void, sub?: string) {
  const nav = useAppNav()
  const r = nav?.pendingReturn ?? null
  useEffect(() => {
    if (!r || r.tab !== tab || (sub !== undefined && r.sub !== sub)) return
    restore(r)
    nav?.clearPendingReturn()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r])
}

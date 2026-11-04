/**
 * Purpose: Warehouse tab shell - the sub-tab nav (Locker / Add New Stuff / Restock / Work a
 *   Container / Audit / Expiring / Storage Structure).
 * Version: v4 (2026-09-23) - v4: AppNav v3 - a pending item OR container open switches to the
 *   Locker, a return can carry the Locker's own trail, and the tab provides a NavScope so every
 *   record name on any sub-tab can open with Back returning to that sub-tab (tracker #74). A
 *   sub-tab, once visited, stays mounted (hidden) so an audit walk's unsaved ticks survive.
 *   v3 (2026-09-22) added the "Work a Container" sub-tab (StowByContainerTab) - pick a
 *   container, tick everything from the catalog that belongs there, one commit - same mechanism
 *   as the Inventory Audit's per-container tick-list but without needing an open audit (the owner,
 *   2026-09-22: doing the food/tool linking backlog via Locker one item at a time; starting a
 *   formal audit to work one drawer was too much ceremony). v2 was 2026-09-22 (AppNav hand-off
 *   for a within-Warehouse item open); v1 was 2026-09-17.
 * Scope: PRODUCTION - mx-inv frontend, warehouse feature.
 * Architecture: Rendered by App.tsx. Sub-tabs are conditionally rendered (unmounted when not
 *   active), so an AppNav.openItem/returnToOrigin aimed at this tab has to switch the right
 *   sub-tab too, not just land on 'warehouse' - see the two effects below.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { LockerTab } from './LockerTab'
import { AddItemTab } from './AddItemTab'
import { RestockTab } from './RestockTab'
import { StowByContainerTab } from './StowByContainerTab'
import { AuditTab } from './AuditTab'
import { StorageStructureTab } from './StorageStructureTab'
import { ExpiringStockTable } from './ExpiringStockTable'
import { NavScopeProvider, useAppNav } from '../../components/AppNav'
import './WarehouseView.css'

// Food (Provisioning/Recipe Book/Meal Plan) lives under the separate
// top-level "Galley" tab (see GalleyView.tsx) - maintenance supply and
// food are kept apart in the nav, not just grouped sub-tabs of one thing.
type SubTab = 'locker' | 'add' | 'restock' | 'stow' | 'audit' | 'expiring' | 'structure'

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'locker', label: '📦 View Inventory Locker' },
  { id: 'add', label: '🧴 Add New Stuff' },
  { id: 'restock', label: '🔻 Restock List' },
  { id: 'stow', label: '🧺 Work a Container' },
  { id: 'audit', label: '📋 Inventory Audit' },
  { id: 'expiring', label: '⏳ Expiry / Inspection Due' },
  { id: 'structure', label: '🏗️ Edit Storage Structure' },
]

export function WarehouseView() {
  const [sub, setSubState] = useState<SubTab>('locker')
  const [visited, setVisited] = useState<Set<SubTab>>(() => new Set<SubTab>(['locker']))
  const setSub = (s: SubTab) => { setSubState(s); setVisited((v) => (v.has(s) ? v : new Set(v).add(s))) }
  const pane = (s: SubTab, node: ReactNode) => (visited.has(s) ? <div hidden={sub !== s}>{node}</div> : null)
  const appNav = useAppNav()

  // A pending item/container open (from this tab's own sub-tabs, or another top-level tab) needs
  // the Locker sub-tab actually mounted to receive it - LockerTab consumes AppNav.pendingOpen.
  const pendingKind = appNav?.pendingOpen?.ref.kind
  useEffect(() => {
    if (pendingKind === 'item' || pendingKind === 'container') setSub('locker')
  }, [appNav?.pendingOpen, pendingKind])

  // A Back/Close asked to return to a specific Warehouse sub-tab (e.g. Restock). A return that
  // carries a Locker trail is left pending for LockerTab to restore once it mounts.
  useEffect(() => {
    const r = appNav?.pendingReturn
    if (r?.tab === 'warehouse') {
      setSub((r.sub as SubTab) ?? 'locker')
      if (!(r.sub === 'locker' && r.trail)) appNav?.clearPendingReturn()
    }
  }, [appNav, appNav?.pendingReturn])

  return (
    <div className="warehouse-view">
      <nav className="sub-tabs">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={sub === t.id ? 'active' : undefined}
            onClick={() => setSub(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <NavScopeProvider scope={{ origin: () => ({ tab: 'warehouse', sub }) }}>
      {pane('locker', <LockerTab />)}
      {pane('add', <AddItemTab />)}
      {pane('restock', <RestockTab />)}
      {pane('stow', <StowByContainerTab />)}
      {pane('audit', <AuditTab />)}
      {pane('expiring', (
        <div className="warehouse-expiring-tab">
          <h2>⏳ Expiry / Inspection Due — Spares & Safety Gear</h2>
          <p className="mgmt-status">
            Anything with an expiry or inspection-due date outside the galley (flares, EPIRB
            batteries, fire extinguisher checks, medical kit contents) - separate from the
            Galley Provisioning tab's food expiry list, a different workflow (safety-critical,
            not a routine tidy-up).
          </p>
          <ExpiringStockTable
            excludeItemType="food" defaultHorizon={90}
            expiredOnlyLabel="Only already past due (safety-critical clean-out)"
          />
        </div>
      ))}
      {pane('structure', <StorageStructureTab />)}
      </NavScopeProvider>
    </div>
  )
}

/**
 * Purpose: Warehouse "Locker" tab - the filterable item table, plus a
 *   full-screen focus view (ItemDetailPanel) for editing one item and its stock.
 * Version: v10 (2026-10-08) - v10: the multi-select stow requires a Move / Add-extra pick for an item already
 *   stowed in another container (ItemStowPanel v2 onChoice, the owner "no default"). v9 (2026-09-27) - v9: filtered to one container, a tick defaults to what that
 *   container holds (not 1), and the stow message counts items moved out of Unassigned. v8: breadcrumb names an item that is not in the filtered list. v7: AppNav v3 (shared anchor hook; a container ref filters the list;
 *   record names inside the item screen open in place or cross-tab and come back - tracker #74).
 *   v6 (2026-09-22) added a container filter (tracker #63) - pick one from the same
 *   list ContainerPicker uses, "All containers" (blank) by default; filtering to the real
 *   "Unassigned" container (tracker #62) is how you see "items not in a container" - no special
 *   case needed, it is just another container. v5 was 2026-09-22 (AppNav return-trip); v4 was
 *   2026-09-21 (opens an item another tab asked for), v3 2026-09-19.
 * Scope: PRODUCTION - mx-inv frontend, warehouse feature.
 * Architecture: Rendered by WarehouseView. Owns the focused-item trail via the
 *   shared FocusScreen primitive; clicking a row opens the item with a
 *   "Back to locker". The table stays mounted (just hidden) while an item is
 *   focused so search / type filter / scroll survive the round trip (the owner,
 *   2026-09-18: focus screens, not inline panels).
 */
import { useState } from 'react'
import { NavScopeProvider, useAnchoredFocus, useReturnRestore, type RecordRef } from '../../components/AppNav'
import { useContainers, useItem, useItems, useItemTypes, useStockingPolicies } from './useWarehouse'
import { ItemDetailPanel } from './ItemDetailPanel'
import type { Container, ItemType } from '../../api/types'
import { policyDescription, typeLabel } from './catalogDisplay'
import { FocusScreen, useFocusTrail } from '../../components/FocusScreen'
import { ItemStowPanel, type StowChoice, type StowLine, type StowRequestLine } from './ItemStowPanel'
import { useStowItems } from './mutations'

// compartment, then location, then container - same order as ContainerPicker, but this is a
// "narrow the list" filter, not a "put it here" picker, so it skips that one's favorites/Galley
// grouping in favor of one flat alphabetical list.
function containerLabel(c: Container) {
  return `${c.compartment_name} › ${c.location_name} › ${c.container_name}`
}
function byPlace(a: Container, b: Container) {
  return a.compartment_name.localeCompare(b.compartment_name)
    || a.location_name.localeCompare(b.location_name)
    || a.container_name.localeCompare(b.container_name)
}

export function LockerTab() {
  const [typeFilter, setTypeFilter] = useState<ItemType | 'all'>('all')
  const [containerFilter, setContainerFilter] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [shortOnly, setShortOnly] = useState(false)
  // "No stock recorded" = the first-load filter: catalog items nobody has put in a
  // container yet (tracker #5/#6).
  const [noStockOnly, setNoStockOnly] = useState(false)
  // Multi-select -> assign to one container (tracker #6). Keyed by item so the
  // selection survives changing the filters.
  const [selected, setSelected] = useState<Map<number, StowLine>>(new Map())
  const [stowContainer, setStowContainer] = useState<number | null>(null)
  const [stowMsg, setStowMsg] = useState<string | null>(null)
  const stow = useStowItems()
  const focus = useFocusTrail<number>()
  const focusedId = focus.current
  // The breadcrumb's name when the item is not in the (possibly filtered) list - e.g. opened from another screen.
  const { data: focusedItem } = useItem(focusedId)
  // Another screen asked for an item's record (open it; Back from THAT item returns to the
  // origin - AppNav.useAnchoredFocus) or for a container (narrow the list to it, tracker #74).
  const effectiveFocus = useAnchoredFocus(focus, (ref) => {
    if (ref.kind === 'item') return [ref.id]
    if (ref.kind === 'container') { setContainerFilter(ref.id); setSearch(''); return [] }
    return null
  })
  // Back from a record opened FROM an item here (e.g. a device it serves) restores the item.
  useReturnRestore('warehouse', (r) => { if (r.trail) focus.openPath(r.trail as number[]) }, 'locker')
  const scope = {
    origin: () => ({ tab: 'warehouse' as const, sub: 'locker', trail: focus.trail }),
    openLocal: (ref: RecordRef) => {
      if (ref.kind === 'item') {
        const i = focus.trail.indexOf(ref.id)
        if (i >= 0) focus.goTo(i + 1); else focus.push(ref.id)
        return true
      }
      if (ref.kind === 'container') { focus.clear(); setContainerFilter(ref.id); setSearch(''); return true }
      return false
    },
  }
  const { data: items, isLoading, isError, error } = useItems(typeFilter, search || undefined, containerFilter)
  const { data: itemTypes } = useItemTypes()
  const { data: policies } = useStockingPolicies()
  const { data: containers } = useContainers()
  const sortedContainers = (containers ?? []).slice().sort(byPlace)

  if (isLoading) return <p className="mgmt-status">Loading inventory…</p>
  if (isError) return <p className="mgmt-status mgmt-status--error">{(error as Error).message}</p>
  if (!items) return null

  const rows = items
    .filter((i) => !shortOnly || i.below_minimum)
    .filter((i) => !noStockOnly || Number(i.quantity_onhand) === 0)

  // v9: filtered to one container (the Unassigned container on the inventory walk), a tick
  // defaults to everything that container holds - the stow then moves all of it, not just 1.
  const defaultQty = (r: (typeof items)[number]) =>
    containerFilter !== null && Number(r.qty_in_container) > 0 ? Number(r.qty_in_container) : 1
  const toggleRow = (r: (typeof items)[number]) =>
    setSelected((m) => {
      const next = new Map(m)
      if (next.has(r.item_id)) next.delete(r.item_id)
      else next.set(r.item_id, { item_id: r.item_id, item_name: r.item_name, unit: r.unit, qty: defaultQty(r) })
      return next
    })
  const allShownSelected = rows.length > 0 && rows.every((r) => selected.has(r.item_id))
  const toggleAllShown = () =>
    setSelected((m) => {
      const next = new Map(m)
      if (allShownSelected) rows.forEach((r) => next.delete(r.item_id))
      else rows.forEach((r) => { if (!next.has(r.item_id)) next.set(r.item_id, { item_id: r.item_id, item_name: r.item_name, unit: r.unit, qty: defaultQty(r) }) })
      return next
    })
  const setChoice = (id: number, choice: StowChoice, suggestedQty?: number) =>
    setSelected((m) => {
      const n = new Map(m); const l = n.get(id)
      if (l) n.set(id, { ...l, choice, qty: suggestedQty ?? l.qty })
      return n
    })
  const commitStow = (lines: StowRequestLine[]) => {
    if (stowContainer === null) return
    stow.mutate({ container_id: stowContainer, lines }, {
      onSuccess: (res) => {
        const r = res as { added: number; merged: number; homes?: number; moved?: number }
        setStowMsg(`✅ Put ${lines.length} item(s) in the container`
          + (r.moved ? ` (${r.moved} moved out of Unassigned)` : '')
          + ((r as { moved_between?: number }).moved_between ? ` (${(r as { moved_between?: number }).moved_between} moved from another container)` : '')
          + (r.homes ? ` (${r.homes} marked as living here, nothing added)` : '')
          + (r.merged ? ` (${r.merged} already had stock there - quantity added to it)` : '') + '.')
        setSelected(new Map())
      },
      onError: (err) => setStowMsg(`⚠️ Nothing was changed: ${(err as Error).message}`),
    })
  }

  return (
    <div className="locker-tab">
      {focusedId !== null && (
        <FocusScreen
          focus={effectiveFocus}
          listLabel="locker"
          labelOf={(id) => (items ?? []).find((i) => i.item_id === id)?.item_name
            ?? (id === focusedId ? focusedItem?.item_name : undefined) ?? 'item'}
        >
          <NavScopeProvider scope={scope}>
            <ItemDetailPanel key={focusedId} itemId={focusedId} onClose={effectiveFocus.clear} />
          </NavScopeProvider>
        </FocusScreen>
      )}

      {/* Kept mounted (just hidden) while an item is focused, so the search,
          type filter and scroll position are intact when you come back. */}
      <div hidden={focusedId !== null}>
        <div className="mgmt-toolbar">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as ItemType | 'all')}>
            <option value="all">All types</option>
            {itemTypes?.map((t) => (
              <option key={t.type_key} value={t.type_key}>{typeLabel(itemTypes, t.type_key)}</option>
            ))}
          </select>
          <select
            value={containerFilter ?? ''}
            onChange={(e) => setContainerFilter(e.target.value ? Number(e.target.value) : null)}
            title="Narrow the list to one container - pick 'Unassigned' to see items not in a container"
          >
            <option value="">All containers</option>
            {sortedContainers.map((c) => (
              <option key={c.container_id} value={c.container_id}>{containerLabel(c)}</option>
            ))}
          </select>
          <input
            type="text" placeholder="🔍 Search by name"
            value={search} onChange={(e) => setSearch(e.target.value)}
          />
          <label className="checkbox-label">
            <input type="checkbox" checked={shortOnly} onChange={(e) => setShortOnly(e.target.checked)} />
            Only below reorder / min-hold
          </label>
          <label className="checkbox-label" title="Catalog items with nothing recorded in any container yet">
            <input type="checkbox" checked={noStockOnly} onChange={(e) => setNoStockOnly(e.target.checked)} />
            No stock recorded yet
          </label>
        </div>

        {stowMsg && <p className="mgmt-status">{stowMsg}</p>}
        <ItemStowPanel
          lines={Array.from(selected.values())}
          onQty={(id, qty) => setSelected((m) => { const n = new Map(m); const l = n.get(id); if (l) n.set(id, { ...l, qty }); return n })}
          onRemove={(id) => setSelected((m) => { const n = new Map(m); n.delete(id); return n })}
          onClear={() => setSelected(new Map())}
          container={stowContainer} onContainer={setStowContainer}
          actionLabel={`Put ${selected.size} in this container`}
          busy={stow.isPending}
          onCommit={(lines) => { setStowMsg(null); commitStow(lines) }} onChoice={setChoice}
        />

        <p className="mgmt-status">{rows.length} item(s)</p>
        <p className="locker-policy-legend">
          Policy: {(policies ?? []).map((p) => `${p.label} = ${p.description}`).join('  ·  ')}
        </p>

        <div className="locker-table-wrap">
          <table className="warehouse-table locker-table">
            <thead>
              <tr>
                <th><input type="checkbox" checked={allShownSelected} onChange={toggleAllShown} title="Select all shown" /></th><th></th><th>Type</th><th>Item</th><th>On hand</th><th>Unit</th>
                <th>Reorder at</th><th>Target</th><th>Min hold</th><th>Policy</th>
                <th>Stowed</th><th>Expiry</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={12} className="mgmt-empty">No items match.</td></tr>
              )}
              {rows.map((r) => (
                <tr
                  key={r.item_id}
                  onClick={() => focus.open(r.item_id)}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(r.item_id)} onChange={() => toggleRow(r)} />
                  </td>
                  <td>{!!r.below_minimum && <span className="mgmt-critical-dot" title="Below reorder point" />}</td>
                  <td>{typeLabel(itemTypes, r.item_type)}</td>
                  <td>{r.item_name}</td>
                  <td>{r.quantity_onhand}</td>
                  <td>{r.unit}</td>
                  <td>{r.min_quantity || '—'}</td>
                  <td>{r.target_quantity ?? '—'}</td>
                  <td>{r.min_hold ?? '—'}</td>
                  <td title={r.stocking_policy ? policyDescription(policies, r.stocking_policy) : undefined}>
                    {r.stocking_policy ?? '—'}
                  </td>
                  <td className="locker-stowed">
                    {/* one line per container that holds the item (tracker #38) */}
                    {r.locations
                      ? r.locations.split(' | ').sort().map((loc) => <div key={loc}>{loc}</div>)
                      : '—'}
                  </td>
                  <td>{r.earliest_expiry ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

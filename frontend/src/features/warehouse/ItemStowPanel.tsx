/**
 * Purpose: Review-and-confirm panel for "put these items in this container":
 *   one row per selected item with an editable quantity (default 1) and a
 *   remove button, plus the container and the commit button.
 * Version: v2 (2026-10-08)
 *   - v2 (the owner 10-08, "no default"): when the caller passes onChoice, every line whose item
 *     already has stock in ANOTHER real container (not Unassigned, not the target) must be
 *     decided before the button enables: "Move from <container> (has N)" - a true move, the
 *     quantity defaults to all of it - or "Add as extra stock here" (both places real, logged
 *     as found aboard). onCommit receives the resolved lines (mode + from_container_id) for
 *     POST /items/stow (data.stow_items v49).
 * Scope: PRODUCTION - mx-inv frontend, warehouse feature.
 * Architecture: Presentational + controlled. Shared by the Locker's multi-select
 *   bar (container chosen with the ContainerPicker; POSTs /api/items/stow), Work a
 *   Container (StowByContainerTab; same POST) and the Inventory Audit's tick-list
 *   (container fixed = the one being walked; records counts, so it passes no onChoice).
 *   The screens own their own selection state and commit call (tracker #6:
 *   one mechanism for the first-load "many things, one container" job). Reads each
 *   selected item's stock (GET /items/{id}/stock, same cache key as useItemStock).
 * Invocation: imported by LockerTab.tsx, StowByContainerTab.tsx, AuditTab.tsx.
 */
import { useQueries } from '@tanstack/react-query'
import { apiGet } from '../../api/client'
import type { StockLot } from '../../api/types'
import { ContainerPicker } from './ContainerPicker'

/** 'extra' = add as extra stock here; a number = move from that container id; undefined = not decided. */
export type StowChoice = 'extra' | number

export interface StowLine {
  item_id: number
  item_name: string
  unit: string
  qty: number
  choice?: StowChoice
}

/** One line as POST /items/stow takes it. */
export interface StowRequestLine {
  item_id: number
  quantity: number
  mode?: 'move' | 'extra'
  from_container_id?: number
}

interface Elsewhere { container_id: number; label: string; qty: number }

export function ItemStowPanel({
  lines, onQty, onRemove, onClear, container, onContainer, fixedContainerLabel,
  actionLabel, busy, onCommit, onChoice,
}: {
  lines: StowLine[]
  onQty: (itemId: number, qty: number) => void
  onRemove: (itemId: number) => void
  onClear: () => void
  container: number | null
  /** Omit when the container is fixed by the screen (then pass fixedContainerLabel). */
  onContainer?: (id: number | null) => void
  fixedContainerLabel?: string
  actionLabel: string
  busy: boolean
  onCommit: (lines: StowRequestLine[]) => void
  /** Pass to require a Move / Add-extra pick for items stowed elsewhere (stow screens). */
  onChoice?: (itemId: number, choice: StowChoice, suggestedQty?: number) => void
}) {
  const stockQ = useQueries({
    queries: lines.map((l) => ({
      queryKey: ['item-stock', l.item_id],
      queryFn: () => apiGet<StockLot[]>(`/items/${l.item_id}/stock`),
      enabled: !!onChoice,
    })),
  })
  if (lines.length === 0) return null

  // Other real containers holding each line's item, summed per container.
  const elsewhere = (idx: number): Elsewhere[] => {
    if (!onChoice) return []
    const m = new Map<number, Elsewhere>()
    for (const s of stockQ[idx]?.data ?? []) {
      if (s.container_id === null || s.container_id === container || s.compartment_name === 'Unassigned') continue
      if (!(Number(s.quantity) > 0)) continue
      const e = m.get(s.container_id) ?? {
        container_id: s.container_id, qty: 0,
        label: `${s.compartment_name} › ${s.location_name} › ${s.container_name}`,
      }
      e.qty += Number(s.quantity)
      m.set(s.container_id, e)
    }
    return Array.from(m.values())
  }
  const info = lines.map((l, idx) => {
    const others = elsewhere(idx)
    const from = typeof l.choice === 'number' ? others.find((o) => o.container_id === l.choice) : undefined
    const decided = others.length === 0 || l.choice === 'extra' || !!from
    return { others, from, decided, tooMany: !!from && l.qty > from.qty }
  })
  const loading = !!onChoice && stockQ.some((q) => q.isLoading)
  const bad = lines.some((l) => !(l.qty >= 0))
  const anyZero = lines.some((l) => l.qty === 0)
  const undecided = info.filter((x) => !x.decided).length
  const tooMany = info.some((x) => x.tooMany)
  const resolved = (): StowRequestLine[] => lines.map((l, idx) => {
    const x = info[idx]
    if (x.others.length === 0) return { item_id: l.item_id, quantity: l.qty }
    if (x.from) return { item_id: l.item_id, quantity: l.qty, mode: 'move', from_container_id: x.from.container_id }
    return { item_id: l.item_id, quantity: l.qty, mode: 'extra' }
  })

  return (
    <div className="stow-panel">
      <div className="stow-panel-head">
        <strong>{lines.length} selected</strong>
        <button type="button" onClick={onClear}>Clear selection</button>
      </div>
      <ul className="stow-lines">
        {lines.map((l, idx) => {
          const x = info[idx]
          return (
            <li key={l.item_id}>
              <input
                type="number" min={0} step={1} value={l.qty}
                onChange={(e) => onQty(l.item_id, Number(e.target.value))}
                aria-label={`Quantity of ${l.item_name}`}
              />
              <span className="stow-unit">{l.unit}</span>
              <span className="stow-name">{l.item_name}</span>
              <button type="button" title="Remove from selection" onClick={() => onRemove(l.item_id)}>✕</button>
              {onChoice && x.others.length > 0 && (
                <div className={`stow-choice${x.decided ? '' : ' stow-choice--undecided'}`}>
                  <span>{x.decided ? 'Also stowed elsewhere:' : '⚠ Also stowed elsewhere - pick one:'}</span>
                  {x.others.map((o) => (
                    <label key={o.container_id}>
                      <input
                        type="radio" name={`stow-choice-${l.item_id}`}
                        checked={l.choice === o.container_id}
                        onChange={() => onChoice(l.item_id, o.container_id, o.qty)}
                      />
                      Move from {o.label} (has {o.qty} {l.unit})
                    </label>
                  ))}
                  <label>
                    <input
                      type="radio" name={`stow-choice-${l.item_id}`}
                      checked={l.choice === 'extra'}
                      onChange={() => onChoice(l.item_id, 'extra')}
                    />
                    Add as extra stock here (keep both)
                  </label>
                  {x.tooMany && x.from && (
                    <span className="mgmt-status--error">Only {x.from.qty} there - lower the quantity to move.</span>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <div className="stow-panel-commit">
        {onContainer ? (
          <label>
            Put them in
            <ContainerPicker value={container} onChange={onContainer} allowUnassigned={false} />
          </label>
        ) : (
          <span>Counting them in <strong>{fixedContainerLabel}</strong></span>
        )}
        <button
          type="button"
          disabled={busy || bad || container === null || loading || undecided > 0 || tooMany}
          onClick={() => onCommit(resolved())}
        >
          {busy ? 'Working…' : actionLabel}
        </button>
      </div>
      {bad && <p className="mgmt-status mgmt-status--error">A quantity can't be negative.</p>}
      {undecided > 0 && (
        <p className="mgmt-status mgmt-status--error">
          {undecided} item(s) are already stowed in another container - choose Move or Add extra for each.
        </p>
      )}
      {anyZero && !bad && (
        <p className="mgmt-status">
          A 0 doesn't add anything - it marks this container as where the item lives, so it
          is offered first when the item is received.
        </p>
      )}
    </div>
  )
}

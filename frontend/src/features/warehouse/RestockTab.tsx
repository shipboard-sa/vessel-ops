/**
 * Purpose: The Restock List ("stuff cart") - every catalog item under its reorder point
 *   or critical-spare hold, plus anything somebody asked for, with a box to ask for more.
 * Version: v5 (2026-09-23) - v5: the item name is a shared RecordLink and every Serves entry opens
 *   its system/device (tracker #74). v4 (2026-09-22): the item name opens its full record via AppNav (returning to
 *   this tab when Back is pressed) - tracker #59, the owner 2026-09-22 - v3 was 2026-09-21
 * Scope: PRODUCTION - mx-inv frontend, warehouse feature.
 * Architecture: Rendered by WarehouseView. Reads GET /api/items/below-minimum
 *   (data.items_below_minimum, which since v2 also returns requested non-food items with
 *   on_list / on_list_since; the router adds `serves` from item_systems); AddToRestockPanel
 *   puts an item on the list, a row's "take off" clears the request, and ReceiveAction
 *   (receiving stock) clears it too.
 *   v2 = tracker #23: an ad hoc "I just want to buy X" for spares/supplies/tools.
 *   v3 = tracker #17 remainder: a Serves column and a system/device filter (a top-level
 *   system also matches its devices; "Not linked to any device" lists the unlinked).
 */
import { useState } from 'react'
import { useItemTypes, useRestockList, useStockExpiring } from './useWarehouse'
import { typeLabel } from './catalogDisplay'
import { ReceiveAction } from './ReceiveAction'
import { AddToRestockPanel } from './AddToRestockPanel'
import { useSetOnList } from './onList'
import { useSystems } from '../management/useTasks'
import { offerableSystems } from '../management/housekeeping'
import { RecordLink } from '../../components/RecordLink'
import type { RestockRow } from '../../api/types'

// Filter values besides a system/device name.
const ALL = 'all'
const NO_DEVICE = '__none__'

/** A part or spare unit with no device link (tools, supplies and food are not linked by design -
 *  the same rule as ServesEditor's "not linked to any device yet"). */
function needsDevice(row: RestockRow): boolean {
  return row.serves.length === 0 && (row.item_type === 'part' || row.item_type === 'spare_unit')
}

/** Does this row serve `name` - directly, or (when `name` is a top-level system) via one of its devices? */
function servesName(row: RestockRow, name: string, devicesOf: Map<string, string[]>): boolean {
  return row.serves.includes(name) || (devicesOf.get(name) ?? []).some((d) => row.serves.includes(d))
}

// "Stuff cart" horizon for the expiring flag - wider than the food cart's
// 14 days since spares/parts don't get bought as often (the owner, 2026-09-17:
// "a stuff cart with expiring items flagged").
const EXPIRING_FLAG_DAYS = 90

export function RestockTab() {
  const { data: rows, isLoading, isError, error } = useRestockList()
  const { data: itemTypes } = useItemTypes()
  const { data: expiring } = useStockExpiring(EXPIRING_FLAG_DAYS)
  const { data: systemList } = useSystems()
  const [pick, setPick] = useState('all')
  const [serves, setServes] = useState(ALL)
  const [hideUnlocated, setHideUnlocated] = useState(false)
  const setOnList = useSetOnList()

  const nextExpiryByItem = new Map<number, string>()
  for (const e of expiring ?? []) {
    const prev = nextExpiryByItem.get(e.item_id)
    if (!prev || e.expiry_date < prev) nextExpiryByItem.set(e.item_id, e.expiry_date)
  }

  if (isLoading) return <p className="mgmt-status">Loading restock list…</p>
  if (isError) return <p className="mgmt-status mgmt-status--error">{(error as Error).message}</p>
  if (!rows) return null

  if (rows.length === 0) {
    return (
      <div className="restock-tab">
        <h2>🔻 Restock List</h2>
        <AddToRestockPanel />
        <p className="mgmt-status">✅ Nothing below its reorder point or critical-spare hold, and nothing requested.</p>
      </div>
    )
  }

  const types = Array.from(new Set(rows.map((r) => r.item_type))).sort()
  // ever_stocked = 0: in the catalog but no stock movement ever recorded, so on-hand 0 means
  // "not yet located/counted", not "used up or lost" (the owner 2026-09-19, tracker #10).
  const unlocated = rows.filter((r) => !r.ever_stocked && !r.on_list).length
  const requested = rows.filter((r) => r.on_list).length

  // Serves filter: top-level systems that have a linked item on this list (itself or via a
  // device), with just the devices that appear, so the pick list stays short.
  const systems = offerableSystems(systemList ?? [])
  const devicesOf = new Map<string, string[]>()
  for (const s of systems) {
    if (s.parent_name) devicesOf.set(s.parent_name, [...(devicesOf.get(s.parent_name) ?? []), s.name])
  }
  const servedNames = new Set(rows.flatMap((r) => r.serves))
  const serveGroups = systems
    .filter((s) => s.parent_name === null)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({
      name: s.name,
      devices: (devicesOf.get(s.name) ?? []).filter((d) => servedNames.has(d)).sort((a, b) => a.localeCompare(b)),
    }))
    .filter((g) => servedNames.has(g.name) || g.devices.length > 0)
  const countServing = (name: string) => rows.filter((r) => servesName(r, name, devicesOf)).length
  const noDeviceCount = rows.filter(needsDevice).length
  // A picked filter can outlive its rows (the last such item got restocked): fall back to "all".
  const offered = new Set(serveGroups.flatMap((g) => [g.name, ...g.devices]))
  const activeServes = serves === ALL || serves === NO_DEVICE || offered.has(serves) ? serves : ALL

  const view = rows
    .filter((r) => pick === 'all' || r.item_type === pick)
    .filter((r) => !(hideUnlocated && !r.ever_stocked))
    .filter((r) =>
      activeServes === ALL ? true
        : activeServes === NO_DEVICE ? needsDevice(r)
          : servesName(r, activeServes, devicesOf))

  const counts = types.map((t) => `${typeLabel(itemTypes, t)}: ${rows.filter((r) => r.item_type === t).length}`)

  return (
    <div className="restock-tab">
      <h2>🔻 Restock List</h2>
      <AddToRestockPanel />
      <p className="mgmt-status">
        The "stuff cart" — every catalog item under its reorder point or its critical-spare
        hold, independent of what any task needs, plus anything you asked for above
        (📝 requested{requested > 0 ? `, ${requested} now` : ''}; receiving it, or ✕, takes it off).
        Rows with a ⚠️ also have stock expiring within {EXPIRING_FLAG_DAYS} days, worth
        checking before buying more.
      </p>
      <p className="mgmt-status">{counts.join(' · ')}</p>
      {unlocated > 0 && (
        <p className="mgmt-status">
          {unlocated} of these {unlocated === 1 ? 'has' : 'have'} never had any stock recorded — they're in the
          catalog but not located yet (marked <em>not yet located</em>), so they may already be aboard.
          Record each one's quantity in a container (Locker, or the Inventory Audit) and it drops off
          this list.
        </p>
      )}

      <select value={pick} onChange={(e) => setPick(e.target.value)}>
        <option value="all">All types</option>
        {types.map((t) => <option key={t} value={t}>{typeLabel(itemTypes, t)}</option>)}
      </select>
      <select
        value={activeServes} onChange={(e) => setServes(e.target.value)}
        title="Show only what serves one system or device"
      >
        <option value={ALL}>All systems &amp; devices</option>
        <option value={NO_DEVICE}>Parts not linked to any device ({noDeviceCount})</option>
        {serveGroups.map((g) => g.devices.length === 0 ? (
          <option key={g.name} value={g.name}>{g.name} ({countServing(g.name)})</option>
        ) : (
          <optgroup key={g.name} label={g.name}>
            <option value={g.name}>{g.name} — everything ({countServing(g.name)})</option>
            {g.devices.map((d) => <option key={d} value={d}>{d} ({countServing(d)})</option>)}
          </optgroup>
        ))}
      </select>
      <label className="checkbox-label">
        <input type="checkbox" checked={hideUnlocated} onChange={(e) => setHideUnlocated(e.target.checked)} />
        Hide "not yet located" (show only things that were stocked and ran low)
      </label>

      <table className="warehouse-table">
        <thead>
          <tr>
            <th>Type</th><th>Item</th>
            <th title="The systems / devices this item is linked to (edit on the item's own screen)">Serves</th>
            <th>On hand</th><th>Unit</th>
            <th>Reorder at</th><th>Target</th><th>Hold</th><th>Buy</th><th>Why</th>
            <th title={`Any lot expiring within ${EXPIRING_FLAG_DAYS} days`}>Expiring</th><th></th>
          </tr>
        </thead>
        <tbody>
          {view.map((r) => {
            const expiry = nextExpiryByItem.get(r.item_id)
            return (
              <tr key={r.item_id} className={expiry ? 'short' : undefined}>
                <td>{typeLabel(itemTypes, r.item_type)}</td>
                <td>
                  <RecordLink to={{ kind: 'item', id: r.item_id }}>{r.item_name}</RecordLink>
                </td>
                <td className="restock-serves">
                  {r.serves.length > 0
                    ? r.serves.map((n, i) => (
                      <span key={n}>{i > 0 && ', '}<RecordLink to={{ kind: 'system', name: n }}>{n}</RecordLink></span>
                    ))
                    : <span className="restock-unlinked">—</span>}
                </td>
                <td>{r.quantity_onhand}</td>
                <td>{r.unit}</td>
                <td>{r.min_quantity}</td>
                <td>{r.target_quantity ?? '—'}</td>
                <td>{r.min_hold ?? '—'}</td>
                <td>{r.reorder_qty}</td>
                <td>
                  {r.on_list ? (
                    <span className="restock-requested">📝 requested{r.on_list_since ? ` ${r.on_list_since}` : ''}</span>
                  ) : r.reason}
                  {!r.ever_stocked && !r.on_list && <span className="restock-unlocated"> · not yet located</span>}
                </td>
                <td>{expiry ? `⚠️ ${expiry}` : '—'}</td>
                <td>
                  <ReceiveAction
                    itemId={r.item_id} itemName={r.item_name} unit={r.unit}
                    suggestedQty={r.reorder_qty} itemType={r.item_type}
                  />
                  {!!r.on_list && (
                    <button
                      type="button" className="link-button restock-take-off"
                      title="Take it off the shopping list (no longer needed)"
                      disabled={setOnList.isPending}
                      onClick={() => setOnList.mutate({ itemId: r.item_id, onList: false })}
                    >
                      ✕ take off
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

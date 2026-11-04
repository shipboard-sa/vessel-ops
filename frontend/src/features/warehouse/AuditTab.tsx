/**
 * Purpose: The Inventory Audit tab - the physical stock-count walk (start an audit, count each
 *   container, close it) plus review modes: parts linked to no device, tool accessories linked
 *   to no tool, and the spares fit check.
 * Version: v5 (2026-09-23) - v5: no detours (tracker #76) - the tick list's FIRST row is "＋ Add
 *   '<typed>' as a new item" (shared NewStuffItemForm / NewFoodItemForm, lands ticked; replaces
 *   the old "found something not in the catalog" form below the list); "＋ New container here"
 *   first in the container tabs (NewContainerForm, then selected); tick-list names and the count
 *   grid's names open the item again now that Warehouse sub-tabs stay mounted.
 *   v4 (2026-09-23): the tick list is a CheckRow (box ticks; name is a separate,
 *   non-navigating target because unsaved ticks and typed counts are local state that would be
 *   lost by leaving the Warehouse sub-tab - tracker #74). v3 (2026-09-22) adds the fourth mode ("Accessories with no tool",
 *   UnlinkedToolAccessoriesReview) - the owner, 2026-09-22: the natural next step to finish the
 *   initial tool-accessory data load. v2 (2026-09-21) added the third mode (spares fit check,
 *   schema v28); v1 was the first header (mode switch + no-device review). The count walk
 *   itself is unchanged.
 * Scope: PRODUCTION - mx-inv frontend, warehouse feature.
 * Architecture: Rendered by WarehouseView. AuditTab is a four-mode shell: "Count stock" (the
 *   original audit flow), "Parts with no device" (UnlinkedPartsReview), "Accessories with no
 *   tool" (UnlinkedToolAccessoriesReview) and "Spares fit check" (FitReview). All stay mounted
 *   (the others hidden) so a count in progress survives a look at a review.
 */
import { useState } from 'react'
import {
  useAuditContainerView,
  useAuditProgress,
  useAuditUnverified,
  useAudits,
  useContainers,
  useItems,
  useItemTypes,
  useOpenAudit,
  useUnlinkedParts,
  useUnlinkedToolAccessories,
  useFitReview,
} from './useWarehouse'
import {
  useAbandonAudit,
  useCloseAudit,
  useCreateAudit,
  useRecordCount,
} from './mutations'
import { typeLabel } from './catalogDisplay'
import { ItemStowPanel, type StowLine } from './ItemStowPanel'
import { useConfirm } from '../../components/ConfirmDialog'
import { UnlinkedPartsReview } from './UnlinkedPartsReview'
import { UnlinkedToolAccessoriesReview } from './UnlinkedToolAccessoriesReview'
import { FitReview } from './FitReview'
import { CheckRow, RecordLink } from '../../components/RecordLink'
import { NewContainerForm } from './ContainerPicker'
import { NewStuffItemForm } from './NewStuffItemForm'
import { NewFoodItemForm } from './NewFoodItemForm'

type AuditMode = 'count' | 'review' | 'toolacc' | 'fit'

export function AuditTab() {
  const [mode, setMode] = useState<AuditMode>('count')
  const { data: unlinked } = useUnlinkedParts()
  const { data: unlinkedToolAcc } = useUnlinkedToolAccessories()
  const { data: fitRows } = useFitReview()
  const fitTodo = fitRows ? fitRows.filter((r) => r.fit_status === 'wrong_model' || (r.fit_status === null && r.flags.some((f) => f !== 'device_model_unknown'))).length : null

  return (
    <div>
      <div className="mgmt-mode-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'count'}
          className={mode === 'count' ? 'active' : ''} onClick={() => setMode('count')}>
          📋 Count stock
        </button>
        <button type="button" role="tab" aria-selected={mode === 'review'}
          className={mode === 'review' ? 'active' : ''} onClick={() => setMode('review')}>
          🔗 Parts with no device{unlinked ? ` (${unlinked.length})` : ''}
        </button>
        <button type="button" role="tab" aria-selected={mode === 'toolacc'}
          className={mode === 'toolacc' ? 'active' : ''} onClick={() => setMode('toolacc')}>
          🪛 Accessories with no tool{unlinkedToolAcc ? ` (${unlinkedToolAcc.length})` : ''}
        </button>
        <button type="button" role="tab" aria-selected={mode === 'fit'}
          className={mode === 'fit' ? 'active' : ''} onClick={() => setMode('fit')}>
          🔎 Spares fit check{fitTodo ? ` (${fitTodo})` : ''}
        </button>
      </div>
      <div hidden={mode !== 'count'}><CountAudit /></div>
      <div hidden={mode !== 'review'}><UnlinkedPartsReview /></div>
      <div hidden={mode !== 'toolacc'}><UnlinkedToolAccessoriesReview /></div>
      <div hidden={mode !== 'fit'}><FitReview /></div>
    </div>
  )
}

function CountAudit() {
  const { data: openAudit, isLoading } = useOpenAudit()

  if (isLoading) return <p className="mgmt-status">Loading audit…</p>
  return openAudit ? <ActiveAudit audit={openAudit} /> : <StartScreen />
}

function StartScreen() {
  const { data: pastAudits } = useAudits()
  const createAudit = useCreateAudit()
  const [name, setName] = useState('Initial Load 2026')
  const [scope, setScope] = useState('full')

  return (
    <div className="audit-tab">
      <h2>📋 Inventory Audit</h2>
      <p className="mgmt-status">No audit in progress.</p>

      {pastAudits && pastAudits.length > 0 && (
        <table className="warehouse-table">
          <thead><tr><th>Name</th><th>Status</th><th>Started</th><th>Closed</th><th>Counts</th><th>Containers</th></tr></thead>
          <tbody>
            {pastAudits.map((a) => (
              <tr key={a.audit_id}>
                <td>{a.name}</td><td>{a.status}</td><td>{a.started_on}</td>
                <td>{a.completed_on ?? '—'}</td><td>{a.lines}</td><td>{a.containers}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form
        className="mgmt-inline-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          createAudit.mutate({ name: name.trim(), scope })
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} />
        <select value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="full">full</option>
          <option value="critical_spares">critical_spares</option>
        </select>
        <button type="submit" disabled={createAudit.isPending}>Start audit</button>
      </form>
    </div>
  )
}

function ActiveAudit({ audit }: { audit: { audit_id: number; name: string; started_on: string } }) {
  const { data: progress } = useAuditProgress(audit.audit_id)
  const { data: containers } = useContainers()
  const [locationId, setLocationId] = useState<number | null>(null)
  const [containerId, setContainerId] = useState<number | null>(null)
  const [addingContainer, setAddingContainer] = useState(false)

  // A location name is only unique within its compartment (schema v20), so
  // the walk is keyed by location_id and labelled Compartment › Location.
  const locationMap = new Map<number, string>()
  for (const c of containers ?? []) {
    locationMap.set(c.location_id, `${c.compartment_name} › ${c.location_name}`)
  }
  const locations = Array.from(locationMap.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  // A container picked (or just created) decides the location; else the location select does.
  const pickedContainer = (containers ?? []).find((c) => c.container_id === containerId)
  const activeLocation = pickedContainer?.location_id ?? locationId ?? locations[0]?.[0] ?? null
  const locContainers = (containers ?? []).filter((c) => c.location_id === activeLocation)
  const activeContainerId = containerId ?? locContainers[0]?.container_id ?? null

  return (
    <div className="audit-tab">
      <h2>{audit.name}</h2>
      <p className="mgmt-status">started {audit.started_on}</p>
      {progress && (
        <div className="audit-metrics">
          <Metric label="Counts" value={progress.lines} />
          <Metric label="Containers" value={`${progress.containers} / ${progress.total_containers}`} />
          <Metric label="Items" value={progress.items} />
          <Metric label="Discrepancies" value={progress.discrepancies} />
        </div>
      )}

      <div className="mgmt-toolbar">
        <select
          value={activeLocation ?? ''}
          onChange={(e) => { setLocationId(Number(e.target.value)); setContainerId(null) }}
        >
          {locations.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>

      <div className="audit-container-tabs">
        <button type="button" onClick={() => setAddingContainer(true)} disabled={addingContainer}>
          ＋ New container here…
        </button>
        {locContainers.map((c) => (
          <button
            key={c.container_id}
            type="button"
            className={c.container_id === activeContainerId ? 'active' : undefined}
            onClick={() => setContainerId(c.container_id)}
          >
            {c.container_name}{c.container_type !== 'dry' ? ` [${c.container_type}]` : ''}
          </button>
        ))}
      </div>
      {addingContainer && (
        <NewContainerForm
          initialName=""
          onCancel={() => setAddingContainer(false)}
          onDone={(id) => { setAddingContainer(false); setContainerId(id) }}
        />
      )}

      {activeContainerId !== null && (
        <ContainerGrid auditId={audit.audit_id} containerId={activeContainerId} />
      )}

      <FinishSection auditId={audit.audit_id} />
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="audit-metric">
      <div className="audit-metric-value">{value}</div>
      <div className="audit-metric-label">{label}</div>
    </div>
  )
}

function ContainerGrid({ auditId, containerId }: { auditId: number; containerId: number }) {
  const { data: rows } = useAuditContainerView(auditId, containerId)
  const { data: itemTypes } = useItemTypes()
  const recordCount = useRecordCount()
  const [counts, setCounts] = useState<Record<number, string>>({})

  const shown = new Set((rows ?? []).map((r) => r.item_id))

  return (
    <div className="audit-grid">
      {!rows || rows.length === 0 ? (
        <p className="mgmt-status">Nothing recorded here yet — add what you find below.</p>
      ) : (
        <table className="warehouse-table">
          <thead><tr><th>Type</th><th>Item</th><th>Unit</th><th>System</th><th>Counted</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.item_id}>
                <td>{typeLabel(itemTypes, r.item_type)}</td>
                <td><RecordLink to={{ kind: 'item', id: r.item_id }}>{r.item_name}</RecordLink></td>
                <td>{r.unit}</td>
                <td>{r.system_qty}</td>
                <td>
                  <input
                    type="number" min={0} step={1}
                    placeholder={r.counted_qty === null ? 'not checked' : undefined}
                    value={counts[r.item_id] ?? (r.counted_qty ?? '')}
                    onChange={(e) => setCounts((s) => ({ ...s, [r.item_id]: e.target.value }))}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    onClick={() => {
                      const val = counts[r.item_id]
                      if (val !== undefined && val !== '') {
                        recordCount.mutate({ auditId, item_id: r.item_id, container_id: containerId, counted_qty: Number(val) })
                      }
                    }}
                  >
                    💾
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <AuditTickList auditId={auditId} containerId={containerId} shownIds={shown} />

    </div>
  )
}

// "Tick everything you found in this container" - replaces the one-at-a-time
// dropdown so a container full of tools takes one pass, not one pick per item
// (the owner, 2026-09-19, tracker #6). Counts are upserts per (item, container), so a
// retry after a failure is safe. An item already counted/stocked here is left
// to the grid above; an item that lives in other containers too still shows,
// with where it is now, because one item is routinely spread across several
// containers (primary / backup / deep storage).
function AuditTickList({
  auditId, containerId, shownIds,
}: { auditId: number; containerId: number; shownIds: Set<number> }) {
  const { data: items } = useItems('all')
  const { data: itemTypes } = useItemTypes()
  const { data: containers } = useContainers()
  const recordCount = useRecordCount()
  const [creating, setCreating] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [type, setType] = useState<string>('all')
  const [selected, setSelected] = useState<Map<number, StowLine>>(new Map())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const c = (containers ?? []).find((x) => x.container_id === containerId)
  const containerLabel = c ? `${c.compartment_name} › ${c.location_name} › ${c.container_name}` : 'this container'
  const q = search.trim().toLowerCase()
  const candidates = (items ?? [])
    .filter((i) => !shownIds.has(i.item_id))
    .filter((i) => type === 'all' || i.item_type === type)
    .filter((i) => !q || i.item_name.toLowerCase().includes(q))
  const visible = candidates.slice(0, 80)

  // A new catalog item made from the first row lands ticked at qty 1 (tracker #76).
  const addNew = (itemId: number, itemName: string, unit: string) => {
    setCreating(null); setSearch('')
    setSelected((m) => new Map(m).set(itemId, { item_id: itemId, item_name: itemName, unit, qty: 1 }))
  }

  const toggle = (i: (typeof candidates)[number]) =>
    setSelected((m) => {
      const n = new Map(m)
      if (n.has(i.item_id)) n.delete(i.item_id)
      else n.set(i.item_id, { item_id: i.item_id, item_name: i.item_name, unit: i.unit, qty: 1 })
      return n
    })

  const commit = async () => {
    setBusy(true); setMsg(null)
    const failed: string[] = []
    let done = 0
    for (const l of Array.from(selected.values())) {
      try {
        await recordCount.mutateAsync({ auditId, item_id: l.item_id, container_id: containerId, counted_qty: l.qty })
        done += 1
        setSelected((m) => { const n = new Map(m); n.delete(l.item_id); return n })
      } catch {
        failed.push(l.item_name)
      }
    }
    setBusy(false)
    setMsg(failed.length
      ? `⚠️ Counted ${done}; ${failed.length} failed and are still selected: ${failed.join(', ')}. Press the button again to retry those.`
      : `✅ Counted ${done} item(s) in ${containerLabel}.`)
  }

  return (
    <div className="audit-ticklist">
      <h4>Add items you found in this container</h4>
      <div className="mgmt-toolbar">
        <input type="text" placeholder="🔍 Search by name" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">All types</option>
          {itemTypes?.map((t) => <option key={t.type_key} value={t.type_key}>{typeLabel(itemTypes, t.type_key)}</option>)}
        </select>
      </div>
      {msg && <p className="mgmt-status">{msg}</p>}
      <ul className="audit-tick-candidates">
        <li>
          {creating === null ? (
            <button type="button" className="link-button" onClick={() => setCreating(search.trim())}>
              {search.trim() ? `＋ Add “${search.trim()}” as a new item (not in the catalog yet)` : '＋ New item (not in the catalog yet)…'}
            </button>
          ) : (
            <NewFoundItem
              typed={creating} food={c?.compartment_name === 'Galley'}
              onCancel={() => setCreating(null)} onDone={addNew}
            />
          )}
        </li>
        {visible.map((i) => (
          <li key={i.item_id}>
            {/* The name opens the item; Warehouse sub-tabs stay mounted, so unsaved ticks survive
                the trip (tracker #74/#76). */}
            <CheckRow
              checked={selected.has(i.item_id)} onToggle={() => toggle(i)}
              to={{ kind: 'item', id: i.item_id }}
              name={<span className="stow-name">{i.item_name}</span>}
            >
              <span className="stow-unit">{typeLabel(itemTypes, i.item_type)}</span>
              <span className="stow-unit">{Number(i.quantity_onhand) > 0 ? `have ${i.quantity_onhand} ${i.unit}${i.locations ? ` (${i.locations})` : ''}` : 'no stock yet'}</span>
            </CheckRow>
          </li>
        ))}
        {candidates.length === 0 && <li className="mgmt-empty">No matching items.</li>}
      </ul>
      {candidates.length > visible.length && (
        <p className="mgmt-status">Showing the first {visible.length} of {candidates.length} - narrow the search or type.</p>
      )}
      <ItemStowPanel
        lines={Array.from(selected.values())}
        onQty={(id, qty) => setSelected((m) => { const n = new Map(m); const l = n.get(id); if (l) n.set(id, { ...l, qty }); return n })}
        onRemove={(id) => setSelected((m) => { const n = new Map(m); n.delete(id); return n })}
        onClear={() => setSelected(new Map())}
        container={containerId} fixedContainerLabel={containerLabel}
        actionLabel={`Count ${selected.size} in this container`}
        busy={busy} onCommit={commit}
      />
    </div>
  )
}

/** "Found something that is not in the catalog": the shared new-item form (food or not - food
 *  first when the container is in the Galley), handing back id, name and unit. Also used by
 *  StowByContainerTab's tick list. */
export function NewFoundItem({
  typed, food, onDone, onCancel,
}: {
  typed: string
  food: boolean
  onDone: (itemId: number, itemName: string, unit: string) => void
  onCancel: () => void
}) {
  const [asFood, setAsFood] = useState(food)
  return (
    <div>
      <button type="button" className="link-button" onClick={() => setAsFood(!asFood)}>
        {asFood ? 'Not food? Switch to a part / spare / tool / supply' : 'Is it food? Switch to a food item'}
      </button>
      {asFood ? (
        <NewFoodItemForm
          initialName={typed} onCancel={onCancel}
          onDone={(r) => onDone(r.itemId, r.itemName, r.unit)}
        />
      ) : (
        <NewStuffItemForm
          initialName={typed} createLabel="✓ Create and tick" onCancel={onCancel}
          onDone={(r) => onDone(r.itemId, r.itemName, r.unit ?? 'ea')}
        />
      )}
    </div>
  )
}

function FinishSection({ auditId }: { auditId: number }) {
  const { data: unverified } = useAuditUnverified(auditId)
  const closeAudit = useCloseAudit()
  const abandonAudit = useAbandonAudit()
  const confirm = useConfirm()
  const [absent, setAbsent] = useState<number[]>([])
  const [note, setNote] = useState('')

  return (
    <details className="audit-finish">
      <summary>🏁 Finish / close this audit</summary>
      <p className="mgmt-status">
        {unverified?.length ?? 0} catalog item(s) not yet touched. Close leaves them as-is
        unless marked "not aboard".
      </p>
      {unverified && unverified.length > 0 && (
        <select
          multiple
          className="audit-absent-select"
          value={absent.map(String)}
          onChange={(e) => setAbsent(Array.from(e.target.selectedOptions).map((o) => Number(o.value)))}
        >
          {unverified.map((u) => (
            <option key={u.item_id} value={u.item_id}>{u.item_name} · {u.item_type}</option>
          ))}
        </select>
      )}
      <input placeholder="Closing note" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="item-detail-actions">
        <button
          type="button"
          onClick={() => closeAudit.mutate({ auditId, absent_item_ids: absent, notes: note || undefined })}
        >
          ✅ Close audit
        </button>
        <button
          type="button" className="danger"
          onClick={async () => {
            if (await confirm({
              title: 'Abandon this audit?',
              message: 'The counts recorded so far in this audit are thrown away.',
              confirmLabel: 'Abandon audit',
              cancelLabel: 'Keep auditing',
            })) abandonAudit.mutate(auditId)
          }}
        >
          🗑 Abandon
        </button>
      </div>
    </details>
  )
}

/**
 * Purpose: "Work a Container" - pick one container, see what is IN it now, then tick items to
 *   add / move into it (from Unassigned by default, or the whole catalog) and commit them all in
 *   one stow. The container-first mirror of the Inventory Audit's per-container tick-list,
 *   usable without starting an audit.
 * Version: v9 (2026-10-08)
 *   - v9 (the owner 10-08): picking a different container no longer clears the items ticked in the add
 *     list (nor the search / filters) - he ticked from Unassigned, changed the target, and had to
 *     find them all again. "In here now" is capped at about a third of the screen (its own scroll)
 *     and its heading folds it away, so a full container no longer crowds out the add list.
 *   - v8 (the owner 10-08, "no default"): an item ticked to add that already has stock in another
 *     real container must be decided in the review panel - Move from there, or Add as extra
 *     stock here (ItemStowPanel v2 onChoice; POST /items/stow line mode).
 *   - v7 (the owner 10-08): "Done with this container" - the items NOT ticked are offered a move to
 *     Unassigned (POST /items/move-to-unassigned: all their stock here moves, an empty "lives
 *     here" row is cleared; no audit line, so they stay on the audit's still-to-find list) or
 *     left where they are.
 *   - v6 (the owner 10-08): "In here now" rows have TICK BOXES - a tick is a lasting "verified here on
 *     <date>" record that counts as an audit: it writes an audit_lines row into the OPEN audit
 *     (POST /audits/{id}/verify, stock untouched); un-tick takes back a pure verification. Each
 *     row shows when it was last verified here (any audit). No open audit -> start one inline.
 *   - v5 (the owner 10-07/08): the container's CURRENT contents come first ("In here now"); the add list below it has a
 *     source pick defaulting to "Unassigned (N)" (whole list, no cap; quantity defaults to all
 *     of it) or "Everything" (first 80, with a Show-all), "Select all shown" (only while a search
 *     or type filter is on), and rows already in this container are marked.
 *   - v4: the stow message counts items moved out of Unassigned (the stow now moves, v43 data.py).
 *   - v3: the tick list's FIRST row is "＋ Add '<typed>' as a new item" (AuditTab's NewFoundItem:
 *     shared NewStuffItemForm / NewFoodItemForm, food first for a Galley container) and the new
 *     item lands ticked - no detour to the Locker (tracker #76).
 *   - v2: each candidate is a CheckRow - the box ticks, the name opens the item (tracker #74).
 * Scope: PRODUCTION - mx-inv frontend, warehouse feature.
 * Architecture: Warehouse sub-tab (WarehouseView). Reads GET /items?container_id= (useItems) for
 *   both this container's contents and the Unassigned container's, GET /items for "Everything".
 *   Same "tick a searchable list, review quantities, one commit" mechanism as the Inventory
 *   Audit's AuditTickList (AuditTab.tsx) and the Locker tab's multi-select bar - all three share
 *   ItemStowPanel and POST /items/stow (useStowItems). The stow itself writes no audit lines;
 *   the "In here now" ticks do (v6, into the open audit - GET /audits/open, GET
 *   /audits/{id}/containers/{cid} for the tick state). The stow moves stock out of Unassigned;
 *   from any OTHER container it adds new stock (data.stow_items).
 * Invocation: imported by WarehouseView.tsx; built with `npm run build`.
 */
import { useState } from 'react'
import { useAuditContainerView, useContainers, useItems, useItemTypes, useOpenAudit } from './useWarehouse'
import { useCreateAudit, useMoveToUnassigned, useStowItems, useVerifyInContainer } from './mutations'
import { useConfirm } from '../../components/ConfirmDialog'
import { ContainerPicker } from './ContainerPicker'
import { typeLabel } from './catalogDisplay'
import { ItemStowPanel, type StowChoice, type StowLine, type StowRequestLine } from './ItemStowPanel'
import type { ItemListRow, ItemType } from '../../api/types'
import { CheckRow } from '../../components/RecordLink'
import { NewFoundItem } from './AuditTab'

const EVERYTHING_CAP = 80

export function StowByContainerTab() {
  const [containerId, setContainerId] = useState<number | null>(null)
  const [containerLabel, setContainerLabel] = useState<string | null>(null)
  const { data: itemTypes } = useItemTypes()
  const { data: containers } = useContainers()
  // The real "Unassigned" container (tracker #62) - found by its compartment name, the same
  // name data.UNASSIGNED_COMPARTMENT gives it.
  const unassignedId = (containers ?? []).find((c) => c.compartment_name === 'Unassigned')?.container_id ?? null
  const { data: here } = useItems('all', undefined, containerId)
  // With no id yet useItems would be the unfiltered catalog - never show that as "Unassigned".
  const { data: unassignedRaw } = useItems('all', undefined, unassignedId)
  const unassigned = unassignedId === null ? undefined : unassignedRaw
  const { data: everything } = useItems('all')
  const stow = useStowItems()
  const { data: openAudit } = useOpenAudit()
  const auditId = openAudit?.audit_id ?? null
  const { data: auditRows } = useAuditContainerView(auditId, containerId)
  const verify = useVerifyInContainer()
  const createAudit = useCreateAudit()
  const moveOut = useMoveToUnassigned()
  const confirm = useConfirm()
  const [auditName, setAuditName] = useState(`Container checks ${new Date().toISOString().slice(0, 10)}`)
  const [creating, setCreating] = useState<string | null>(null)
  const [source, setSource] = useState<'unassigned' | 'all'>('unassigned')
  const [showAll, setShowAll] = useState(false)
  const [search, setSearch] = useState('')
  const [type, setType] = useState<ItemType | 'all'>('all')
  const [selected, setSelected] = useState<Map<number, StowLine>>(new Map())
  const [msg, setMsg] = useState<string | null>(null)
  const [hereOpen, setHereOpen] = useState(true)

  const hereNow = containerId === null ? [] : (here ?? [])
  const hereIds = new Set(hereNow.map((i) => i.item_id))
  // ticked = verified here in the OPEN audit (a count of 0 means "not here", so not ticked)
  const verifiedNow = new Set((auditRows ?? []).filter((r) => Number(r.counted_qty) > 0).map((r) => r.item_id))
  const tickedCount = hereNow.filter((i) => verifiedNow.has(i.item_id)).length
  const unticked = hereNow.filter((i) => !verifiedNow.has(i.item_id))
  const finishContainer = async () => {
    if (containerId === null) return
    if (unticked.length === 0) { setMsg(`✅ Every item in ${containerLabel} is verified here.`); return }
    const names = unticked.slice(0, 12).map((i) => i.item_name).join(', ')
      + (unticked.length > 12 ? `, and ${unticked.length - 12} more` : '')
    const ok = await confirm({
      title: `${unticked.length} item(s) not ticked`,
      message: `Not seen here: ${names}. Move them to Unassigned? They stay aboard and on the audit's still-to-find list - they just no longer say they are in this container.`,
      confirmLabel: `Move ${unticked.length} to Unassigned`,
      cancelLabel: 'Leave them here',
    })
    if (!ok) return
    setMsg(null)
    moveOut.mutate({ container_id: containerId, item_ids: unticked.map((i) => i.item_id) }, {
      onSuccess: (res) => {
        const r = res as { moved_items: number; homes_cleared: number }
        setMsg(`✅ Moved ${r.moved_items} item(s) to Unassigned`
          + (r.homes_cleared ? `; ${r.homes_cleared} empty "lives here" mark(s) cleared` : '') + '.')
      },
      onError: (err) => setMsg(`⚠️ Nothing was moved: ${(err as Error).message}`),
    })
  }
  const tickHere = (i: ItemListRow, on: boolean) => {
    if (auditId === null || containerId === null) return
    setMsg(null)
    verify.mutate({ auditId, item_id: i.item_id, container_id: containerId, verified: on }, {
      onError: (err) => setMsg(`⚠️ Not recorded: ${(err as Error).message}`),
    })
  }
  const fromUnassigned = source === 'unassigned'
  const q = search.trim().toLowerCase()
  const candidates = ((fromUnassigned ? unassigned : everything) ?? [])
    .filter((i) => type === 'all' || i.item_type === type)
    .filter((i) => !q || i.item_name.toLowerCase().includes(q))
  const capped = !fromUnassigned && !showAll
  const visible = capped ? candidates.slice(0, EVERYTHING_CAP) : candidates

  // From Unassigned the stow MOVES stock, so default to all of it (as the Locker does).
  const lineFor = (i: ItemListRow): StowLine => ({
    item_id: i.item_id, item_name: i.item_name, unit: i.unit,
    qty: fromUnassigned && Number(i.qty_in_container) > 0 ? Number(i.qty_in_container) : 1,
  })
  const toggle = (i: ItemListRow) =>
    setSelected((m) => {
      const n = new Map(m)
      if (n.has(i.item_id)) n.delete(i.item_id)
      else n.set(i.item_id, lineFor(i))
      return n
    })
  const selectAllShown = () =>
    setSelected((m) => {
      const n = new Map(m)
      for (const i of visible) if (!n.has(i.item_id)) n.set(i.item_id, lineFor(i))
      return n
    })

  const inGalley = (containers ?? []).find((c) => c.container_id === containerId)?.compartment_name === 'Galley'
  const addNew = (itemId: number, itemName: string, unit: string) => {
    setCreating(null); setSearch('')
    setSelected((m) => new Map(m).set(itemId, { item_id: itemId, item_name: itemName, unit, qty: 1 }))
  }

  const setChoice = (id: number, choice: StowChoice, suggestedQty?: number) =>
    setSelected((m) => {
      const n = new Map(m); const l = n.get(id)
      if (l) n.set(id, { ...l, choice, qty: suggestedQty ?? l.qty })
      return n
    })
  const commit = (lines: StowRequestLine[]) => {
    if (containerId === null) return
    setMsg(null)
    stow.mutate({ container_id: containerId, lines }, {
      onSuccess: (res) => {
        const r = res as { added: number; merged: number; homes?: number; moved?: number }
        setMsg(`✅ Put ${lines.length} item(s) in ${containerLabel}`
          + (r.moved ? ` (${r.moved} moved out of Unassigned)` : '')
          + ((r as { moved_between?: number }).moved_between ? ` (${(r as { moved_between?: number }).moved_between} moved from another container)` : '')
          + (r.homes ? ` (${r.homes} marked as living here, nothing added)` : '')
          + (r.merged ? ` (${r.merged} already had stock there - quantity added to it)` : '') + '.')
        setSelected(new Map())
      },
      onError: (err) => setMsg(`⚠️ Nothing was changed: ${(err as Error).message}`),
    })
  }

  return (
    <div className="stow-by-container-tab">
      <h2>🧺 Work a Container</h2>
      <p className="mgmt-status">
        Pick a container: first tick what you can see in it now (each tick is recorded as verified
        here, in the open audit), then tick what else belongs there - one commit puts them all in.
      </p>
      <label className="stow-container-pick">
        Container{' '}
        <ContainerPickerWithLabel
          value={containerId}
          // v9: the ticked add-list items, search and filters SURVIVE a change of target (the owner 10-08) -
          // ItemStowPanel re-checks each line's Move / Add-extra pick against the new target.
          onChange={(id, label) => { setContainerId(id); setContainerLabel(label); setMsg(null) }}
        />
      </label>

      {containerId !== null && (
        <>
          {msg && <p className="mgmt-status">{msg}</p>}
          <h3>
            <button type="button" className="link-button stow-here-toggle" aria-expanded={hereOpen} onClick={() => setHereOpen((o) => !o)}>
              {hereOpen ? '▾' : '▸'} 📦 In here now ({hereNow.length}){openAudit ? ` - ${tickedCount} verified` : ''}
            </button>
          </h3>
          {hereOpen && (<>
          {openAudit ? (
            <p className="mgmt-status">
              Tick each item you can see here - it is recorded as verified here today in the audit
              “{openAudit.name}”. Verified {tickedCount} of {hereNow.length}.
            </p>
          ) : (
            <div className="mgmt-toolbar">
              <span className="mgmt-status">Ticks are recorded in an inventory audit, and none is open.</span>
              <input type="text" value={auditName} onChange={(e) => setAuditName(e.target.value)} />
              <button
                type="button" disabled={!auditName.trim() || createAudit.isPending}
                onClick={() => createAudit.mutate({ name: auditName.trim(), scope: 'full' }, {
                  onError: (err) => setMsg(`⚠️ Audit not started: ${(err as Error).message}`),
                })}
              >Start audit</button>
            </div>
          )}
          <ul className="audit-tick-candidates stow-here-list">
            {hereNow.map((i) => (
              <li key={i.item_id}>
                <CheckRow
                  checked={verifiedNow.has(i.item_id)} onToggle={(on) => tickHere(i, on)}
                  disabled={auditId === null || verify.isPending}
                  to={{ kind: 'item', id: i.item_id }}
                  name={<span className="stow-name">{i.item_name}</span>}
                >
                  <span className="stow-unit">{typeLabel(itemTypes, i.item_type)}</span>
                  <span className="stow-unit">
                    {Number(i.qty_in_container) > 0 ? `${i.qty_in_container} ${i.unit} here` : 'lives here (none on hand)'}
                    {Number(i.quantity_onhand) > Number(i.qty_in_container ?? 0) ? ` · ${i.quantity_onhand} aboard in all` : ''}
                    {i.last_verified_on ? ` · ✓ verified here ${i.last_verified_on}` : ' · not verified here yet'}
                  </span>
                </CheckRow>
              </li>
            ))}
            {here && hereNow.length === 0 && <li className="mgmt-empty">Nothing is recorded in this container yet.</li>}
          </ul>
          </>)}
          {openAudit && hereNow.length > 0 && (
            <p>
              <button type="button" onClick={finishContainer} disabled={moveOut.isPending}>
                ✔ Done with this container{unticked.length ? ` - ${unticked.length} not ticked…` : ''}
              </button>
            </p>
          )}

          <h3>➕ Add to this container</h3>
          <div className="mgmt-toolbar">
            <select value={source} onChange={(e) => { setSource(e.target.value as 'unassigned' | 'all'); setShowAll(false) }}>
              <option value="unassigned">From Unassigned ({unassigned?.length ?? '…'})</option>
              <option value="all">From everything ({everything?.length ?? '…'})</option>
            </select>
            <input
              type="text" placeholder="🔍 Search by name"
              value={search} onChange={(e) => setSearch(e.target.value)}
            />
            <select value={type} onChange={(e) => setType(e.target.value as ItemType | 'all')}>
              <option value="all">All types</option>
              {itemTypes?.map((t) => <option key={t.type_key} value={t.type_key}>{typeLabel(itemTypes, t.type_key)}</option>)}
            </select>
            {/* only once a search / type narrows it - one tap must never stow all of Unassigned */}
            {visible.length > 0 && (q || type !== 'all') && (
              <button type="button" onClick={selectAllShown}>Select all shown ({visible.length})</button>
            )}
          </div>
          <ul className="audit-tick-candidates">
            <li>
              {creating === null ? (
                <button type="button" className="link-button" onClick={() => setCreating(search.trim())}>
                  {search.trim() ? `＋ Add “${search.trim()}” as a new item (not in the catalog yet)` : '＋ New item (not in the catalog yet)…'}
                </button>
              ) : (
                <NewFoundItem typed={creating} food={inGalley} onCancel={() => setCreating(null)} onDone={addNew} />
              )}
            </li>
            {visible.map((i) => (
              <li key={i.item_id}>
                <CheckRow
                  checked={selected.has(i.item_id)} onToggle={() => toggle(i)}
                  to={{ kind: 'item', id: i.item_id }}
                  name={<span className="stow-name">{i.item_name}</span>}
                >
                  <span className="stow-unit">{typeLabel(itemTypes, i.item_type)}</span>
                  <span className="stow-unit">
                    {fromUnassigned
                      ? `${i.qty_in_container ?? 0} ${i.unit} in Unassigned`
                      : Number(i.quantity_onhand) > 0 ? `have ${i.quantity_onhand} ${i.unit}${i.locations ? ` (${i.locations})` : ''}` : 'no stock yet'}
                    {hereIds.has(i.item_id) ? ' · already in this container' : ''}
                  </span>
                </CheckRow>
              </li>
            ))}
            {candidates.length === 0 && (
              <li className="mgmt-empty">{fromUnassigned && !q && type === 'all' ? 'Unassigned is empty.' : 'No matching items.'}</li>
            )}
          </ul>
          {candidates.length > visible.length && (
            <p className="mgmt-status">
              Showing the first {visible.length} of {candidates.length}.{' '}
              <button type="button" className="link-button" onClick={() => setShowAll(true)}>Show all {candidates.length}</button>
            </p>
          )}
          <ItemStowPanel
            lines={Array.from(selected.values())}
            onQty={(id, qty) => setSelected((m) => { const n = new Map(m); const l = n.get(id); if (l) n.set(id, { ...l, qty }); return n })}
            onRemove={(id) => setSelected((m) => { const n = new Map(m); n.delete(id); return n })}
            onClear={() => setSelected(new Map())}
            container={containerId} fixedContainerLabel={containerLabel ?? undefined}
            actionLabel={`Put ${selected.size} in this container`}
            busy={stow.isPending}
            onCommit={commit} onChoice={setChoice}
          />
        </>
      )}
    </div>
  )
}

// ContainerPicker only reports the id - this screen also needs the picked label for its
// messages and for ItemStowPanel's fixed-container display, so it reads the same list once
// more and matches on the picked id rather than duplicating ContainerPicker's own markup.
function ContainerPickerWithLabel({
  value, onChange,
}: { value: number | null; onChange: (id: number | null, label: string | null) => void }) {
  const { data: containers } = useContainers()
  return (
    <ContainerPicker
      value={value}
      allowUnassigned={false}
      onChange={(id) => {
        const c = (containers ?? []).find((x) => x.container_id === id)
        onChange(id, c ? `${c.compartment_name} › ${c.location_name} › ${c.container_name}` : null)
      }}
    />
  )
}

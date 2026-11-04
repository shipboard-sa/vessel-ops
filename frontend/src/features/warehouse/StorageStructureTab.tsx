/**
 * Purpose: Admin UI for the storage compartment -> location -> container hierarchy
 *   (Warehouse's "Edit Storage Structure" tab).
 * Version: v5 (2026-09-24) - v5: rebuilt on StorageColumns, the same Compartment › Location ›
 *   Container tap columns as the container picker (Owner: keep the interface consistent); the
 *   deepest selected thing opens in an edit panel beside them (rename / kind / notes / ⭐ /
 *   move / delete); "Move to…" opens the same columns to pick the destination instead of a long
 *   <select>. v4 (2026-09-20): tap-safe confirms on every delete; container move (#45, #46).
 * Scope: PRODUCTION - mx-inv frontend, warehouse feature.
 * Architecture: StorageColumns (walk + create) + Compartment/Location/ContainerPanel (edit) +
 *   StorageMoveDialog (ContainerCascade.tsx) for moves. Talks to backend/routers/storage.py via
 *   useWarehouse.ts / mutations.ts; the server re-checks every delete (409 when stock would be
 *   orphaned), so the disabled buttons here are convenience, not the guard.
 */
import { useState } from 'react'
import { CONTAINER_TYPES, type Compartment, type Container, type ContainerType, type Location } from '../../api/types'
import { useConfirm } from '../../components/ConfirmDialog'
import { useCompartments, useContainers, useLocations } from './useWarehouse'
import {
  useDeleteCompartment, useDeleteContainer, useDeleteLocation,
  useRenameCompartment, useUpdateContainer, useUpdateLocation, type ContainerEditFields,
} from './mutations'
import { EMPTY_SEL, StorageColumns, type StorageSel } from './StorageColumns'
import { StorageMoveDialog } from './ContainerCascade'

function apiErrorMessage(error: unknown): string {
  const detail = (error as { detail?: { message?: string } } | null)?.detail
  return detail?.message ?? (error as Error).message
}

export function StorageStructureTab() {
  const { data: compartments } = useCompartments()
  const { data: locations } = useLocations()
  const { data: containers } = useContainers()
  const [sel, setSel] = useState<StorageSel>(EMPTY_SEL)
  const [done, setDone] = useState<string | null>(null)

  const comp = (compartments ?? []).find((c) => c.compartment_id === sel.compId) ?? null
  const loc = (locations ?? []).find((l) => l.location_id === sel.locId) ?? null
  const cont = (containers ?? []).find((c) => c.container_id === sel.containerId) ?? null
  const select = (next: StorageSel) => { setSel(next); setDone(null) }

  return (
    <div className="storage-structure-tab">
      <h2>🏗️ Edit Vessel Storage Structure</h2>
      <p className="mgmt-status">
        Three levels: a <strong>compartment</strong> (Salon, Master Berth, Engine Room...) holds
        <strong> locations</strong> (Port Cabinet - AFT), and each location holds
        <strong> containers</strong> (the actual bin, drawer, freezer - or "loose" for stuff stowed
        straight in the location). Tap through the columns - the same ones every container picker
        uses - and whatever you tapped last opens on the right to rename, move or delete. "＋ New …"
        is the first row of each column. Renaming does not move anything stored inside; a new
        location gets a "loose" container automatically. ☆ a container to make it a one-tap
        favorite in every container picker.
      </p>

      <div className="cc-manage">
        <StorageColumns sel={sel} onSelect={select} starToggle />
        <div className="cc-panel">
          {cont ? (
            <ContainerPanel key={`c${cont.container_id}`} c={cont} onGone={() => select({ ...sel, containerId: null })}
              onMoved={(dest, msg) => { setSel({ compId: dest.compartment_id, locId: dest.location_id, containerId: cont.container_id }); setDone(msg) }} />
          ) : loc ? (
            <LocationPanel key={`l${loc.location_id}`} l={loc} containers={(containers ?? []).filter((c) => c.location_id === loc.location_id)}
              onGone={() => select({ ...sel, locId: null })}
              onMoved={(destComp, msg) => { setSel({ compId: destComp, locId: loc.location_id, containerId: null }); setDone(msg) }} />
          ) : comp ? (
            <CompartmentPanel key={`p${comp.compartment_id}`} c={comp} onGone={() => select(EMPTY_SEL)} />
          ) : (
            <p className="cc-panel-note">Tap a compartment, location or container to edit it here.</p>
          )}
          {done && <p className="cc-panel-ok">✅ {done}</p>}
        </div>
      </div>
    </div>
  )
}

/** Name box + Save; Enter saves. Re-keyed per record by the caller so the draft resets. */
function RenameField({ value, busy, onSave }: { value: string; busy: boolean; onSave: (name: string) => void }) {
  const [draft, setDraft] = useState(value)
  const changed = draft.trim() && draft.trim() !== value
  return (
    <label className="cc-field">
      <span>Name</span>
      <div className="cc-field-row">
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && changed) { e.preventDefault(); onSave(draft.trim()) } }} />
        <button type="button" className="cc-btn" disabled={!changed || busy} onClick={() => onSave(draft.trim())}>Save</button>
      </div>
    </label>
  )
}

function CompartmentPanel({ c, onGone }: { c: Compartment; onGone: () => void }) {
  const confirm = useConfirm()
  const rename = useRenameCompartment()
  const del = useDeleteCompartment()
  const blocked = c.location_count > 0
  return (
    <>
      <div className="cc-panel-kind">Compartment</div>
      <h3>{c.compartment_name}</h3>
      <p className="cc-panel-path">{c.location_count} location(s)</p>
      <RenameField value={c.compartment_name} busy={rename.isPending}
        onSave={(name) => rename.mutate({ compartmentId: c.compartment_id, name })} />
      <div className="cc-panel-actions">
        <button type="button" className="cc-btn cc-btn--danger" disabled={blocked || del.isPending}
          title={blocked ? 'Move or delete its locations first' : 'Delete'}
          onClick={async () => {
            if (await confirm({
              title: `Delete the compartment "${c.compartment_name}"?`,
              message: 'It has no locations left in it.',
              confirmLabel: 'Delete compartment',
            })) del.mutate(c.compartment_id, { onSuccess: onGone })
          }}>🗑 Delete</button>
      </div>
      {blocked && <p className="cc-panel-note">Only an empty compartment can be deleted - move or delete its locations first.</p>}
      {(rename.isError || del.isError) && <p className="mgmt-status mgmt-status--error">{apiErrorMessage(rename.error ?? del.error)}</p>}
    </>
  )
}

function LocationPanel({ l, containers, onGone, onMoved }: {
  l: Location; containers: Container[]; onGone: () => void; onMoved: (compId: number, msg: string) => void
}) {
  const confirm = useConfirm()
  const { data: compartments } = useCompartments()
  const update = useUpdateLocation()
  const del = useDeleteLocation()
  const [moving, setMoving] = useState(false)
  // Deleting a location takes its (empty) containers with it, but must never orphan stock:
  // blocked here up front and re-checked server-side (409).
  const withStock = containers.filter((c) => c.stock_rows > 0)
  const blocked = withStock.length > 0
  return (
    <>
      <div className="cc-panel-kind">Location</div>
      <h3>{l.location_name}</h3>
      <p className="cc-panel-path">in {l.compartment_name} · {containers.length} container(s)</p>
      <RenameField value={l.location_name} busy={update.isPending}
        onSave={(name) => update.mutate({ locationId: l.location_id, fields: { location_name: name } })} />
      <div className="cc-panel-actions">
        <button type="button" className="cc-btn" onClick={() => setMoving(true)}>↪ Move to another compartment…</button>
        <button type="button" className="cc-btn cc-btn--danger" disabled={blocked || del.isPending}
          title={blocked ? `Move or remove the stock in ${withStock.map((c) => c.container_name).join(', ')} first` : 'Delete this location (and its empty containers)'}
          onClick={async () => {
            const names = containers.map((c) => c.container_name).join(', ')
            if (await confirm({
              title: `Delete the location "${l.location_name}"?`,
              message: containers.length > 0 ? `Its ${containers.length} empty container(s) (${names}) are deleted with it.` : 'It has no containers.',
              confirmLabel: 'Delete location',
            })) del.mutate(l.location_id, { onSuccess: onGone })
          }}>🗑 Delete</button>
      </div>
      {blocked && <p className="cc-panel-note">Holds stock in {withStock.map((c) => c.container_name).join(', ')} - move or remove it before deleting.</p>}
      {(update.isError || del.isError) && <p className="mgmt-status mgmt-status--error">{apiErrorMessage(update.error ?? del.error)}</p>}
      {moving && (
        <StorageMoveDialog
          what={l.location_name} depth={1} here={{ compId: l.compartment_id }}
          onClose={() => setMoving(false)}
          onMove={(compId) => {
            setMoving(false)
            const dest = (compartments ?? []).find((c) => c.compartment_id === compId)
            update.mutate({ locationId: l.location_id, fields: { compartment_id: compId } }, {
              onSuccess: () => onMoved(compId, `Moved "${l.location_name}" from ${l.compartment_name} to ${dest?.compartment_name ?? 'the new compartment'}.`),
            })
          }}
        />
      )}
    </>
  )
}

function ContainerPanel({ c, onGone, onMoved }: {
  c: Container; onGone: () => void; onMoved: (dest: Location, msg: string) => void
}) {
  const confirm = useConfirm()
  const { data: locations } = useLocations()
  const update = useUpdateContainer()
  const del = useDeleteContainer()
  const [moving, setMoving] = useState(false)
  const [notes, setNotes] = useState(c.notes ?? '')
  const set = (fields: ContainerEditFields) => update.mutate({ containerId: c.container_id, fields })

  const moveTo = async (dest: Location) => {
    setMoving(false)
    // A container carrying stock takes that stock with it, so say so first; an empty one just moves.
    if (c.stock_rows > 0 && !(await confirm({
      title: `Move "${c.container_name}" to ${dest.compartment_name} › ${dest.location_name}?`,
      message: `Its ${c.stock_rows} stock row(s) move with it - they will show up in the new location. You can move it back the same way.`,
      confirmLabel: 'Move it',
      cancelLabel: "Don't move",
    }))) return
    update.mutate({ containerId: c.container_id, fields: { location_id: dest.location_id } }, {
      onSuccess: () => onMoved(dest, `Moved "${c.container_name}" from ${c.compartment_name} › ${c.location_name} to ${dest.compartment_name} › ${dest.location_name}.`),
    })
  }

  return (
    <>
      <div className="cc-panel-kind">Container</div>
      <h3>{c.favorite ? '⭐ ' : ''}{c.container_name}</h3>
      <p className="cc-panel-path">{c.compartment_name} › {c.location_name} · {c.stock_rows} stock row(s)</p>
      <RenameField value={c.container_name} busy={update.isPending} onSave={(name) => set({ container_name: name })} />
      <label className="cc-field">
        <span>Kind</span>
        <select value={c.container_type} onChange={(e) => set({ container_type: e.target.value as ContainerType })}>
          {CONTAINER_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
        </select>
      </label>
      <label className="cc-field">
        <span>Notes</span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
          onBlur={() => { if (notes.trim() !== (c.notes ?? '')) set({ notes: notes.trim() || null }) }} />
      </label>
      <label className="cc-field">
        <span>Favorite</span>
        <button type="button" className="cc-btn" onClick={() => set({ favorite: c.favorite ? 0 : 1 })}>
          {c.favorite ? '★ Favorite - tap to un-star' : '☆ Make it a favorite'}
        </button>
      </label>
      <div className="cc-panel-actions">
        <button type="button" className="cc-btn" onClick={() => setMoving(true)}>↪ Move to another location…</button>
        <button type="button" className="cc-btn cc-btn--danger" disabled={c.stock_rows > 0 || del.isPending}
          title={c.stock_rows > 0 ? 'Empty the container first' : 'Delete'}
          onClick={async () => {
            if (await confirm({
              title: `Delete the container "${c.container_name}" in ${c.location_name}?`,
              message: 'It is empty, so no stock is lost.',
              confirmLabel: 'Delete container',
            })) del.mutate(c.container_id, { onSuccess: onGone })
          }}>🗑 Delete</button>
      </div>
      {c.stock_rows > 0 && <p className="cc-panel-note">Holds {c.stock_rows} stock row(s) - moving takes them along; empty it before deleting.</p>}
      {(update.isError || del.isError) && <p className="mgmt-status mgmt-status--error">{apiErrorMessage(update.error ?? del.error)}</p>}
      {moving && (
        <StorageMoveDialog
          what={c.container_name} depth={2} here={{ locId: c.location_id }}
          onClose={() => setMoving(false)}
          onMove={(locId, compId) => {
            // A location made on the spot in the dialog is not in the list until it refetches.
            const dest = (locations ?? []).find((l) => l.location_id === locId)
              ?? { location_id: locId, location_name: 'the new location', compartment_id: compId, compartment_name: '' }
            void moveTo(dest)
          }}
        />
      )}
    </>
  )
}

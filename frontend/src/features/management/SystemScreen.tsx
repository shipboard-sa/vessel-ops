/**
 * Purpose: Full-screen view of ONE system or device: its details (make/model, manual,
 *   installed qty, "no spares needed", notes), its devices (if it has any), its tasks and its
 *   parts/spare units - plus rename / move / delete.
 * Version: v10 (2026-09-24) - v10: Move… and the delete's "move what uses it" pick open SystemCascade
 *   (System › Device tap columns, same view as the container picker) instead of long <select>s.
 *   v9 (2026-09-23) - v9 (tracker #74): "device of <system>" opens the parent system; the
 *   task and its current system named in the "Move … here?" confirm open their own pages.
 *   v8 (2026-09-23) - v8 (tracker #72): "🔍 Find an existing task to file here" under
 *   the Tasks list - search every standalone task and move it onto this system/device. Also
 *   (tracker #75/#76): the part search offers "＋ Add '<typed>' as a new item" and links it here
 *   (it used to say "add it from the Warehouse first").
 *   v7 (2026-09-22): device identity fields (installed on / serial / warranty
 *   until, schema v32, tracker #44) on the Details form, with a warranty-expiry hint.
 *   v6 (2026-09-22): "📋 Clone with rename" duplicates a fully set-up device - its
 *   details, its part links and independent copies of its tasks - under a new name (tracker #67);
 *   fixed a duplicate React key (DeviceDetails and DeviceResearchPanel were siblings both keyed
 *   key={name}, which warned on every device screen since v5). v5 (2026-09-22): mounts
 *   DeviceResearchPanel ("Research with Claude" - tracker #50
 *   GUI build). v4: a part row's "open in the Warehouse" now returns here instead of always
 *   landing on the Locker list (returnTab/returnTrail via AppNav, tracker #58); added AddPart
 *   (link an existing catalog item here) and AddTask (+ New task, system pre-filled) - tracker
 *   #52. v3: rename/move/delete clear their shared error banner when a new action starts or is
 *   cancelled (tracker #51/#57) - v2 was 2026-09-21, v1 2026-09-19
 * Scope: PRODUCTION - mx-inv frontend, management feature.
 * Architecture: Rendered inside a FocusScreen by ManagementView and ProjectsView (one shared
 *   navigation trail, see focusKeys.ts). Reads useSystems / useTasks / useSystemItems; writes
 *   through management/mutations (PATCH/rename/delete on /api/tasks/systems). Navigation is
 *   handed up: onOpenTask pushes a task, onOpenSystem a device. SYSTEM > DEVICE > PARTS is the
 *   vocabulary the owner settled on 2026-09-19 (a device is a bucket in the systems tree, not stock).
 *   Absorbs the row controls of the old SystemsAdmin panel; no nested <form>s.
 */
import { useState } from 'react'
import type { SystemInfo, SystemItem } from '../../api/types'
import { useSystemItems, useSystems, useTasks } from './useTasks'
import {
  useCloneSystem, useCreateSystem, useCreateTask, useDeleteSystem, useRenameSystem, useUpdateSystem,
  useUpdateTask, type CloneSystemSummary,
} from './mutations'
import { systemErrorMessage } from './SystemsList'
import { useConfirm } from '../../components/ConfirmDialog'
import { SystemCascade } from './SystemCascade'
import { offerableSystems } from './housekeeping'
import { useAppNav, type ReturnTarget } from '../../components/AppNav'
import { useItems } from '../warehouse/useWarehouse'
import { useSetItemSystems } from '../warehouse/mutations'
import { apiGet } from '../../api/client'
import { DeviceResearchPanel } from './DeviceResearchPanel'
import { NewStuffItemForm } from '../warehouse/NewStuffItemForm'
import { RecordLink } from '../../components/RecordLink'

const TYPE_LABEL: Record<string, string> = {
  spare_unit: '🔁 Spare unit', part: '⚙️ Part', supply: '🧴 Supply', tool: '🔧 Tool',
  tool_accessory: '🪛 Accessory', gear: '🎒 Gear', food: '🥫 Food',
}

export function SystemScreen({
  name, onOpenTask, onOpenSystem, onRenamed, onMoved, onDeleted, returnTab, returnTrail,
}: {
  name: string
  onOpenTask: (taskId: number) => void
  onOpenSystem: (name: string) => void
  /** The system was renamed - the trail entry must follow. */
  onRenamed: (newName: string) => void
  /** A device was moved under another system (or made top-level, null). */
  onMoved: (newParent: string | null) => void
  onDeleted: () => void
  /** Where a part row's "open in the Warehouse" should return to - this screen's own caller and
   *  its current trail (tracker #58, 2026-09-22: Back used to always land on the Locker list). */
  returnTab: 'management' | 'projects'
  returnTrail: unknown[]
}) {
  const { data: systems, isFetching } = useSystems()
  const { data: tasks } = useTasks()
  const { data: items } = useSystemItems(name)

  const system = (systems ?? []).find((s) => s.name === name)
  if (!systems || (!system && isFetching)) return <p className="mgmt-status">Loading…</p>
  // Renamed/deleted elsewhere: say so; Back (above) still works.
  if (!system) return <p className="mgmt-status mgmt-status--error">“{name}” no longer exists.</p>

  const children = systems.filter((s) => s.parent_name === name).sort((a, b) => a.name.localeCompare(b.name))
  const isDevice = system.parent_name !== null
  const hasDevices = children.length > 0
  const ownTasks = (tasks ?? []).filter((t) => t.system === name && t.parent_task_id === null)
  // Steps of a checklist / subtasks are filed under the same system but open through their
  // parent, so they are counted here rather than listed (the tree's "N tasks" includes them).
  const stepCount = (tasks ?? []).filter((t) => t.system === name && t.parent_task_id !== null).length
  const taskTotal = system.task_count + children.reduce((n, c) => n + c.task_count, 0)

  return (
    <div className="system-screen">
      <div className="system-screen-header">
        <h2>{name}</h2>
        <span className="system-screen-kind">
          {isDevice
            ? <>device of <RecordLink to={{ kind: 'system', name: system.parent_name! }}>{system.parent_name}</RecordLink></>
            : hasDevices ? 'system' : 'system (no devices)'}
        </span>
      </div>

      <SystemControls
        system={system} systems={systems} hasDevices={hasDevices}
        onRenamed={onRenamed} onMoved={onMoved} onDeleted={onDeleted}
        onCloned={onOpenSystem}
      />

      {/* Both remount when the device changes (the key) so their local edit buffers reset -
          but they are siblings, so the keys must also differ from each other. Sharing
          key={name} made React warn about duplicate keys on every device screen. */}
      {(isDevice || !hasDevices) && <DeviceDetails key={`details:${name}`} system={system} />}
      {(isDevice || !hasDevices) && <DeviceResearchPanel key={`research:${name}`} system={system} />}

      {!isDevice && (
        <section className="system-section">
          <h3>Devices ({children.length})</h3>
          {children.length === 0 && <p className="mgmt-status">No devices under this system.</p>}
          <ul className="system-rows">
            {children.map((c) => (
              <li key={c.name} onClick={() => onOpenSystem(c.name)}>
                <span className="system-row-name">{c.name}</span>
                <span className="systems-tree-meta">
                  {c.task_count} task{c.task_count === 1 ? '' : 's'} · {c.item_count} part{c.item_count === 1 ? '' : 's'}
                  {c.installed_qty > 1 && ` · ×${c.installed_qty} installed`}
                </span>
                {c.no_spares_needed ? (
                  <span className="systems-tree-badge">no spares needed</span>
                ) : c.item_count === 0 ? (
                  <span className="systems-tree-badge systems-tree-badge--warn">no parts linked</span>
                ) : null}
              </li>
            ))}
          </ul>
          <AddDevice parent={name} systems={systems} />
        </section>
      )}

      <section className="system-section">
        <h3>
          Tasks ({ownTasks.length})
          {hasDevices && <span className="system-section-note"> on {name} itself; {taskTotal} including its devices</span>}
          {stepCount > 0 && (
            <span className="system-section-note"> · plus {stepCount} step{stepCount === 1 ? '' : 's'} inside their parent task</span>
          )}
        </h3>
        {ownTasks.length === 0 && <p className="mgmt-status">No tasks are filed directly under {name}.</p>}
        <ul className="system-rows">
          {ownTasks.map((t) => (
            <li key={t.task_id} onClick={() => onOpenTask(t.task_id)}>
              <span className="mgmt-kind-badge">{t.task_kind === 'checklist' ? '✅' : '🛠️'}</span>
              <span className="system-row-name">{t.task_name}</span>
              {!!t.is_critical && <span className="mgmt-critical-dot" title="Critical" />}
            </li>
          ))}
        </ul>
        <AddTask system={name} />
        <FileExistingTask system={name} />
      </section>

      {(isDevice || !hasDevices) && (
        <section className="system-section">
          <h3>
            Parts and spare units ({items?.length ?? '…'})
            {!!system.no_spares_needed && <span className="system-section-note"> · marked “no spares needed”</span>}
          </h3>
          <PartsList items={items} returnTab={returnTab} returnTrail={returnTrail} />
          <AddPart system={name} linkedItems={items ?? []} />
        </section>
      )}
    </div>
  )
}

function PartsList({
  items, returnTab, returnTrail,
}: {
  items: SystemItem[] | undefined
  returnTab: 'management' | 'projects'
  returnTrail: unknown[]
}) {
  const nav = useAppNav()
  if (!items) return <p className="mgmt-status">Loading…</p>
  if (items.length === 0) return <p className="mgmt-status">No part or spare unit is linked here yet.</p>
  const returnTo: ReturnTarget = { tab: returnTab, trail: returnTrail }
  return (
    <>
      {nav && <p className="mgmt-status">Tap a part to open its full record in the Warehouse.</p>}
      <ul className={nav ? 'system-rows' : 'system-rows system-rows--static'}>
      {items.map((it) => {
        const low = it.min_quantity !== null && it.quantity_onhand < it.min_quantity
        return (
          <li key={it.item_id} onClick={nav ? () => nav.openItem(it.item_id, returnTo) : undefined}>
            <span className="system-part-type">{TYPE_LABEL[it.item_type] ?? it.item_type}</span>
            <span className="system-row-name">{it.item_name}</span>
            <span className="systems-tree-meta">on hand {it.quantity_onhand} {it.unit}</span>
            {low && <span className="systems-tree-badge systems-tree-badge--warn">below reorder level</span>}
          </li>
        )
      })}
      </ul>
    </>
  )
}

// Link an existing catalog item (part/spare unit/supply/tool) to this system/device - tracker
// #52, 2026-09-22: the device screen could show parts but not add any. This links an EXISTING
// item (PUT /items/{id}/systems, additive to whatever it already serves); a brand new catalog
// item is created inline via NewStuffItemForm and linked here in the same pass (tracker #75/#76).
function AddPart({ system, linkedItems }: { system: string; linkedItems: SystemItem[] }) {
  const [search, setSearch] = useState('')
  const { data: results } = useItems('all', search.trim() || undefined)
  const setSystems = useSetItemSystems()
  const [linkingId, setLinkingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const linkedIds = new Set(linkedItems.map((it) => it.item_id))

  const link = async (itemId: number) => {
    setError(null)
    setLinkingId(itemId)
    try {
      const current = await apiGet<string[]>(`/items/${itemId}/systems`)
      if (!current.includes(system)) {
        await new Promise<void>((resolve, reject) =>
          setSystems.mutate({ itemId, systems: [...current, system] }, { onSuccess: () => resolve(), onError: reject }))
      }
      setSearch('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLinkingId(null)
    }
  }

  return (
    <div className="system-add-device">
      <div className="mgmt-inline-form">
        <input
          placeholder="🔍 Search parts/spares/supplies/tools to link here…"
          value={search} onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {search.trim() && (
        <ul className="system-rows system-rows--static">
          {!creating && (
            <li>
              <button type="button" className="link-search-hit link-search-hit--new" onClick={() => setCreating(true)}>
                ＋ Add “{search.trim()}” as a new item (not in the catalog yet)
              </button>
            </li>
          )}
          {(results ?? []).filter((r) => !linkedIds.has(r.item_id)).slice(0, 15).map((r) => (
            <li key={r.item_id}>
              <span className="system-part-type">{TYPE_LABEL[r.item_type] ?? r.item_type}</span>
              <span className="system-row-name">{r.item_name}</span>
              <button type="button" disabled={linkingId === r.item_id} onClick={() => link(r.item_id)}>
                {linkingId === r.item_id ? 'Linking…' : '+ Link here'}
              </button>
            </li>
          ))}
          {(results ?? []).filter((r) => !linkedIds.has(r.item_id)).length === 0 && (
            <li className="mgmt-empty">No match (or it is already linked here).</li>
          )}
        </ul>
      )}
      {creating && (
        <NewStuffItemForm
          initialName={search.trim()}
          createLabel="✓ Create and link here"
          onCancel={() => setCreating(false)}
          onDone={(res) => { setCreating(false); link(res.itemId) }}
        />
      )}
      {error && <p className="mgmt-status mgmt-status--error">{error}</p>}
    </div>
  )
}

// Look up an EXISTING task and file it under this system/device (tracker #72, 2026-09-23 - the
// device screen could make a new task but not find one that already exists). A task has exactly
// one system, so this MOVES it here (PATCH tasks.system); it says where the task is filed now
// before it moves. Steps of a checklist are left out - they belong to their parent's system.
function FileExistingTask({ system }: { system: string }) {
  const { data: tasks } = useTasks()
  const update = useUpdateTask()
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<number | null>(null)

  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (tasks ?? []).filter((t) => {
    if (t.system === system || t.parent_task_id !== null || t.retired) return false
    const hay = `${t.system} ${t.task_name}`.toLowerCase()
    return words.length > 0 && words.every((w) => hay.includes(w))
  })
  const shown = matches.slice(0, 12)
  const target = (tasks ?? []).find((t) => t.task_id === picked) ?? null

  return (
    <div className="system-add-device">
      <div className="mgmt-inline-form">
        <input
          placeholder="🔍 Find an existing task to file here…"
          value={search} onChange={(e) => { setSearch(e.target.value); setPicked(null) }}
        />
      </div>
      {words.length > 0 && !target && (
        <ul className="link-search-results">
          {shown.map((t) => (
            <li key={t.task_id}>
              <button type="button" className="link-search-hit" onClick={() => setPicked(t.task_id)}>
                <code>{t.system}</code> — {t.task_name}
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="mgmt-empty">No matching task (or it is already filed here).</li>}
          {matches.length > shown.length && (
            <li className="mgmt-status">Showing {shown.length} of {matches.length} - keep typing to narrow.</li>
          )}
        </ul>
      )}
      {target && (
        <div className="add-tasks-control">
          <span>
            Move <strong><RecordLink to={{ kind: 'task', id: target.task_id }}>{target.task_name}</RecordLink></strong>{' '}
            from <RecordLink to={{ kind: 'system', name: target.system }}><code>{target.system}</code></RecordLink>{' '}
            to <code>{system}</code>?
          </span>
          <button
            type="button" disabled={update.isPending}
            onClick={() => update.mutate(
              { taskId: target.task_id, fields: { system } },
              { onSuccess: () => { setPicked(null); setSearch('') } },
            )}
          >
            Move it here
          </button>
          <button type="button" onClick={() => setPicked(null)}>✕ Cancel</button>
        </div>
      )}
      {update.isError && <p className="mgmt-status mgmt-status--error">{(update.error as Error).message}</p>}
    </div>
  )
}

// A quick "+ New task" filed directly under this system/device - no system picker needed since
// it is already known (tracker #52, 2026-09-22). Creates and closes, same as the main Tasks
// list's own NewTaskForm; it does NOT jump straight to the new task (tried that - it raced the
// tasks-query refetch against ManagementView's "focused task vanished, back up" effect, which
// saw the not-yet-refetched list, decided the brand new task didn't exist, and bounced back here).
function AddTask({ system }: { system: string }) {
  const create = useCreateTask()
  const [expanded, setExpanded] = useState(false)
  const [name, setName] = useState('')

  if (!expanded) {
    return <button type="button" className="link-button" onClick={() => setExpanded(true)}>+ New task</button>
  }

  const add = () => {
    if (!name.trim()) return
    create.mutate(
      { system, task_name: name.trim(), task_kind: 'one_off', interval_type: 'break_fix' },
      { onSuccess: () => { setName(''); setExpanded(false) } },
    )
  }

  return (
    <div className="mgmt-inline-form">
      <input
        placeholder="Task name" value={name} autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
      />
      <button type="button" onClick={add} disabled={create.isPending || !name.trim()}>Create</button>
      <button type="button" onClick={() => { setExpanded(false); setName('') }}>Cancel</button>
      {create.error && <span className="mgmt-status mgmt-status--error">{(create.error as Error).message}</span>}
    </div>
  )
}

// make/model, manual, installed qty, "no spares needed" and notes - the device's own record.
function DeviceDetails({ system }: { system: SystemInfo }) {
  const update = useUpdateSystem()
  const [makeModel, setMakeModel] = useState(system.make_model ?? '')
  const [manual, setManual] = useState(system.manual_ref ?? '')
  const [qty, setQty] = useState(String(system.installed_qty ?? 1))
  const [noSpares, setNoSpares] = useState(!!system.no_spares_needed)
  const [installedOn, setInstalledOn] = useState(system.installed_on ?? '')
  const [serial, setSerial] = useState(system.serial ?? '')
  const [warrantyUntil, setWarrantyUntil] = useState(system.warranty_until ?? '')
  const [notes, setNotes] = useState(system.notes ?? '')
  const [saved, setSaved] = useState(false)

  // Purely informational - the warranty is a fact about the unit, not a task, so it does
  // not go on the schedule. It just answers "is this still covered?" while you are looking
  // at the device (the owner's rule: no formal PM machinery where a plain answer will do).
  const warrantyState = (() => {
    if (!warrantyUntil) return null
    const end = new Date(`${warrantyUntil}T00:00:00`)
    if (Number.isNaN(end.getTime())) return null
    const days = Math.round((end.getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000)
    if (days < 0) return { tone: 'out', text: `out of warranty (${-days} d ago)` }
    if (days <= 90) return { tone: 'soon', text: `in warranty, ${days} d left` }
    return { tone: 'ok', text: 'in warranty' }
  })()

  const save = () => {
    setSaved(false)
    update.mutate(
      {
        name: system.name,
        fields: {
          make_model: makeModel, manual_ref: manual, installed_qty: Number(qty),
          no_spares_needed: noSpares, notes: notes.trim() || null,
          installed_on: installedOn || null, serial: serial.trim() || null,
          warranty_until: warrantyUntil || null,
        },
      },
      { onSuccess: () => setSaved(true) },
    )
  }

  return (
    <section className="system-section system-details">
      <h3>Details</h3>
      <label>
        Make / model
        <input value={makeModel} onChange={(e) => { setMakeModel(e.target.value); setSaved(false) }}
          placeholder="e.g. make and model off the nameplate" />
      </label>
      <label>
        Manual (a path inside your Manuals folder)
        <input value={manual} onChange={(e) => { setManual(e.target.value); setSaved(false) }} />
      </label>
      <div className="system-details-row">
        <label>
          Installed qty
          <input type="number" min={1} step={1} value={qty}
            onChange={(e) => { setQty(e.target.value); setSaved(false) }} />
        </label>
        <label className="system-check">
          <input type="checkbox" checked={noSpares}
            onChange={(e) => { setNoSpares(e.target.checked); setSaved(false) }} />
          No spares needed (so the coverage check does not flag it)
        </label>
      </div>
      <div className="system-details-row">
        <label>
          Installed on
          <input type="date" value={installedOn}
            onChange={(e) => { setInstalledOn(e.target.value); setSaved(false) }} />
        </label>
        <label>
          Serial number
          <input value={serial} placeholder="off the nameplate"
            onChange={(e) => { setSerial(e.target.value); setSaved(false) }} />
        </label>
        <label>
          Warranty until
          <input type="date" value={warrantyUntil}
            onChange={(e) => { setWarrantyUntil(e.target.value); setSaved(false) }} />
          {warrantyState && (
            <span className={`system-warranty system-warranty--${warrantyState.tone}`}>
              {warrantyState.text}
            </span>
          )}
        </label>
      </div>

      <label>
        Notes
        <textarea rows={3} value={notes} onChange={(e) => { setNotes(e.target.value); setSaved(false) }} />
      </label>
      <div className="system-details-actions">
        <button type="button" onClick={save} disabled={update.isPending}>
          {update.isPending ? 'Saving…' : 'Save details'}
        </button>
        {saved && <span className="system-saved">✓ Saved</span>}
        {update.error && <span className="mgmt-status mgmt-status--error">{systemErrorMessage(update.error)}</span>}
      </div>
    </section>
  )
}

// rename / move under another system / delete - kept off the list so the list stays light.
function SystemControls({
  system, systems, hasDevices, onRenamed, onMoved, onDeleted, onCloned,
}: {
  system: SystemInfo
  systems: SystemInfo[]
  hasDevices: boolean
  onRenamed: (newName: string) => void
  onMoved: (newParent: string | null) => void
  onDeleted: () => void
  /** A clone was made - open it, so the next thing you do is check the copy. */
  onCloned: (newName: string) => void
}) {
  const update = useUpdateSystem()
  const rename = useRenameSystem()
  const remove = useDeleteSystem()
  const clone = useCloneSystem()
  const confirm = useConfirm()
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState(system.name)
  const [deleting, setDeleting] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [cloneName, setCloneName] = useState('')
  const [cloned, setCloned] = useState<CloneSystemSummary | null>(null)
  const [reassignTo, setReassignTo] = useState('')
  const [moving, setMoving] = useState(false)
  const [pickingReassign, setPickingReassign] = useState(false)

  const isDevice = system.parent_name !== null
  // A device moves under another top-level system (or becomes one); a top-level system can be
  // nested only if it has no devices of its own - the API enforces the same one-level rule.
  // Both pick in SystemCascade (mode "parent" lists top-level systems only).
  const canNest = !isDevice && !hasDevices
  const used = system.task_count > 0 || hasDevices

  // rename/move/delete share one error banner below - each is a separate mutation object, so a
  // failure sticks in its .error until that SAME mutation runs again (React Query only clears a
  // mutation's own error on its own next .mutate()). Without this, a failed rename left its error
  // banner showing indefinitely - through a later, successful Details save, a Move, a Cancel - and
  // looked like "the device screen randomly errors" (tracker #51/#57, 2026-09-22). Call this
  // whenever the user starts or abandons an action so the banner always reflects the truth.
  const resetErrors = () => { rename.reset(); update.reset(); remove.reset(); clone.reset() }

  const doClone = () => {
    const trimmed = cloneName.trim()
    if (!trimmed) return
    setCloned(null)
    clone.mutate({ name: system.name, newName: trimmed }, {
      onSuccess: (summary) => { setCloning(false); setCloneName(''); setCloned(summary) },
    })
  }

  const doRename = () => {
    const trimmed = newName.trim()
    if (!trimmed || trimmed === system.name) { setRenaming(false); return }
    rename.mutate({ name: system.name, newName: trimmed }, {
      onSuccess: () => { setRenaming(false); onRenamed(trimmed) },
    })
  }
  const doDelete = () =>
    remove.mutate({ name: system.name, reassignTo: reassignTo || undefined }, { onSuccess: onDeleted })

  return (
    <div className="system-controls">
      {renaming ? (
        <span className="system-controls-inline">
          <input value={newName} autoFocus onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); doRename() }
              if (e.key === 'Escape') setRenaming(false)
            }} />
          <button type="button" onClick={doRename} disabled={rename.isPending}>Rename</button>
          <button type="button" onClick={() => { setNewName(system.name); setRenaming(false); resetErrors() }}>Cancel</button>
        </span>
      ) : (
        <button type="button" onClick={() => { resetErrors(); setRenaming(true) }}>✏️ Rename</button>
      )}

      {(isDevice || canNest) && (
        <button type="button" onClick={() => { resetErrors(); setMoving(true) }}>↪ Move…</button>
      )}
      {moving && (
        <SystemCascade
          title={`Move “${system.name}” under…`}
          systems={offerableSystems(systems)}
          mode="parent"
          topLevelRow={isDevice}
          offWhy={(s) => (s.name === system.name ? 'this one' : s.name === system.parent_name ? 'here now' : null)}
          onClose={() => setMoving(false)}
          onPick={(parent) => {
            setMoving(false)
            update.mutate({ name: system.name, fields: { parent_name: parent } },
              { onSuccess: () => onMoved(parent) })
          }}
        />
      )}

      <button
        type="button"
        title="Duplicate this device - its details, its part links and its own copies of its tasks - under a new name"
        onClick={() => { resetErrors(); setCloned(null); setCloneName(''); setCloning(true) }}
      >
        📋 Clone with rename
      </button>

      <button type="button" className="danger" onClick={async () => {
        resetErrors()
        if (used) setDeleting(true)
        else if (await confirm({
          title: `Delete “${system.name}”?`,
          message: 'Nothing uses it, so nothing else is affected.',
          confirmLabel: isDevice ? 'Delete device' : 'Delete system',
        })) remove.mutate({ name: system.name }, { onSuccess: onDeleted })
      }}>
        🗑 Delete
      </button>

      {(update.error || rename.error || remove.error || clone.error) && (
        <p className="mgmt-status mgmt-status--error">
          {systemErrorMessage(update.error ?? rename.error ?? remove.error ?? clone.error)}
        </p>
      )}

      {cloning && (
        <div className="system-clone-panel">
          <p className="mgmt-status">
            Copies this {isDevice ? 'device' : 'system'}’s details, its {system.item_count} part
            link(s) and its {system.task_count} task(s). Each copied task is independent - its own
            schedule, due date and history - and starts as never-done. Steps of a checklist are not
            copied. Wherever “{system.name}” appears in a task title it becomes the new name.
          </p>
          <input
            value={cloneName} autoFocus placeholder="New name, e.g. Seaflo Pump 2"
            onChange={(e) => setCloneName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); doClone() }
              if (e.key === 'Escape') { setCloning(false); resetErrors() }
            }}
          />
          <button type="button" onClick={doClone} disabled={clone.isPending || !cloneName.trim()}>
            {clone.isPending ? 'Cloning…' : 'Create the clone'}
          </button>
          <button type="button" onClick={() => { setCloning(false); resetErrors() }}>Cancel</button>
        </div>
      )}

      {cloned && (
        <p className="mgmt-status system-clone-done">
          ✅ Created <button type="button" className="link-button" onClick={() => onCloned(cloned.new_name)}>
            {cloned.new_name}
          </button>{' '}
          — {cloned.tasks_copied} task(s), {cloned.parts_linked} part link(s),{' '}
          {cloned.task_items_copied} task/part requirement(s), {cloned.references_copied} reference(s).
          {cloned.renamed_in_titles > 0 && ` Renamed in ${cloned.renamed_in_titles} task title(s).`}
          {cloned.steps_skipped > 0 && ` ${cloned.steps_skipped} checklist step(s) filed under this device were NOT copied.`}
        </p>
      )}

      {deleting && (
        <div className="system-delete-panel">
          <p className="mgmt-status">
            {system.task_count} task(s){hasDevices && ' and its devices'} use this. Move them to another
            system first (pick one), or leave blank to just delete (tasks will fail to save until re-pointed).
          </p>
          <button type="button" onClick={() => setPickingReassign(true)}>
            {reassignTo ? `Move them to: ${reassignTo} (change)` : 'Pick where they go…'}
          </button>
          {reassignTo && <button type="button" onClick={() => setReassignTo('')}>✕ none</button>}
          {pickingReassign && (
            <SystemCascade
              title={`Move what uses “${system.name}” to…`}
              systems={offerableSystems(systems)}
              value={reassignTo || null}
              offWhy={(s) => (s.name === system.name || s.parent_name === system.name ? 'being deleted' : null)}
              onClose={() => setPickingReassign(false)}
              onPick={(name) => { setPickingReassign(false); setReassignTo(name ?? '') }}
            />
          )}
          <button type="button" className="danger" onClick={doDelete} disabled={remove.isPending}>
            Confirm delete
          </button>
          <button type="button" onClick={() => { setDeleting(false); resetErrors() }}>Cancel</button>
        </div>
      )}
    </div>
  )
}

function AddDevice({ parent, systems }: { parent: string; systems: SystemInfo[] }) {
  const create = useCreateSystem()
  const update = useUpdateSystem()
  const [name, setName] = useState('')
  const [nestPick, setNestPick] = useState('')
  // An existing top-level system with no devices of its own can be nested here as a device.
  const nestable = systems.filter(
    (s) => s.parent_name === null && s.name !== parent && !systems.some((x) => x.parent_name === s.name),
  ).sort((a, b) => a.name.localeCompare(b.name))

  const add = () => {
    if (!name.trim()) return
    create.mutate({ name: name.trim(), parent_name: parent }, { onSuccess: () => setName('') })
  }
  return (
    <div className="system-add-device">
      <div className="mgmt-inline-form">
        <input
          placeholder={`New device under ${parent}`} value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
        />
        <button type="button" onClick={add} disabled={create.isPending || !name.trim()}>+ Add device</button>
      </div>
      {nestable.length > 0 && (
        <div className="mgmt-inline-form">
          <select value={nestPick} onChange={(e) => setNestPick(e.target.value)}>
            <option value="">— or nest an existing system here —</option>
            {nestable.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
          <button type="button" disabled={!nestPick || update.isPending}
            onClick={() => update.mutate({ name: nestPick, fields: { parent_name: parent } },
              { onSuccess: () => setNestPick('') })}>
            Nest
          </button>
        </div>
      )}
      {(create.error || update.error) && (
        <p className="mgmt-status mgmt-status--error">{systemErrorMessage(create.error ?? update.error)}</p>
      )}
    </div>
  )
}

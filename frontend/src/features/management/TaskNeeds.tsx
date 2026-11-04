/**
 * Purpose: "What you need" for one task or checklist step - the parts, tools and supplies it
 *   calls for, with how many you have, where they are stowed and a SHORT flag - plus (when
 *   editing is allowed) a way to add and remove them (tracker #28, the owner 2026-09-20).
 * Version: v3 (2026-09-23) - v3 (tracker #74): each listed item's name opens the item.
 *   v2 (2026-09-23) - v2 (tracker #75/#76): the search offers "＋ Add '<typed>' as a new
 *   item" - creates the part/tool/supply inline (warehouse/NewStuffItemForm) and adds it to the
 *   list, instead of detouring through the Warehouse. v1 was 2026-09-20.
 * Scope: PRODUCTION - mx-inv frontend, management feature.
 * Architecture: Reads GET /api/tasks/{id}/items-demand (data.get_task_items: on-hand, shortfall
 *   and `stowed_at` per item - the same rows the Schedule card's "Items" list uses) and edits
 *   through PUT / DELETE /api/tasks/{id}/items/{item_id} (task_items). INFORMATION ONLY: nothing
 *   here draws stock - ticking a checklist step consumes nothing (the owner's decision); the Schedule
 *   card's Complete flow is still where stock is used. Shown by StepDetail (the step's Details
 *   screen, desktop and cockpit) and by TaskDetail (the full record). Item choice is a search
 *   over the catalog, never typed free text.
 */
import { useState } from 'react'
import { useTaskItemsDemand } from '../schedule/useTaskDetail'
import { useItems } from '../warehouse/useWarehouse'
import { useRemoveTaskItem, useSetTaskItem } from './mutations'
import { useConfirm } from '../../components/ConfirmDialog'
import { NewStuffItemForm } from '../warehouse/NewStuffItemForm'
import { RecordLink } from '../../components/RecordLink'

const TYPE_GLYPH: Record<string, string> = {
  part: '⚙️', spare_unit: '🔁', supply: '🧴', tool: '🔧', tool_accessory: '🪛', food: '🥫',
}

export function TaskNeeds({ taskId, canEdit }: { taskId: number; canEdit: boolean }) {
  const { data: items } = useTaskItemsDemand(taskId, true)
  const setItem = useSetTaskItem()
  const removeItem = useRemoveTaskItem()
  const confirm = useConfirm()
  const [editing, setEditing] = useState(false)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const q = search.trim()
  const { data: found } = useItems('all', q.length >= 2 ? q : undefined)

  const linked = new Set((items ?? []).map((i) => i.item_id))
  const results = q.length >= 2 ? (found ?? []).filter((f) => !linked.has(f.item_id)).slice(0, 10) : []
  const error = setItem.error ?? removeItem.error

  return (
    <div className="task-needs">
      <div className="task-needs-head">
        <h3>What you need</h3>
        {canEdit && (
          <button type="button" className="link-button" onClick={() => setEditing((v) => !v)}>
            {editing ? '✓ Done editing' : '✏️ Edit list'}
          </button>
        )}
      </div>

      {!items ? (
        <p className="mgmt-status">Loading…</p>
      ) : items.length === 0 ? (
        <p className="mgmt-status">
          Nothing listed.{canEdit ? ' Use “Edit list” to add the parts, tools and supplies this needs.' : ''}
        </p>
      ) : (
        <ul className="task-needs-list">
          {items.map((it) => (
            <li key={it.item_id} className={it.shortfall > 0 ? 'task-needs-short' : undefined}>
              <div className="task-needs-main">
                <span className="task-needs-name">
                  {TYPE_GLYPH[it.item_type] ?? '•'}{' '}
                  <RecordLink to={{ kind: 'item', id: it.item_id }}>{it.item_name}</RecordLink>
                </span>
                {editing ? (
                  <span className="task-needs-edit">
                    <input
                      type="number" min={0} step="any" defaultValue={it.quantity_required}
                      title={`How many ${it.unit} the task needs`}
                      onBlur={(e) => {
                        const quantity_required = Number(e.target.value)
                        if (quantity_required > 0 && quantity_required !== it.quantity_required) {
                          setItem.mutate({ taskId, itemId: it.item_id, quantity_required, amount_note: it.amount_note })
                        }
                      }}
                    />
                    <span>{it.unit}</span>
                    <input
                      type="text" placeholder="note, e.g. a few drops" defaultValue={it.amount_note ?? ''}
                      onBlur={(e) => {
                        if ((e.target.value.trim() || null) !== (it.amount_note ?? null)) {
                          setItem.mutate({
                            taskId, itemId: it.item_id, quantity_required: it.quantity_required,
                            amount_note: e.target.value.trim() || null,
                          })
                        }
                      }}
                    />
                    <button
                      type="button" className="step-delete" title="Take this off the list (the item itself stays in the catalog)"
                      onClick={async () => {
                        if (await confirm({
                          title: `Take "${it.item_name}" off this task's list?`,
                          message: 'Only the requirement goes; the item and its stock are not touched.',
                          confirmLabel: 'Take it off', cancelLabel: 'Keep it',
                        })) removeItem.mutate({ taskId, itemId: it.item_id })
                      }}
                    >
                      ✕
                    </button>
                  </span>
                ) : (
                  <span className="task-needs-qty">
                    need {it.quantity_required} {it.unit}{it.amount_note ? ` (${it.amount_note})` : ''}
                    {' · '}have {it.quantity_onhand} {it.unit}
                    {it.shortfall > 0 && <strong className="task-needs-flag"> ⚠️ SHORT</strong>}
                  </span>
                )}
              </div>
              {it.stowed_at
                ? <div className="task-needs-where">📍 {it.stowed_at.split(',').join('  ·  ')}</div>
                : <div className="task-needs-where task-needs-where--none">📍 no stock recorded</div>}
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <div className="task-needs-add">
          <input
            type="text" placeholder="🔍 Add a part, tool or supply - search the catalog" value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {q.length >= 2 && (
            <ul className="link-search-results">
              {!creating && (
                <li>
                  <button type="button" className="link-search-hit link-search-hit--new" onClick={() => setCreating(true)}>
                    ＋ Add “{q}” as a new item (not in the catalog yet)
                  </button>
                </li>
              )}
              {results.map((f) => (
                <li key={f.item_id}>
                  <button
                    type="button" className="link-search-hit" disabled={setItem.isPending}
                    onClick={() => setItem.mutate(
                      { taskId, itemId: f.item_id, quantity_required: 1, amount_note: null },
                      { onSuccess: () => setSearch('') },
                    )}
                  >
                    {TYPE_GLYPH[f.item_type] ?? '•'} {f.item_name} <em>· have {f.quantity_onhand} {f.unit}</em>
                  </button>
                </li>
              ))}
              {results.length === 0 && <li className="mgmt-empty">No matching item (or it is already on the list).</li>}
            </ul>
          )}
          {creating && (
            <NewStuffItemForm
              initialName={q}
              createLabel="✓ Create and add to this list"
              onCancel={() => setCreating(false)}
              onDone={(res) => setItem.mutate(
                { taskId, itemId: res.itemId, quantity_required: 1, amount_note: null },
                { onSuccess: () => { setCreating(false); setSearch('') } },
              )}
            />
          )}
        </div>
      )}
      {error && (
        <p className="mgmt-status mgmt-status--error">
          {(error as { detail?: { message?: string } }).detail?.message ?? (error as Error).message}
        </p>
      )}
    </div>
  )
}

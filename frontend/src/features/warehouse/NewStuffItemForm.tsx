/**
 * Purpose: The small "add a new part / spare / tool / supply to the catalog" form used wherever a
 *   non-food pick list turns out not to have the thing yet - so the workflow carries on with the new
 *   item selected instead of detouring through the Warehouse (tracker #75/#76, the owner 2026-09-23).
 * Version: v2 (2026-09-23) - v2: the result carries the unit it was created in (#76)
 * Scope: PRODUCTION - mx-inv frontend, warehouse feature (shared component).
 * Architecture: Non-food twin of NewFoodItemForm. Used by management/SystemScreen (device screen's
 *   part search), management/TaskNeeds ("What you need") and warehouse/ToolLinksEditor (an
 *   accessory's tools). Creates the catalog row via useCreateItem with just name, type and unit -
 *   thresholds, part number and location are finished later in the Locker. A name that already
 *   exists (409) uses the existing item instead of failing. The caller does the linking in onDone.
 */
import { useState } from 'react'
import { ApiError } from '../../api/client'
import { UnitPicker } from '../../components/UnitPicker'
import { useCreateItem } from './mutations'
import { useItemTypes } from './useWarehouse'

export interface NewStuffItemResult {
  itemId: number
  itemName: string
  /** The unit it is counted in (null when an existing item was used - look it up if needed). */
  unit: string | null
  /** Set when the name already existed and that item was used instead. */
  existingName?: string
}

export function NewStuffItemForm({
  initialName, defaultType = 'part', lockType, createLabel = '✓ Create and use', onDone, onCancel,
}: {
  initialName: string
  /** Pre-selected item type (part / spare_unit / tool / supply / ...). */
  defaultType?: string
  /** Only this type makes sense here (e.g. 'tool' for an accessory's tools) - hide the choice. */
  lockType?: boolean
  createLabel?: string
  onDone: (result: NewStuffItemResult) => void
  onCancel: () => void
}) {
  const { data: itemTypes } = useItemTypes()
  const createItem = useCreateItem()
  const [name, setName] = useState(initialName)
  const [type, setType] = useState(defaultType)
  const [unit, setUnit] = useState<string | null>('ea')
  const [error, setError] = useState<string | null>(null)

  const create = () => {
    setError(null)
    createItem.mutate(
      { item_name: name.trim(), item_type: type, unit: unit ?? 'ea' },
      {
        onSuccess: (res) => onDone({ itemId: (res as { item_id: number }).item_id, itemName: name.trim(), unit: unit ?? 'ea' }),
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409 && err.detail) {
            const { item_id, item_name } = err.detail as { item_id: number; item_name: string }
            onDone({ itemId: item_id, itemName: item_name, unit: null, existingName: item_name })
          } else {
            setError(`Could not create the item: ${(err as Error).message}`)
          }
        },
      },
    )
  }

  return (
    <div className="recipe-review-new">
      <strong>New catalog item</strong>
      <label>
        Name
        <input value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      </label>
      {!lockType && (
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {(itemTypes ?? []).filter((t) => t.type_key !== 'food').map((t) => (
              <option key={t.type_key} value={t.type_key} title={t.description ?? undefined}>{t.label}</option>
            ))}
          </select>
        </label>
      )}
      <label>
        Counted in
        <UnitPicker value={unit} onChange={setUnit} />
      </label>
      <button type="button" disabled={!name.trim() || !unit || createItem.isPending} onClick={create}>
        {createLabel}
      </button>
      <button type="button" onClick={onCancel}>✕</button>
      <span className="mgmt-status">Part number, reorder level and where it lives can be filled in later in the Locker.</span>
      {error && <span className="mgmt-status mgmt-status--error">{error}</span>}
    </div>
  )
}

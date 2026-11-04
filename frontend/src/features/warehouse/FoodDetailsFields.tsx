/**
 * Purpose: The food-only fields of an item - aisle category, stowage, shelf
 *   life, and the provisioning decision (undecided / keep a standing stock /
 *   recipes only) - as reusable pieces plus the value helpers.
 * Version: v2 (2026-09-23) - v2: the category create choice reads "＋ New category…" like every other
 *   pick list (tracker #76). v1 (2026-09-19)
 * Scope: PRODUCTION - mx-inv frontend, warehouse feature.
 * Architecture: Used by ItemDetailPanel and AddItemTab (whole block) and by
 *   provisioning/UndecidedFoodTable (the individual pieces). Maps to
 *   food_details columns (schema v24: provision_mode is an explicit choice, not
 *   a sentinel quantity - the quantity is set only for a baseline). The Galley
 *   provisioning plan (data.provisioning_plan / food_cart) reads these.
 */
import type { ChangeEvent } from 'react'
import type { ProvisionMode } from '../../api/types'
import { GroupPicker } from '../management/GroupPicker'
import { useAisleOrder } from '../provisioning/useProvisioning'

export interface FoodDetailValues {
  category: string | null
  stowage_state: string
  shelf_life_days: number | null
  provision_mode: ProvisionMode
  provision_qty: number | null
  scales_with_crew: boolean
}

export const EMPTY_FOOD: FoodDetailValues = {
  category: null, stowage_state: 'dry', shelf_life_days: null,
  provision_mode: 'undecided', provision_qty: null, scales_with_crew: true,
}

export const MODE_LABEL: Record<ProvisionMode, string> = {
  undecided: 'Not decided yet',
  baseline: 'Keep a standing stock',
  recipe_only: 'Recipes only',
}

const MODE_HELP: Record<ProvisionMode, string> = {
  undecided: 'No choice made yet - the Galley plan lists this item until you decide.',
  baseline: 'Keep this much aboard all the time (scaled by crew and trip length); the shopping cart buys back up to it.',
  recipe_only: 'No standing stock - it only goes on the shopping cart when a planned recipe needs it.',
}

export const STOWAGE_OPTIONS = ['dry', 'refrigerated', 'frozen']

export function foodValuesFrom(details: Record<string, unknown> | undefined): FoodDetailValues {
  const d = details ?? {}
  const mode = d.provision_mode
  return {
    category: (d.category as string | null | undefined) ?? null,
    stowage_state: (d.stowage_state as string | undefined) ?? 'dry',
    shelf_life_days: (d.shelf_life_days as number | null | undefined) ?? null,
    provision_mode: mode === 'baseline' || mode === 'recipe_only' ? mode : 'undecided',
    provision_qty: (d.provision_qty as number | null | undefined) ?? null,
    scales_with_crew: d.scales_with_crew === undefined ? true : Boolean(d.scales_with_crew),
  }
}

// What goes to the API: the quantity only travels with a baseline.
export function foodDetailsPayload(v: FoodDetailValues): Record<string, unknown> {
  return {
    category: v.category,
    stowage_state: v.stowage_state,
    shelf_life_days: v.shelf_life_days,
    provision_mode: v.provision_mode,
    provision_qty: v.provision_mode === 'baseline' ? v.provision_qty : null,
    scales_with_crew: v.scales_with_crew ? 1 : 0,
  }
}

// A baseline needs a quantity above 0; everything else is complete as it stands.
export function foodValuesProblem(v: FoodDetailValues): string | null {
  if (v.provision_mode === 'baseline' && !(v.provision_qty !== null && v.provision_qty > 0)) {
    return 'A standing stock needs a quantity above 0.'
  }
  return null
}

// Aisle category: a pick list of the store-walk categories, plus "＋ New category…".
export function CategoryPicker({
  value, onChange,
}: { value: string | null; onChange: (category: string | null) => void }) {
  const { data: aisle } = useAisleOrder()
  const options = Array.from(new Set([...(aisle ?? []), ...(value ? [value] : [])])).filter(Boolean)
  return (
    <GroupPicker
      value={value}
      options={options}
      onChange={onChange}
      noneLabel="— no category —"
      newLabel="＋ New category…"
      newPlaceholder="New category (aisle)"
    />
  )
}

// The provisioning decision: mode select and, for a baseline only, its quantity.
export function ProvisionModeFields({
  value, onChange, unit,
}: {
  value: Pick<FoodDetailValues, 'provision_mode' | 'provision_qty'>
  onChange: (next: Partial<FoodDetailValues>) => void
  unit?: string
}) {
  const setMode = (e: ChangeEvent<HTMLSelectElement>) => {
    const provision_mode = e.target.value as ProvisionMode
    onChange({ provision_mode, ...(provision_mode === 'baseline' ? {} : { provision_qty: null }) })
  }
  return (
    <>
      <select value={value.provision_mode} onChange={setMode} title={MODE_HELP[value.provision_mode]}>
        {(Object.keys(MODE_LABEL) as ProvisionMode[]).map((m) => (
          <option key={m} value={m} title={MODE_HELP[m]}>{MODE_LABEL[m]}</option>
        ))}
      </select>
      {value.provision_mode === 'baseline' && (
        <input
          type="number" min={0} step="any" className="prov-qty-input"
          placeholder={unit ? `qty (${unit})` : 'qty'}
          title="How much to keep aboard for 2 people over 14 days; the plan scales it by crew and trip length"
          value={value.provision_qty ?? ''}
          onChange={(e) => onChange({ provision_qty: e.target.value === '' ? null : Number(e.target.value) })}
        />
      )}
    </>
  )
}

export function FoodDetailsFields({
  value, onChange, unit,
}: {
  value: FoodDetailValues
  onChange: (next: Partial<FoodDetailValues>) => void
  unit?: string
}) {
  const problem = foodValuesProblem(value)
  return (
    <fieldset className="food-details-fields">
      <legend>🍽️ Food details</legend>
      <div className="item-detail-row">
        <label>
          Aisle category
          <CategoryPicker value={value.category} onChange={(category) => onChange({ category })} />
        </label>
        <label>
          Stowage
          <select value={value.stowage_state} onChange={(e) => onChange({ stowage_state: e.target.value })}>
            {STOWAGE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          Shelf life (days)
          <input
            type="number" min={0} value={value.shelf_life_days ?? ''}
            onChange={(e) => onChange({ shelf_life_days: e.target.value === '' ? null : Number(e.target.value) })}
          />
        </label>
      </div>
      <div className="item-detail-row">
        <label>
          Provisioning
          <span className="food-mode-row">
            <ProvisionModeFields value={value} onChange={onChange} unit={unit} />
          </span>
        </label>
        <label
          className="checkbox-label"
          title="Off for staples that barely change with headcount (salt, oil, condiments)"
        >
          <input
            type="checkbox" checked={value.scales_with_crew}
            onChange={(e) => onChange({ scales_with_crew: e.target.checked })}
          />
          Quantity scales with crew size
        </label>
      </div>
      <p className="item-policy-hint">{MODE_HELP[value.provision_mode]}</p>
      {problem && <p className="mgmt-status mgmt-status--error">{problem}</p>}
    </fieldset>
  )
}

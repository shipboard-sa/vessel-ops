/**
 * Purpose: The Galley plan's "needs a decision" table - one row per food item
 *   whose provisioning is still undecided, so each can be settled in place
 *   (aisle category, stowage, and keep-a-standing-stock vs recipes-only).
 * Version: v2 (2026-09-23)
 *   - v2: the item name opens its item record (tracker #74).
 * Scope: PRODUCTION - mx-inv frontend, provisioning feature.
 * Architecture: Rendered by ProvisioningView above the shopping list. Saves
 *   through warehouse/mutations useUpdateItem (details -> food_details, schema
 *   v24 provision_mode); a saved row drops off because the food cart refetches
 *   and the item is no longer 'undecided'. Reuses the warehouse food-detail
 *   pieces so the wording and rules match the item screen.
 */
import { useState } from 'react'
import type { FoodCartRow } from '../../api/types'
import { ApiError } from '../../api/client'
import { useUpdateItem } from '../warehouse/mutations'
import { RecordLink } from '../../components/RecordLink'
import {
  CategoryPicker, ProvisionModeFields, STOWAGE_OPTIONS, foodValuesProblem,
  type FoodDetailValues,
} from '../warehouse/FoodDetailsFields'

export function UndecidedFoodTable({ rows }: { rows: FoodCartRow[] }) {
  if (rows.length === 0) return null
  return (
    <div className="prov-undecided">
      <h3>🧭 {rows.length} food item{rows.length === 1 ? '' : 's'} need a provisioning decision</h3>
      <p className="mgmt-status">
        For each, choose <strong>Keep a standing stock</strong> (with how much you want aboard for 2 people
        over 14 days - the plan scales it by crew and trip length) or <strong>Recipes only</strong> (no
        standing stock; it is bought only when a planned recipe needs it). Bulk items (flour, spices,
        condiments) are only ever checked as "do we have any?" against a recipe.
      </p>
      <table className="warehouse-table">
        <thead>
          <tr>
            <th>Item</th><th>Unit</th><th>Policy</th><th>On hand</th>
            <th>Aisle category</th><th>Stowage</th><th>Decision</th><th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => <UndecidedRow key={r.item_id} row={r} />)}
        </tbody>
      </table>
    </div>
  )
}

function UndecidedRow({ row }: { row: FoodCartRow }) {
  const update = useUpdateItem()
  const [v, setV] = useState<Pick<FoodDetailValues, 'category' | 'stowage_state' | 'provision_mode' | 'provision_qty'>>({
    category: row.category, stowage_state: row.stowage_state ?? 'dry',
    provision_mode: 'undecided', provision_qty: null,
  })
  const problem = foodValuesProblem({ ...v, shelf_life_days: null, scales_with_crew: true })
  const ready = v.provision_mode !== 'undecided' && problem === null

  return (
    <tr>
      <td><RecordLink to={{ kind: 'item', id: row.item_id }}>{row.item_name}</RecordLink></td>
      <td>{row.unit}</td>
      <td>{row.stocking_policy}</td>
      <td>{row.quantity_onhand}</td>
      <td><CategoryPicker value={v.category} onChange={(category) => setV((x) => ({ ...x, category }))} /></td>
      <td>
        <select value={v.stowage_state} onChange={(e) => setV((x) => ({ ...x, stowage_state: e.target.value }))}>
          {STOWAGE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>
      <td>
        <ProvisionModeFields value={v} unit={row.unit} onChange={(next) => setV((x) => ({ ...x, ...next }))} />
        {problem && <div className="mgmt-status mgmt-status--error">{problem}</div>}
      </td>
      <td>
        <button
          type="button"
          disabled={!ready || update.isPending}
          onClick={() => update.mutate({
            itemId: row.item_id,
            fields: {
              details: {
                category: v.category, stowage_state: v.stowage_state,
                provision_mode: v.provision_mode,
                provision_qty: v.provision_mode === 'baseline' ? v.provision_qty : null,
              },
            },
          })}
        >
          {update.isPending ? 'Saving…' : '💾 Save'}
        </button>
        {update.isError && (
          <div className="mgmt-status mgmt-status--error">
            {update.error instanceof ApiError
              && (update.error.detail as { message?: string } | undefined)?.message
              ? (update.error.detail as { message: string }).message
              : (update.error as Error).message}
          </div>
        )}
      </td>
    </tr>
  )
}

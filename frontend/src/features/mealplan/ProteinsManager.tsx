/**
 * Purpose: "Manage proteins" - the short list offered as "the protein" when a recipe is put on
 *   the meal plan: see it, add a new protein, add an existing food item to it, take one off.
 * Version: v3 (2026-09-23) - v3: one type-to-search picker over the other food items with
 *   "＋ New protein" as its FIRST row (created inline); picking makes it a protein at once, and a
 *   new name that already exists is simply made a protein - no separate button (tracker #76).
 *   v2: each protein's name opens its item (tracker #74).
 *   v1 (2026-09-19)
 * Scope: PRODUCTION - mx-inv frontend, meal plan feature.
 * Architecture: Opened from a button on the Meal Plan tab. A protein is simply a FOOD item whose
 *   aisle category is `meat` (data.list_proteins), so there is no separate table: adding or
 *   taking one off just sets that category through the normal item update, and a brand-new
 *   protein is created by the shared NewFoodItemForm in protein mode (lb, meat). Renaming,
 *   changing units or deleting an item stays in the Locker (Warehouse), where item editing lives.
 *   Tracker #24 (the owner 2026-09-19: "likely should have a manage proteins dialog somewhere").
 */
import { useState } from 'react'
import type { ItemListRow } from '../../api/types'
import { SearchPick } from '../../components/SearchPick'
import { useUpdateItem } from '../warehouse/mutations'
import { useItems, useProteins } from '../warehouse/useWarehouse'
import { NewFoodItemForm } from '../warehouse/NewFoodItemForm'
import { RecordLink } from '../../components/RecordLink'

export function ProteinsManager({ onClose }: { onClose: () => void }) {
  const { data: proteins, isLoading } = useProteins()
  const { data: foodItems } = useItems('food')
  const updateItem = useUpdateItem()
  const [message, setMessage] = useState<string | null>(null)

  const proteinIds = new Set((proteins ?? []).map((p) => p.item_id))
  const others = (foodItems ?? [])
    .filter((f) => !proteinIds.has(f.item_id))
    .sort((a, b) => a.item_name.localeCompare(b.item_name))

  const setCategory = (itemId: number, category: string | null, done: string) =>
    updateItem.mutate(
      { itemId, fields: { details: { category } } },
      { onSuccess: () => setMessage(done) },
    )

  return (
    <div className="proteins-manager">
      <div className="proteins-manager-head">
        <strong>🍗 Proteins</strong>
        <button type="button" className="link-button" onClick={onClose}>✕ close</button>
      </div>
      <p className="mgmt-status">
        The list offered as “Protein” when you add a recipe to the plan. A protein is a food item in the
        meat category. To rename one or change its unit, use the Locker.
      </p>
      {isLoading && <p className="mgmt-status">Loading…</p>}
      <ul className="proteins-list">
        {(proteins ?? []).map((p) => (
          <li key={p.item_id}>
            <RecordLink to={{ kind: 'item', id: p.item_id }} className="proteins-name">{p.item_name}</RecordLink>
            <span className="mgmt-status">on hand {p.quantity_onhand} {p.unit}</span>
            <button
              type="button" className="link-button"
              title="Keep the item, but stop offering it as a protein"
              disabled={updateItem.isPending}
              onClick={() => setCategory(p.item_id, null, `“${p.item_name}” is no longer offered as a protein.`)}
            >
              take off the list
            </button>
          </li>
        ))}
      </ul>

      <div className="proteins-add">
        <SearchPick<ItemListRow>
          options={others}
          keyOf={(r) => r.item_id}
          labelOf={(r) => r.item_name}
          hintOf={(r) => r.unit}
          value={null}
          placeholder="Add a protein - type a food item…"
          disabled={updateItem.isPending}
          onPick={(_k, r) => { if (r) setCategory(r.item_id, 'meat', `“${r.item_name}” is now a protein.`) }}
          newLabel={(t) => (t ? `＋ Add “${t}” as a new protein` : '＋ New protein…')}
          renderNew={(typed, done, cancel) => (
            <NewFoodItemForm
              protein
              initialName={typed}
              onCancel={cancel}
              onDone={(res) => {
                done(res.itemId, res.itemName)
                // The name already existed as a food item: just make that one a protein.
                if (res.existingName) setCategory(res.itemId, 'meat', `“${res.existingName}” already existed - it is now a protein.`)
                else setMessage(`“${res.itemName}” added as a protein.`)
              }}
            />
          )}
        />
      </div>
      {message && <p className="mgmt-status">{message}</p>}
      {updateItem.isError && <p className="mgmt-status mgmt-status--error">{(updateItem.error as Error).message}</p>}
    </div>
  )
}

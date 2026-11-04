/**
 * Purpose: The catalog-item pickers - FoodPick (food items) and StuffPick (parts / spares / tools /
 *   supplies) - type to find, tap to pick, "＋ Add '<typed>' as a new …" as the FIRST row, which
 *   opens the shared new-item form right there and comes back with the new item picked.
 * Version: v1 (2026-09-23)
 * Scope: PRODUCTION - mx-inv frontend, warehouse feature (shared component, tracker #76).
 * Architecture: SearchPick (components/) over useItems(...) + NewFoodItemForm / NewStuffItemForm.
 *   Replaces the long plain food/item <select>s (shopping-list add, receive, pantry-check link,
 *   proteins, "used something else", the audit walk) so every item pick list behaves the same way
 *   (the owner, 2026-09-23: "the same few patterns everywhere"; "＋ new" first, never at the bottom).
 */
import type { ItemListRow } from '../../api/types'
import { SearchPick } from '../../components/SearchPick'
import { useItems, useItemTypes, useProteins } from './useWarehouse'
import { NewFoodItemForm } from './NewFoodItemForm'
import { NewStuffItemForm } from './NewStuffItemForm'
import { typeLabel } from './catalogDisplay'

export interface PickedItem {
  itemId: number
  itemName: string
  unit: string | null
  /** The full row when it was picked from the list (null for one just created). */
  row: ItemListRow | null
}

interface CommonProps {
  value: number | null
  onPick: (picked: PickedItem | null) => void
  placeholder?: string
  /** Leave these out of the list (e.g. already linked / already on the task). */
  excludeIds?: Set<number>
  noneLabel?: string
  disabled?: boolean
}

export function FoodPick({
  value, onPick, placeholder = 'Type a food item…', excludeIds, noneLabel, disabled,
  putOnList, protein, recipeUnit,
}: CommonProps & {
  /** New items start with "Put it on the shopping list" ticked. */
  putOnList?: boolean
  /** Only proteins (category meat) - and a new one is created as a protein. */
  protein?: boolean
  recipeUnit?: string | null
}) {
  const { data: food } = useItems('food')
  const { data: proteins } = useProteins()
  // Proteins = food items in the `meat` category (tracker #24) - the list only has the id.
  const proteinIds = new Set((proteins ?? []).map((p) => p.item_id))
  const rows = (food ?? []).filter((r) => !excludeIds?.has(r.item_id) && (!protein || proteinIds.has(r.item_id)))
  return (
    <SearchPick<ItemListRow>
      options={rows}
      keyOf={(r) => r.item_id}
      labelOf={(r) => r.item_name}
      hintOf={(r) => r.unit}
      value={value}
      onPick={(k, r) => { if (k === null) onPick(null); else if (r) onPick({ itemId: r.item_id, itemName: r.item_name, unit: r.unit, row: r as ItemListRow }) }}
      placeholder={placeholder}
      noneLabel={noneLabel}
      disabled={disabled}
      newLabel={(t) => (t ? `＋ Add “${t}” as a new ${protein ? 'protein' : 'food item'}` : `＋ New ${protein ? 'protein' : 'food item'}…`)}
      renderNew={(typed, done, cancel) => (
        <NewFoodItemForm
          initialName={typed} putOnList={putOnList} protein={protein} recipeUnit={recipeUnit}
          onCancel={cancel}
          onDone={(res) => { done(res.itemId, res.itemName); onPick({ itemId: res.itemId, itemName: res.itemName, unit: res.unit, row: null }) }}
        />
      )}
    />
  )
}

export function StuffPick({
  value, onPick, placeholder = 'Type a part, spare, tool or supply…', excludeIds, noneLabel, disabled,
  defaultType = 'part', lockType, createLabel,
}: CommonProps & {
  /** Type a NEW item starts as. */
  defaultType?: string
  /** Only that type: filters the list AND locks the new item's type (e.g. 'tool'). */
  lockType?: boolean
  createLabel?: string
}) {
  const { data: items } = useItems(lockType ? (defaultType as ItemListRow['item_type']) : 'all')
  const { data: itemTypes } = useItemTypes()
  const rows = (items ?? []).filter((r) => r.item_type !== 'food' && !excludeIds?.has(r.item_id))
  return (
    <SearchPick<ItemListRow>
      options={rows}
      keyOf={(r) => r.item_id}
      labelOf={(r) => r.item_name}
      hintOf={(r) => typeLabel(itemTypes, r.item_type)}
      value={value}
      onPick={(k, r) => { if (k === null) onPick(null); else if (r) onPick({ itemId: r.item_id, itemName: r.item_name, unit: r.unit, row: r as ItemListRow }) }}
      placeholder={placeholder}
      noneLabel={noneLabel}
      disabled={disabled}
      newLabel={(t) => (t ? `＋ Add “${t}” as a new item (not in the catalog yet)` : '＋ New item…')}
      renderNew={(typed, done, cancel) => (
        <NewStuffItemForm
          initialName={typed} defaultType={defaultType} lockType={lockType} createLabel={createLabel}
          onCancel={cancel}
          onDone={(res) => { done(res.itemId, res.itemName); onPick({ itemId: res.itemId, itemName: res.itemName, unit: res.unit, row: null }) }}
        />
      )}
    />
  )
}

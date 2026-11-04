/**
 * Purpose: The small "add a new food item to the catalog" form used wherever an
 *   ingredient turns out not to exist yet - recipe review, the pantry check /
 *   cook screen, and the Galley cart's add box. Name, what it is counted in,
 *   counted-vs-bulk, aisle category; optionally puts the new item straight on the
 *   shopping list.
 * Version: v2 (2026-09-23) - v2: optional "Lives in" container (a stock-0 home row, so it is
 *   already findable in its locker) and a "Put it on the shopping list" tick the user chooses -
 *   before, the list was only a caller-set prop (tracker #76, the owner 2026-09-23). v1 2026-09-19.
 * Scope: PRODUCTION - mx-inv frontend, warehouse feature (shared component).
 * Architecture: Extracted from recipes/IngredientReview.tsx (which had it inline)
 *   so the recipe, cook and cart screens share one form. Creates a Food item via
 *   useCreateItem (+ useUpdateItem for a bulk policy) with provision_mode
 *   'undecided', so it also lands in the Galley "needs a decision" table.
 */
import { useState } from 'react'
import { ApiError } from '../../api/client'
import { useCreateItem, useStowItems, useUpdateItem } from './mutations'
import { ContainerPicker } from './ContainerPicker'
import { useSetOnList } from './onList'
import { useItems } from './useWarehouse'
import { CategoryPicker } from './FoodDetailsFields'
import { UnitPicker } from '../../components/UnitPicker'

// A recipe measures by the spoon or cup, but a catalog item is COUNTED in what you
// buy and store it in (a jar of nutmeg, a bag of flour) - so a measure unit on the
// recipe line is never the default unit of a new item.
const MEASURE_UNITS = new Set(['tsp', 'tbsp', 'cup', 'pinch', 'dash', 'fl oz', 'pt', 'qt', 'gal'])
export const defaultNewUnit = (recipeUnit: string | null | undefined): string =>
  recipeUnit && !MEASURE_UNITS.has(recipeUnit) ? recipeUnit : 'ea'

export interface NewFoodItemResult {
  itemId: number
  itemName: string
  unit: string
  isBulk: boolean
  /** Set when the name already existed and the existing item was used instead. */
  existingName?: string
}

export function NewFoodItemForm({
  initialName, recipeUnit, putOnList, protein, onDone, onCancel,
}: {
  initialName: string
  /** The recipe line's unit, if any - only used to pick a sensible counted-in default. */
  recipeUnit?: string | null
  /** Start with "Put it on the shopping list" ticked (the user can still untick it). */
  putOnList?: boolean
  /** A new PROTEIN (tracker #24): counted in lb, category `meat` (which is what makes it a protein),
   *  no kind / aisle choices to make. */
  protein?: boolean
  onDone: (result: NewFoodItemResult) => void
  onCancel: () => void
}) {
  const createItem = useCreateItem()
  const updateItem = useUpdateItem()
  const setOnList = useSetOnList()
  const stow = useStowItems()
  const [onList, setOnListChoice] = useState(!!putOnList)
  const [livesIn, setLivesIn] = useState<number | null>(null)
  const { data: foodItems } = useItems('food')
  const [name, setName] = useState(initialName)
  const [unit, setUnit] = useState<string | null>(protein ? 'lb' : defaultNewUnit(recipeUnit))
  const [policy, setPolicy] = useState<'consumable' | 'bulk'>('consumable')
  const [category, setCategory] = useState<string | null>(protein ? 'meat' : null)
  const [error, setError] = useState<string | null>(null)
  const busy = createItem.isPending || updateItem.isPending || setOnList.isPending || stow.isPending

  const create = () => {
    setError(null)
    createItem.mutate(
      {
        item_name: name.trim(), item_type: 'food', unit: unit ?? 'ea',
        details: { category, provision_mode: 'undecided' },
      },
      {
        onSuccess: async (res) => {
          const itemId = (res as { item_id: number }).item_id
          if (policy !== 'consumable') {
            await updateItem.mutateAsync({ itemId, fields: { stocking_policy: policy } })
          }
          if (onList) await setOnList.mutateAsync({ itemId, onList: true })
          // A stock-0 row = "this is where it lives" (a home), nothing counted yet.
          if (livesIn !== null) await stow.mutateAsync({ container_id: livesIn, lines: [{ item_id: itemId, quantity: 0 }] })
          onDone({ itemId, itemName: name.trim(), unit: unit ?? 'ea', isBulk: policy === 'bulk' })
        },
        onError: async (err) => {
          // The name already exists: use that item instead of failing.
          if (err instanceof ApiError && err.status === 409 && err.detail) {
            const { item_id, item_name } = err.detail as { item_id: number; item_name: string }
            if (onList) await setOnList.mutateAsync({ itemId: item_id, onList: true })
            const existing = foodItems?.find((f) => f.item_id === item_id)
            onDone({
              itemId: item_id, itemName: item_name, unit: existing?.unit ?? 'ea',
              isBulk: existing?.stocking_policy === 'bulk', existingName: item_name,
            })
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
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label title="What you buy and store it in (a jar, a bag, each) - not the recipe's spoon or cup.">
        Counted in
        <UnitPicker value={unit} onChange={setUnit} />
      </label>
      {!protein && (
        <>
      <label title="Bulk = a pantry staple used by measure (flour, spices, condiments): the recipe keeps its cup or spoon, and it only reaches the shopping cart when someone says we need more.">
        Kind
        <select value={policy} onChange={(e) => setPolicy(e.target.value as 'consumable' | 'bulk')}>
          <option value="consumable">Counted (eggs, apples, chicken)</option>
          <option value="bulk">Bulk staple (flour, spices, condiments)</option>
        </select>
      </label>
      <label>
        Aisle category
        <CategoryPicker value={category} onChange={setCategory} />
      </label>
        </>
      )}
      <div className="search-pick-field">
        <span>Lives in (optional)</span>
        <ContainerPicker value={livesIn} onChange={setLivesIn} itemType="food" />
      </div>
      <label className="checkbox-label">
        <input type="checkbox" checked={onList} onChange={(e) => setOnListChoice(e.target.checked)} />
        Put it on the shopping list
      </label>
      <button type="button" disabled={!name.trim() || !unit || busy} onClick={create}>
        {onList ? '✓ Create and put on the list' : '✓ Create and use'}
      </button>
      <button type="button" onClick={onCancel}>✕</button>
      <span className="mgmt-status">
        It joins the Galley plan's “needs a decision” list so you can set how much to keep aboard.
      </span>
      {error && <span className="mgmt-status mgmt-status--error">{error}</span>}
    </div>
  )
}

/**
 * Purpose: The pantry check - for a recipe's bulk ingredients (flour, spices,
 *   condiments) "do we need more?"; a yes puts the item straight on the shopping
 *   list. Also the "link or add an item" control for an ingredient line that has
 *   no catalog item yet.
 * Version: v3 (2026-09-23) - v3: LinkOrAddItem is one type-to-search picker with "＋ Add … as a new
 *   food item" as its FIRST row (prefilled from the recipe line, created inline, then linked) -
 *   no separate button after a long select (tracker #76).
 *   v2: the tick and the item name are separate targets (CheckRow) -
 *   the box puts it on the shopping list, the name opens the item (tracker #74).
 *   v1 (2026-09-19)
 * Scope: PRODUCTION - mx-inv frontend, recipes + meal plan features.
 * Architecture: Rendered by recipes/CookFlow.tsx, which both the meal-plan entry
 *   screen (plan time - where crew member does the check) and the recipe's cook screen
 *   (cook time - kept as an option) use. Bulk items are assumed available and are
 *   never driven by a recipe's quantity; a request is items.on_list_since (schema
 *   v25), set via warehouse/onList.useSetOnList and cleared server-side when the
 *   item is received. LinkOrAddItem links one saved line via
 *   recipes/mutations.useLinkIngredientItem and creates items through the shared
 *   warehouse/NewFoodItemForm.
 */
import type { ItemListRow, RecipeIngredient } from '../../api/types'
import { SearchPick } from '../../components/SearchPick'
import { useItems } from '../warehouse/useWarehouse'
import { NewFoodItemForm } from '../warehouse/NewFoodItemForm'
import { useOnList, useSetOnList } from '../warehouse/onList'
import { useLinkIngredientItem } from './mutations'
import { CheckRow } from '../../components/RecordLink'

// "1 tbs cider vinegar, divided" -> "cider vinegar": the name a new item starts with.
const LEADING_AMOUNT = /^[\d\s/.½¼¾⅓⅔⅛-]*(?:(?:cups?|c|tbsp|tbs|tbl|tablespoons?|tsp|teaspoons?|lbs?|pounds?|oz|ounces?|cans?|cloves?|pinch(?:es)?|dash(?:es)?|slices?|packages?|pkgs?)\.?\s*)?/i
const ingredientName = (raw: string): string => (raw.replace(LEADING_AMOUNT, '').split(',')[0] || raw).trim()

export function PantryCheck({ lines, standing }: { lines: RecipeIngredient[]; standing?: boolean }) {
  const { data: onList } = useOnList()
  const setOnList = useSetOnList()
  const since = new Map((onList ?? []).map((x) => [x.item_id, x.on_list_since]))
  // One row per catalog item (a recipe can list butter twice).
  const seen = new Set<number>()
  const rows = lines.filter((l) => {
    if (l.item_id === null || seen.has(l.item_id)) return false
    seen.add(l.item_id)
    return true
  })
  if (rows.length === 0) return null

  return (
    <div className="recipe-pantry-check">
      {!standing && (
        <>
          <h4>🧂 Pantry check — do we need more?</h4>
          <p className="mgmt-status">
            These are bulk staples: the recipe keeps its measure, but the shopping list never works
            from it. Tick anything we need more of and it goes straight onto the Galley shopping
            list; receiving it clears the request.
          </p>
        </>
      )}
      {standing && <p className="mgmt-status">{rows.filter((l) => since.has(l.item_id as number)).length} of {rows.length} ticked as needed.</p>}
      <ul className="recipe-pantry-list">
        {rows.map((l) => {
          const itemId = l.item_id as number
          const requested = since.has(itemId)
          return (
            <li key={itemId} className={requested ? 'requested' : undefined}>
              <CheckRow
                checked={requested}
                disabled={setOnList.isPending}
                onToggle={(b) => setOnList.mutate({ itemId, onList: b })}
                to={{ kind: 'item', id: itemId }}
                name={l.item_name}
              >
                {!standing && <span className="recipe-pantry-line"> — “{l.raw_text}”</span>}
                {requested && (
                  <span className="mgmt-status"> 📝 on the shopping list since {since.get(itemId)}</span>
                )}
              </CheckRow>
            </li>
          )
        })}
      </ul>
      {setOnList.isError && (
        <p className="mgmt-status mgmt-status--error">{(setOnList.error as Error).message}</p>
      )}
    </div>
  )
}

// For a saved line with no catalog item: link it to an existing food item, or add a
// new one - saved on the recipe line so it is fixed for good, not just this cook.
export function LinkOrAddItem({ line }: { line: RecipeIngredient }) {
  const { data: foodItems } = useItems('food')
  const link = useLinkIngredientItem()
  const guess = ingredientName(line.raw_text)
  return (
    <span className="recipe-link-or-add" title="Link this line to an item in the catalog (saved on the recipe)">
      <SearchPick<ItemListRow>
        options={foodItems ?? []}
        keyOf={(r) => r.item_id}
        labelOf={(r) => r.item_name}
        hintOf={(r) => r.unit}
        value={null}
        disabled={link.isPending}
        placeholder={`link to an item… (${guess})`}
        onPick={(_k, r) => { if (r) link.mutate({ ingredientId: line.recipe_ingredient_id, itemId: r.item_id }) }}
        newLabel={(t) => `＋ Add “${t || guess}” as a new food item`}
        renderNew={(typed, done, cancel) => (
          <NewFoodItemForm
            initialName={typed || guess}
            recipeUnit={line.unit}
            onCancel={cancel}
            onDone={(res) => { done(res.itemId, res.itemName); link.mutate({ ingredientId: line.recipe_ingredient_id, itemId: res.itemId }) }}
          />
        )}
      />
      {link.isError && <span className="mgmt-status mgmt-status--error">{(link.error as Error).message}</span>}
    </span>
  )
}

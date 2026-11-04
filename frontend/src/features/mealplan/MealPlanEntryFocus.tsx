/**
 * Purpose: The full-screen meal-plan entry - recipe text, then the cook flow
 *   (pick ingredients, swap/extras, Made it, Save picks, Remove from plan).
 * Version: v6 (2026-09-23) - v6: the protein pick is FoodPick (type to search, "＋ New protein"
 *   first) and always shown, even before any protein exists; a recipe with no parsed ingredients
 *   is parsed right here (RecipeIngredients inline) - no detour to the Recipe Book (tracker #76).
 *   v5: the entry title and the "Recipe Book" hint open the recipe; the
 *   chosen protein (or the recipe's own) is named as a link to its item (tracker #74).
 *   v4 (2026-09-23) - v4 passes recipeId + the meal's protein to CookFlow so changes can be
 *   saved to the recipe ("📌 Save to recipe", tracker #71). v3 (2026-09-21) adds the dedicated Protein control (PUT /meal-plan/{id}/protein) - v2 was 2026-09-19
 * Scope: PRODUCTION - mx-inv frontend, meal plan feature.
 * Architecture: Rendered inside <FocusScreen> by MealPlanView.tsx when a plan
 *   row (MealPlanEntryCard.tsx) is opened; replaces the old inline-expanded
 *   card (the owner, 2026-09-18: focus screens, not inline). The cook flow itself is
 *   the shared recipes/CookFlow.tsx (also used by the Recipe Book); this file
 *   supplies its plan-specific parts: completing via /meal-plan/{id}/complete
 *   (a made entry falls off the plan - the plan is a working list, not a
 *   history), saving picks as the entry's overrides, and removing the entry.
 *   v2: the STANDING pantry-check entry (entry.is_standing - a recipe whose lines
 *   are every bulk item, not a dish) shows only the pantry check and a "done"
 *   button; there is nothing to cook or draw.
 */
import type { MealPlanEntry } from '../../api/types'
import { useRecipe, useRecipeIngredients } from '../recipes/useRecipes'
import { REF_PREFIX } from '../recipes/shared'
import { CookFlow } from '../recipes/CookFlow'
import { PantryCheck } from '../recipes/PantryCheck'
import { useCompleteMealPlanEntry, useRemoveFromMealPlan, useSaveMealPlanOverrides, useSetMealPlanProtein } from './mutations'
import { useMealPlan } from './useMealPlan'
import { useProteins } from '../warehouse/useWarehouse'
import { FoodPick } from '../warehouse/ItemPick'
import { RecipeIngredients } from '../recipes/RecipeIngredients'

import { useConfirm } from '../../components/ConfirmDialog'
import { RecordLink } from '../../components/RecordLink'

export function MealPlanEntryFocus({ entry, onRemoved }: { entry: MealPlanEntry; onRemoved: () => void }) {
  const { data: recipe } = useRecipe(entry.recipe_id)
  const { data: ingredients } = useRecipeIngredients(entry.recipe_id)
  const completeEntry = useCompleteMealPlanEntry()
  const removeEntry = useRemoveFromMealPlan()
  const saveOverrides = useSaveMealPlanOverrides()
  const setProtein = useSetMealPlanProtein()
  const { data: proteins } = useProteins()
  // The list's live copy of this entry: the focus screen holds the snapshot taken when it was opened, which
  // goes stale once the protein is changed here.
  const { data: entries } = useMealPlan()
  const live = entries?.find((e) => e.meal_plan_id === entry.meal_plan_id) ?? entry
  const confirm = useConfirm()

  if (entry.is_standing) {
    return (
      <div className="recipe-focus">
        <h2>🧂 Pantry check — what do we need this time?</h2>
        <p className="mgmt-status">
          Every bulk staple in the catalog is listed below, in store-walk order. Tick each one we
          need this time; it goes straight onto the Galley shopping list and clears when it is
          received. Anything left unticked is treated as fine. The list keeps itself up to date
          as bulk items are added or changed.
        </p>
        {!ingredients ? <p className="mgmt-status">Loading…</p> : <PantryCheck lines={ingredients} standing />}
        <div className="recipe-ingredients-actions">
          <button
            type="button"
            disabled={removeEntry.isPending}
            onClick={() => removeEntry.mutate(entry.meal_plan_id, { onSuccess: onRemoved })}
          >
            ✅ Done — take the pantry check off the plan
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="recipe-focus">
      <h2>
        {entry.planned_for ? `📅 ${entry.planned_for} — ` : ''}
        <RecordLink to={{ kind: 'recipe', id: entry.recipe_id }} title="Open the recipe in the Recipe Book">
          {entry.title}
        </RecordLink>
        {entry.servings ? `   ·   🍽️ ${entry.servings}` : ''}
      </h2>
      {entry.notes && <p className="recipe-notes">📝 {entry.notes}</p>}
      {recipe && (recipe.body.startsWith(REF_PREFIX) ? (
        <p className="recipe-text">{recipe.body}</p>
      ) : (
        <pre className="recipe-text-block">{recipe.body}</pre>
      ))}

      <div className="mealplan-protein">
        <div className="search-pick-field">
          <span>🍗 Protein</span>
          <FoodPick
            protein
            value={live.protein_item_id ?? null}
            disabled={setProtein.isPending}
            noneLabel={live.recipe_protein_name ? `As the recipe says (${live.recipe_protein_name})` : 'None chosen'}
            placeholder={live.recipe_protein_name ? `As the recipe says (${live.recipe_protein_name})` : 'None chosen'}
            onPick={(p) => setProtein.mutate({ mealPlanId: entry.meal_plan_id, proteinItemId: p ? p.itemId : null })}
          />
        </div>
        {(live.protein_item_id ?? live.recipe_protein_item_id) != null && (
          <>
            {' '}
            <RecordLink to={{ kind: 'item', id: (live.protein_item_id ?? live.recipe_protein_item_id) as number }}>
              {live.protein_item_id != null
                ? (proteins?.find((p) => p.item_id === live.protein_item_id)?.item_name ?? 'the protein')
                : (live.recipe_protein_name ?? 'the protein')}
            </RecordLink>
          </>
        )}
        <span className="mgmt-status">
          {' '}Changing it re-seeds the picks below from what was last saved (unsaved tick changes are dropped);
          the other saved picks are kept.
        </span>
        {setProtein.isError && <p className="mgmt-status mgmt-status--error">{(setProtein.error as Error).message}</p>}
      </div>

      {!ingredients ? (
        <p className="mgmt-status">Loading ingredients…</p>
      ) : (
        <CookFlow
          key={JSON.stringify(live.overrides)}
          ingredients={ingredients}
          recipeId={entry.recipe_id}
          mealProteinItemId={live.protein_item_id}
          // Whatever was saved while planning the menu (the owner, 2026-09-17: needed
          // at both plan and make time). The entry is the snapshot taken when it
          // was opened, and CookFlow only seeds from it once, at mount.
          initialPicks={live.overrides}
          onComplete={(consumption, onDone) =>
            completeEntry.mutate(
              { mealPlanId: entry.meal_plan_id, consumption },
              { onSuccess: onDone },
            )}
          completing={completeEntry.isPending}
          completeLabel="✅ Made it"
          completingLabel="Marking made…"
          resultLead="✅ Made it — drew stock for"
          noLinkHint="(no catalog link)"
          // The entry is gone from the plan once made - show the result only.
          doneReplacesForm
          onSavePicks={(overrides, onSaved) =>
            saveOverrides.mutate(
              { mealPlanId: entry.meal_plan_id, overrides },
              { onSuccess: onSaved },
            )}
          savingPicks={saveOverrides.isPending}
          emptyNote={(
            <>
              <p className="mgmt-status">
                No structured ingredients saved for this recipe yet — parse them right here to get the
                stock draw (or open it in the{' '}
                <RecordLink to={{ kind: 'recipe', id: entry.recipe_id }}>Recipe Book</RecordLink>).
                You can still mark it made below with nothing drawn.
              </p>
              {/* tracker #76: parse + link in place; once saved, the list refetches and the cook flow takes over */}
              <RecipeIngredients recipeId={entry.recipe_id} />
            </>
          )}
          actions={(
            <button
              type="button"
              className="danger"
              disabled={removeEntry.isPending}
              onClick={async () => {
                if (await confirm({
                  title: `Remove "${entry.title}" from the meal plan?`,
                  message: 'Nothing has been drawn from stock.',
                  confirmLabel: 'Remove from plan',
                })) {
                  removeEntry.mutate(entry.meal_plan_id, { onSuccess: onRemoved })
                }
              }}
            >
              ✕ Remove from plan
            </button>
          )}
        />
      )}
    </div>
  )
}

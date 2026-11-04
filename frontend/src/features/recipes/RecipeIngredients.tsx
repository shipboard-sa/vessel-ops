/**
 * Purpose: The recipe's structured-ingredients section - parse button (stage 1),
 *   review/confirm form (stage 2), and the saved list that leads into cooking
 *   (stage 3, via the shared CookFlow).
 * Version: v7 (2026-09-23) - v7: item names in the "may be matched wrong" note open the item
 *   (tracker #74).
 *   v6 (2026-09-23) - v6 (tracker #71): "Re-parse" asks first (it resets the list and
 *   loses every saved fix); the cook flow gets recipeId so changes can be saved to the recipe,
 *   and the suspect-link note points there instead of at Re-parse.
 *   v5 (2026-09-19)
 * Scope: PRODUCTION - mx-inv frontend, recipes feature.
 * Architecture: Rendered by RecipeFocus.tsx. Owns parse + review state; the
 *   cook flow itself moved to CookFlow.tsx (shared with the meal plan focus
 *   screen) in v2. Calls useMakeRecipe / useParseIngredients /
 *   useSaveRecipeIngredients (mutations.ts). Review-row units use the shared
 *   governed components/UnitPicker (v3; was free text); a parsed unit that is
 *   not in the units table blocks Save until the reviewer picks a listed one.
 *   v4: shows "converted from 500 g" when the parser converted metric to imperial.
 *   v5: the review form moved to IngredientReview.tsx (asks about uncertain matches,
 *   adds new items on the spot); the saved list warns about links that look wrong.
 */
import { useState } from 'react'
import type { RecipeIngredient, RecipeIngredientCandidate } from '../../api/types'
import { useRecipeIngredients } from './useRecipes'
import { CookFlow } from './CookFlow'
import { IngredientReview } from './IngredientReview'
import { useMakeRecipe, useParseIngredients } from './mutations'
import { useConfirm } from '../../components/ConfirmDialog'
import { RecordLink } from '../../components/RecordLink'

// Stage 2/3 of the parse-once-reuse-forever flow (the owner, 2026-09-16): once
// saved, a recipe's ingredient list is its permanent structured state -
// this renders whichever stage the recipe is currently in.
export function RecipeIngredients({ recipeId }: { recipeId: number }) {
  const { data: saved, isLoading } = useRecipeIngredients(recipeId)
  const [reviewing, setReviewing] = useState<RecipeIngredientCandidate[] | null>(null)
  const parseIngredients = useParseIngredients()
  const confirm = useConfirm()

  if (isLoading) return <p className="mgmt-status">Loading ingredients…</p>

  if (reviewing) {
    return (
      <IngredientReview
        recipeId={recipeId}
        candidates={reviewing}
        onDone={() => setReviewing(null)}
      />
    )
  }

  if (!saved || saved.length === 0) {
    return (
      <div className="recipe-ingredients">
        <button
          type="button"
          disabled={parseIngredients.isPending}
          onClick={() => parseIngredients.mutate(recipeId, { onSuccess: setReviewing })}
        >
          {parseIngredients.isPending ? 'Parsing…' : '🧂 Parse ingredients'}
        </button>
        <p className="mgmt-status">
          One-time setup - pulls candidate ingredient lines out of the recipe text for you to
          confirm. After that, cooking this recipe skips straight to "how much do I have."
        </p>
      </div>
    )
  }

  return (
    <SavedIngredientsView
      recipeId={recipeId}
      ingredients={saved}
      onReparse={async () => {
        // Tracker #71 (the owner, 2026-09-23): re-parse rebuilds the whole list from the recipe text,
        // so it is gated - every fix saved since (re-links, amounts, added lines) goes with it.
        if (await confirm({
          title: 'Re-parse this recipe?',
          message: 'This recipe has already been parsed. Re-parsing resets its ingredient list to '
            + 'the original state from the recipe text - any changes you have made (fixed matches, '
            + 'amounts, added ingredients) will be lost. Saved picks on planned meals for this '
            + 'recipe may stop applying.',
          confirmLabel: 'Re-parse and lose my changes',
          cancelLabel: 'Keep my changes',
        })) parseIngredients.mutate(recipeId, { onSuccess: setReviewing })
      }}
      reparsing={parseIngredients.isPending}
    />
  )
}

function SavedIngredientsView({
  recipeId, ingredients, onReparse, reparsing,
}: {
  recipeId: number
  ingredients: RecipeIngredient[]
  onReparse: () => void
  reparsing: boolean
}) {
  const makeRecipe = useMakeRecipe()
  const suspect = ingredients.filter((i) => i.link_check === 'check')
  // The pick/quantity/swap/extras flow is shared with the meal plan's focus
  // screen (CookFlow); the only differences are the endpoint it completes
  // through (/recipes/{id}/make here) and that nothing is saved on a plan entry.
  return (
    <>
    {suspect.length > 0 && (
      <p className="recipe-review-suspect">
        ⚠️ {suspect.length} linked ingredient{suspect.length === 1 ? '' : 's'} may be matched to the
        wrong catalog item:{' '}
        {suspect.slice(0, 4).map((i, n) => (
          <span key={i.recipe_ingredient_id}>
            {n > 0 && '; '}
            “{i.raw_text}” →{' '}
            <RecordLink to={i.item_id != null ? { kind: 'item', id: i.item_id } : null}>{i.item_name}</RecordLink>
          </span>
        ))}
        {suspect.length > 4 ? '; …' : ''}. To fix one, pick the right item in its swap box below
        and tap “📌 Save to recipe”.
      </p>
    )}
    <CookFlow
      ingredients={ingredients}
      recipeId={recipeId}
      onComplete={(consumption, onDone) =>
        makeRecipe.mutate({ recipeId, consumption }, { onSuccess: onDone })}
      completing={makeRecipe.isPending}
      completeLabel="👩‍🍳 Cook this now"
      completingLabel="Cooking…"
      resultLead="✅ Drew stock for"
      noLinkHint="(no catalog link - link it beside this line)"
      actions={(
        <button type="button" className="link-button" onClick={onReparse} disabled={reparsing}>
          {reparsing ? 'Re-parsing…' : '🔄 Re-parse ingredients'}
        </button>
      )}
    />
    </>
  )
}

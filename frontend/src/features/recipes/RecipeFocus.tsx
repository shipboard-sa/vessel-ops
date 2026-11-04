/**
 * Purpose: The full-screen recipe view - body, notes, edit form, add-to-meal-
 *   plan, and the ingredients / cook flow - for one recipe.
 * Version: v6 (2026-09-23) - v6: the protein pick is FoodPick (type to search, "＋ New protein"
 *   first, created inline) instead of a plain select with "+ new" last (tracker #76).
 *   v5: "✅ Added" names the protein as a link to its item and says
 *   where the entry went ("see the Meal Plan tab") (tracker #74).
 *   v4 (2026-09-23) - v4 (tracker #71): the edit form shows an error when a save
 *   fails (it used to fail silently).
 * Scope: PRODUCTION - mx-inv frontend, recipes feature.
 * Architecture: Rendered inside <FocusScreen> by RecipesView.tsx when a list
 *   row (RecipeCard.tsx) is opened; replaces the old inline-expanded card
 *   (the owner, 2026-09-18: focus screens, not inline). Fetches its own recipe via
 *   useRecipe, hosts RecipeIngredients (-> CookFlow), and calls
 *   useAddToMealPlan / useUpdateRecipe / useDeleteRecipe. v2: hosts
 *   ConvertToImperial (metric -> imperial text proposal) under the body. v3 (tracker #24):
 *   the add-to-plan row has a PROTEIN pick (warehouse/useProteins - food items in the meat
 *   category, v6: FoodPick protein) that the server applies when the entry is created:
 *   it replaces the recipe's own protein line, else is added (data._protein_picks).
 */
import { useState } from 'react'
import type { RecipeDetail } from '../../api/types'
import { useRecipe } from './useRecipes'
import { useDeleteRecipe, useUpdateRecipe, type RecipeEditFields } from './mutations'
import { RECIPE_METHODS } from '../../api/types'
import { REF_PREFIX, csv } from './shared'
import { RecipeIngredients } from './RecipeIngredients'
import { ConvertToImperial } from './ConvertToImperial'
import { useAddToMealPlan } from '../mealplan/mutations'
import { useProteins } from '../warehouse/useWarehouse'
import { FoodPick } from '../warehouse/ItemPick'
import { useConfirm } from '../../components/ConfirmDialog'
import { RecordLink } from '../../components/RecordLink'

export function RecipeFocus({ recipeId, onDeleted }: { recipeId: number; onDeleted: () => void }) {
  const [editing, setEditing] = useState(false)
  const { data: recipe, isError, error } = useRecipe(recipeId)
  const addToMealPlan = useAddToMealPlan()
  const [plannedFor, setPlannedFor] = useState('')
  const [planAdded, setPlanAdded] = useState(false)
  const { data: proteins } = useProteins()
  const [protein, setProtein] = useState('') // '' = the recipe as written
  const [proteinName, setProteinName] = useState('')

  if (isError) return <p className="mgmt-status mgmt-status--error">{(error as Error).message}</p>
  if (!recipe) return <p className="mgmt-status">Loading recipe…</p>

  const isRef = recipe.body.startsWith(REF_PREFIX)
  const bits = [
    recipe.servings && `🍽️ ${recipe.servings}`,
    recipe.tags.method.length > 0 && `🔥 ${recipe.tags.method.join(', ')}`,
    recipe.tags.ingredient.length > 0 && `🧺 ${recipe.tags.ingredient.join(', ')}`,
    recipe.tags.tag.length > 0 && `🏷️ ${recipe.tags.tag.join(', ')}`,
  ].filter(Boolean)

  return (
    <div className="recipe-focus">
      <h2>{isRef ? '📖 ' : ''}{recipe.title}{recipe.source ? `   ·   ${recipe.source}` : ''}</h2>
      {bits.length > 0 && <p className="mgmt-status">{bits.join('  ·  ')}</p>}
      {editing ? (
        <RecipeEditForm recipe={recipe} onDone={() => setEditing(false)} onDeleted={onDeleted} />
      ) : (
        <>
          {isRef ? (
            <p className="recipe-text">{recipe.body}</p>
          ) : (
            <pre className="recipe-text-block">{recipe.body}</pre>
          )}
          {recipe.notes && <p className="recipe-notes">📝 {recipe.notes}</p>}
          <button type="button" onClick={() => setEditing(true)}>✏️ Edit</button>
          {!isRef && <ConvertToImperial recipeId={recipe.recipe_id} />}
          <div className="item-detail-row">
            <input
              type="date" value={plannedFor}
              onChange={(e) => { setPlannedFor(e.target.value); setPlanAdded(false) }}
              title="Optional - leave blank to just add it to the list"
            />
            <div className="search-pick-field" title="Optional: which protein this time. It replaces the recipe's own protein line if it has one, otherwise it is added.">
              <FoodPick
                protein
                value={protein ? Number(protein) : null}
                noneLabel="🍗 Protein: as written"
                placeholder="🍗 Protein: as written"
                onPick={(p) => { setProtein(p ? String(p.itemId) : ''); setProteinName(p ? p.itemName : ''); setPlanAdded(false) }}
              />
            </div>
            <button
              type="button"
              disabled={addToMealPlan.isPending}
              onClick={() => addToMealPlan.mutate(
                {
                  recipeId: recipe.recipe_id, plannedFor: plannedFor || undefined,
                  proteinItemId: protein ? Number(protein) : undefined,
                },
                { onSuccess: () => setPlanAdded(true) },
              )}
            >
              📅 Add to meal plan
            </button>
            {planAdded && (
              <span className="mgmt-status">
                ✅ Added
                {protein && (
                  <>
                    {' with '}
                    <RecordLink to={{ kind: 'item', id: Number(protein) }}>
                      {proteins?.find((p) => p.item_id === Number(protein))?.item_name ?? (proteinName || 'the protein')}
                    </RecordLink>
                  </>
                )}
                {' — see the Meal Plan tab'}
              </span>
            )}
            {addToMealPlan.isError && (
              <span className="mgmt-status mgmt-status--error">{(addToMealPlan.error as Error).message}</span>
            )}
          </div>
          <RecipeIngredients recipeId={recipe.recipe_id} />
        </>
      )}
    </div>
  )
}

function RecipeEditForm({
  recipe, onDone, onDeleted,
}: {
  recipe: RecipeDetail
  onDone: () => void
  /** The recipe no longer exists - leave its focus screen. */
  onDeleted: () => void
}) {
  const updateRecipe = useUpdateRecipe()
  const deleteRecipe = useDeleteRecipe()
  const confirm = useConfirm()
  // Seeded once at mount - the form is only mounted while editing this recipe.
  const [fields, setFields] = useState<RecipeEditFields>(() => ({
    title: recipe.title, servings: recipe.servings ?? '', source: recipe.source ?? '',
    body: recipe.body, notes: recipe.notes ?? '',
  }))
  const [ingredients, setIngredients] = useState(recipe.tags.ingredient.join(', '))
  const [methods, setMethods] = useState<string[]>(recipe.tags.method)
  const [tags, setTags] = useState(recipe.tags.tag.join(', '))

  const set = <K extends keyof RecipeEditFields>(key: K, value: RecipeEditFields[K]) =>
    setFields((f) => ({ ...f, [key]: value }))

  const knownMethods = Array.from(new Set([...RECIPE_METHODS, ...recipe.tags.method]))

  const save = () => {
    updateRecipe.mutate(
      {
        recipeId: recipe.recipe_id,
        fields: { ...fields, ingredients: csv(ingredients), methods, tags: csv(tags) },
      },
      { onSuccess: onDone },
    )
  }

  return (
    <div className="recipe-edit-form">
      <label>
        Title
        <input value={fields.title ?? ''} onChange={(e) => set('title', e.target.value)} />
      </label>
      <div className="item-detail-row">
        <label>
          Servings
          <input value={fields.servings ?? ''} onChange={(e) => set('servings', e.target.value)} />
        </label>
        <label>
          Source
          <input value={fields.source ?? ''} onChange={(e) => set('source', e.target.value)} />
        </label>
      </div>
      <label>
        Recipe text
        <textarea rows={8} value={fields.body ?? ''} onChange={(e) => set('body', e.target.value)} />
      </label>
      <label>
        Main ingredients
        <input value={ingredients} onChange={(e) => setIngredients(e.target.value)} />
      </label>
      <label>
        Cooking method(s)
        <select
          multiple value={methods}
          onChange={(e) => setMethods(Array.from(e.target.selectedOptions).map((o) => o.value))}
        >
          {knownMethods.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>
      <label>
        Other tags
        <input value={tags} onChange={(e) => setTags(e.target.value)} />
      </label>
      <label>
        Notes
        <input value={fields.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
      </label>
      <div className="item-detail-actions">
        <button type="button" onClick={save} disabled={updateRecipe.isPending}>💾 Save changes</button>
        <button
          type="button"
          className="danger"
          onClick={async () => {
            if (await confirm({
              title: `Delete the recipe "${recipe.title}"?`,
              message: 'Its ingredient lines and any meal-plan entries for it go with it.',
              confirmLabel: 'Delete recipe',
            })) deleteRecipe.mutate(recipe.recipe_id, { onSuccess: onDeleted })
          }}
        >
          🗑️ Delete recipe
        </button>
        <button type="button" onClick={onDone}>✕ Cancel</button>
      </div>
      {/* tracker #71: a failed save used to show nothing at all */}
      {updateRecipe.isError && (
        <p className="mgmt-status mgmt-status--error">Not saved: {(updateRecipe.error as Error).message}</p>
      )}
    </div>
  )
}

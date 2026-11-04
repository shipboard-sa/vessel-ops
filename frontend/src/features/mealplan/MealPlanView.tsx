/**
 * Purpose: Meal Plan tab shell - the working list of planned recipes, plus a
 *   full-screen focus view for one entry (cook / save picks / remove).
 * Version: v5 (2026-09-23) - v5: "＋ Add a recipe to the plan" right here - a type-to-search recipe
 *   picker with "＋ New recipe…" first (title + pasted text, created inline); adding opens the new
 *   entry. Before, recipes could only be added from the Recipe Book (tracker #76).
 *   v4: an origin for AppNav (links inside an entry open elsewhere and
 *   Back reopens the entry, #74); v3 2026-09-19
 * Scope: PRODUCTION - mx-inv frontend, meal plan feature.
 * Architecture: Rendered by App.tsx. Owns the focused-entry trail; rows
 *   (MealPlanEntryCard) call focus.open, the focus screen is
 *   MealPlanEntryFocus. The trail holds the ENTRY object (a snapshot taken
 *   when opened), not just its id: completing an entry drops it from the
 *   /meal-plan list, and the screen must stay up to show the "Made it" result
 *   until you press Back. The list stays mounted but hidden meanwhile.
 *   v3: a "Pantry check" button adds the standing pantry-check recipe (every bulk
 *   item) to the plan and opens it, so the planner can say which staples are needed.
 */
import { useMealPlan } from './useMealPlan'
import { MealPlanEntryCard } from './MealPlanEntryCard'
import { MealPlanEntryFocus } from './MealPlanEntryFocus'
import { useAddPantryCheck, useAddToMealPlan } from './mutations'
import { useRecipes } from '../recipes/useRecipes'
import { useCreateRecipe } from '../recipes/mutations'
import { SearchPick } from '../../components/SearchPick'
import { apiGet } from '../../api/client'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { MealPlanEntry, RecipeListRow } from '../../api/types'
import { FocusScreen, useFocusTrail } from '../../components/FocusScreen'
import { ProteinsManager } from './ProteinsManager'
import { NavScopeProvider, useReturnRestore } from '../../components/AppNav'

export function MealPlanView() {
  const { data: entries, isLoading, isError, error } = useMealPlan()
  const focus = useFocusTrail<MealPlanEntry>()
  const focused = focus.current
  useReturnRestore('galley', (r) => { if (r.trail) focus.openPath(r.trail as MealPlanEntry[]) }, 'mealplan')
  const addPantryCheck = useAddPantryCheck()
  const [showProteins, setShowProteins] = useState(false)
  const queryClient = useQueryClient()

  // Refetch the plan and open one entry (just added).
  const openEntry = async (mealPlanId: number) => {
    const fresh = await queryClient.fetchQuery({
      queryKey: ['meal-plan'], queryFn: () => apiGet<MealPlanEntry[]>('/meal-plan'), staleTime: 0,
    })
    const entry = fresh.find((e) => e.meal_plan_id === mealPlanId)
    if (entry) focus.open(entry)
  }

  // Add (or reuse) the standing pantry check, then open its entry.
  const openPantryCheck = () =>
    addPantryCheck.mutate(undefined, { onSuccess: ({ meal_plan_id }) => openEntry(meal_plan_id) })

  return (
    <>
      {focused && (
        <FocusScreen focus={focus} listLabel="meal plan" labelOf={(e) => e.title}>
          <NavScopeProvider scope={{ origin: () => ({ tab: 'galley', sub: 'mealplan', trail: focus.trail }) }}>
            <MealPlanEntryFocus key={focused.meal_plan_id} entry={focused} onRemoved={focus.clear} />
          </NavScopeProvider>
        </FocusScreen>
      )}

      <div className="recipes-view" hidden={!!focused}>
        <h2>📅 Meal Plan</h2>
        <p className="mgmt-status">
          Add recipes with "＋ Add a recipe to the plan" below (a recipe that isn't in the book yet can be
          created right there), or from the Recipe Book ("📅 Add to meal plan"), to build a working list here.
          Mark one made to draw its stock and drop it off the list, or remove it if plans changed —
          nothing is kept either way once it's off this list. "💾 Save picks" on an entry feeds
          this plan's needs into the merged food shopping cart on the Galley Provisioning tab —
          that's the one list to actually shop from.
        </p>

        <p>
          <button type="button" onClick={openPantryCheck} disabled={addPantryCheck.isPending}>
            🧂 Pantry check — what staples do we need this time?
          </button>
          {addPantryCheck.isError && (
            <span className="mgmt-status mgmt-status--error"> {(addPantryCheck.error as Error).message}</span>
          )}
          {' '}
          <button type="button" onClick={() => setShowProteins((v) => !v)}>🍗 Manage proteins</button>
        </p>
        {showProteins && <ProteinsManager onClose={() => setShowProteins(false)} />}

        <AddRecipeToPlan onAdded={openEntry} />

        {isLoading && <p className="mgmt-status">Loading meal plan…</p>}
        {isError && <p className="mgmt-status mgmt-status--error">{(error as Error).message}</p>}
        {entries && (
          entries.length === 0 ? (
            <p className="mgmt-status">Nothing planned yet — add a recipe above.</p>
          ) : (
            <ul className="recipe-list">
              {entries.map((e) => <MealPlanEntryCard key={e.meal_plan_id} entry={e} onOpen={focus.open} />)}
            </ul>
          )
        )}
      </div>
    </>
  )
}

// Tracker #76: add a recipe to the plan without leaving the Meal Plan - pick one (type to search),
// or create it on the spot, then add it and open the new entry (protein, parse, picks are there).
function AddRecipeToPlan({ onAdded }: { onAdded: (mealPlanId: number) => void }) {
  const { data: recipes } = useRecipes({})
  const addToMealPlan = useAddToMealPlan()
  const [recipeId, setRecipeId] = useState<number | null>(null)
  const [plannedFor, setPlannedFor] = useState('')

  const add = () => {
    if (recipeId === null) return
    addToMealPlan.mutate(
      { recipeId, plannedFor: plannedFor || undefined },
      {
        onSuccess: (res) => {
          setRecipeId(null); setPlannedFor('')
          onAdded((res as { meal_plan_id: number }).meal_plan_id)
        },
      },
    )
  }

  return (
    <div className="item-detail-row mealplan-add-recipe">
      <strong>＋ Add a recipe to the plan</strong>
      <SearchPick<RecipeListRow>
        options={recipes ?? []}
        keyOf={(r) => r.recipe_id}
        labelOf={(r) => r.title}
        hintOf={(r) => r.main_ingredients}
        value={recipeId}
        placeholder="Type a recipe…"
        onPick={(k) => setRecipeId(k === null ? null : Number(k))}
        newLabel={(t) => (t ? `＋ New recipe “${t}”…` : '＋ New recipe…')}
        renderNew={(typed, done, cancel) => (
          <NewRecipeInline initialTitle={typed} onCancel={cancel} onCreated={(id, title) => done(id, title)} />
        )}
      />
      <input
        type="date" value={plannedFor}
        onChange={(e) => setPlannedFor(e.target.value)}
        title="Optional - leave blank to just add it to the list"
      />
      <button type="button" disabled={recipeId === null || addToMealPlan.isPending} onClick={add}>
        📅 Add to meal plan
      </button>
      {addToMealPlan.isError && (
        <span className="mgmt-status mgmt-status--error">{(addToMealPlan.error as Error).message}</span>
      )}
    </div>
  )
}

// The short "new recipe" box: a title and the pasted recipe text (tags, notes etc. can be filled in
// later from the Recipe Book). Not a <form> - Enter in the title creates, Escape backs out.
function NewRecipeInline({
  initialTitle, onCreated, onCancel,
}: { initialTitle: string; onCreated: (recipeId: number, title: string) => void; onCancel: () => void }) {
  const createRecipe = useCreateRecipe()
  const [title, setTitle] = useState(initialTitle)
  const [servings, setServings] = useState('')
  const [body, setBody] = useState('')
  const ok = !!title.trim() && !!body.trim() && !createRecipe.isPending

  const create = () => {
    if (!ok) return
    createRecipe.mutate(
      { title: title.trim(), body, servings: servings.trim() || undefined },
      { onSuccess: (res) => onCreated((res as { recipe_id: number }).recipe_id, title.trim()) },
    )
  }

  return (
    <div
      className="recipe-review-new"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel() } }}
    >
      <strong>New recipe</strong>
      <label>
        Title
        <input
          autoFocus value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); create() } }}
        />
      </label>
      <label>
        Servings (optional)
        <input value={servings} onChange={(e) => setServings(e.target.value)} placeholder="4" />
      </label>
      <label>
        Recipe text (paste it in - ingredients and steps)
        <textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <button type="button" disabled={!ok} onClick={create}>
        {createRecipe.isPending ? 'Creating…' : '✓ Create and use'}
      </button>
      <button type="button" onClick={onCancel}>✕</button>
      {createRecipe.isError && (
        <span className="mgmt-status mgmt-status--error">Could not create the recipe: {(createRecipe.error as Error).message}</span>
      )}
    </div>
  )
}

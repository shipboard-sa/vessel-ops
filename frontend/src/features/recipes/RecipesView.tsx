/**
 * Purpose: Recipe Book tab shell - add-recipe form, search/filters, the recipe
 *   list, and a full-screen focus view for one recipe with a "Back".
 * Version: v3 (2026-09-23) - v3: AppNav v3 - opens a recipe asked for by another tab (Back returns
 *   there) and is an origin for links inside a recipe (#74); v2 2026-09-18
 * Scope: PRODUCTION - mx-inv frontend, recipes feature.
 * Architecture: Rendered by App.tsx. Owns the search/filter state and the
 *   focused-recipe trail; rows (RecipeCard) call focus.open, the focus screen
 *   is RecipeFocus. The list stays mounted but hidden while a recipe is
 *   focused so filters/search survive Back (the owner, 2026-09-18: focus screens,
 *   not inline).
 */
import { useState } from 'react'
import { useRecipes, useRecipeTagValues, type RecipeFilters } from './useRecipes'
import { RecipeCard } from './RecipeCard'
import { RecipeFocus } from './RecipeFocus'
import { AddRecipeForm } from './AddRecipeForm'
import { RECIPE_METHODS } from '../../api/types'
import { FocusScreen, useFocusTrail } from '../../components/FocusScreen'
import { NavScopeProvider, useAnchoredFocus, useReturnRestore, type RecordRef } from '../../components/AppNav'
import './RecipesView.css'

const LIMIT = 40

export function RecipesView() {
  const focus = useFocusTrail<number>()
  const shown = useAnchoredFocus(focus, (ref) => (ref.kind === 'recipe' ? [ref.id] : null))
  useReturnRestore('galley', (r) => { if (r.trail) focus.openPath(r.trail as number[]) }, 'recipes')
  const scope = {
    origin: () => ({ tab: 'galley' as const, sub: 'recipes', trail: focus.trail }),
    openLocal: (ref: RecordRef) => {
      if (ref.kind !== 'recipe') return false
      const i = focus.trail.indexOf(ref.id)
      if (i >= 0) focus.goTo(i + 1); else focus.push(ref.id)
      return true
    },
  }
  const [search, setSearch] = useState('')
  const [pickIng, setPickIng] = useState<string[]>([])
  const [pickMethod, setPickMethod] = useState<string[]>([])
  const [pickTag, setPickTag] = useState<string[]>([])

  const { data: ingOpts } = useRecipeTagValues('ingredient')
  const { data: methodOptsRaw } = useRecipeTagValues('method')
  const { data: tagOpts } = useRecipeTagValues('tag')
  const methodOpts = Array.from(new Set([...RECIPE_METHODS, ...(methodOptsRaw ?? [])])).sort()

  const filters: RecipeFilters = {
    search: search || undefined,
    ingredients: pickIng.length ? pickIng : undefined,
    methods: pickMethod.length ? pickMethod : undefined,
    tags: pickTag.length ? pickTag : undefined,
  }
  const { data: rows, isLoading, isError, error } = useRecipes(filters)

  return (
    <>
      {focus.current !== null && (
        <FocusScreen
          focus={shown}
          listLabel="recipes"
          labelOf={(id) => (rows ?? []).find((r) => r.recipe_id === id)?.title ?? 'recipe'}
        >
          <NavScopeProvider scope={scope}>
            <RecipeFocus key={focus.current} recipeId={focus.current} onDeleted={shown.clear} />
          </NavScopeProvider>
        </FocusScreen>
      )}

      {/* Kept mounted (just hidden) while a recipe is focused, so the search
          text, filters and Add-recipe form are exactly as left when you come Back. */}
      <div className="recipes-view" hidden={focus.current !== null}>
        <h2>🍽️ Galley Recipe Book</h2>
        <p className="mgmt-status">Paste a recipe, tag it, find it later. Ingredients link to your galley stock when you plan or cook it.</p>

        <AddRecipeForm />

        <div className="recipe-filters">
          <input
            type="text" placeholder="🔍 Search title / text"
            value={search} onChange={(e) => setSearch(e.target.value)}
          />
          <MultiPicker label="Main ingredient" options={ingOpts ?? []} value={pickIng} onChange={setPickIng} />
          <MultiPicker label="Cooking method" options={methodOpts} value={pickMethod} onChange={setPickMethod} />
          <MultiPicker label="Tag" options={tagOpts ?? []} value={pickTag} onChange={setPickTag} />
        </div>

        {isLoading && <p className="mgmt-status">Loading recipes…</p>}
        {isError && <p className="mgmt-status mgmt-status--error">{(error as Error).message}</p>}
        {rows && (
          rows.length === 0 ? (
            <p className="mgmt-status">
              {search || pickIng.length || pickMethod.length || pickTag.length
                ? 'No recipes match. Add one above.'
                : 'No recipes yet — add your first one above.'}
            </p>
          ) : (
            <>
              <p className="mgmt-status">
                {rows.length > LIMIT
                  ? `${rows.length} recipes match — showing the first ${LIMIT}. Add a search term or filter to narrow it.`
                  : `${rows.length} recipe(s)`}
              </p>
              <ul className="recipe-list">
                {rows.slice(0, LIMIT).map((r) => <RecipeCard key={r.recipe_id} row={r} onOpen={focus.open} />)}
              </ul>
            </>
          )
        )}
      </div>
    </>
  )
}

function MultiPicker({
  label, options, value, onChange,
}: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <label className="multi-picker">
      {label}
      <select
        multiple value={value}
        onChange={(e) => onChange(Array.from(e.target.selectedOptions).map((o) => o.value))}
      >
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  )
}

/**
 * Purpose: One row in the recipe list - a title button that opens the recipe's
 *   focus screen.
 * Version: v2 (2026-09-18)
 * Scope: PRODUCTION - mx-inv frontend, recipes feature.
 * Architecture: Rendered by RecipesView.tsx; calls onOpen(recipe_id). The full
 *   recipe (body, edit, ingredients, cook flow) lives in RecipeFocus.tsx - this
 *   used to expand inline (v1) before the focus-screen rule (the owner, 2026-09-18).
 */
import type { RecipeListRow } from '../../api/types'

export function RecipeCard({ row, onOpen }: { row: RecipeListRow; onOpen: (recipeId: number) => void }) {
  return (
    <li className="recipe-card">
      <button type="button" className="recipe-card-header" onClick={() => onOpen(row.recipe_id)}>
        <span>{row.title}{row.source ? `   ·   ${row.source}` : ''}</span>
      </button>
    </li>
  )
}

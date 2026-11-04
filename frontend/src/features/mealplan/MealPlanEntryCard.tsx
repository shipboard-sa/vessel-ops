/**
 * Purpose: One row in the meal-plan list - a button that opens that entry's
 *   focus screen.
 * Version: v2 (2026-09-18)
 * Scope: PRODUCTION - mx-inv frontend, meal plan feature.
 * Architecture: Rendered by MealPlanView.tsx; calls onOpen(entry). The cook
 *   flow / recipe text lives in MealPlanEntryFocus.tsx (which uses the shared
 *   recipes/CookFlow.tsx); this used to expand inline (v1, ~260 lines, a
 *   hand-copy of the Recipe Book's cook flow) before the focus-screen rule
 *   (the owner, 2026-09-18).
 */
import type { MealPlanEntry } from '../../api/types'

export function MealPlanEntryCard({
  entry, onOpen,
}: { entry: MealPlanEntry; onOpen: (entry: MealPlanEntry) => void }) {
  return (
    <li className="recipe-card">
      <button type="button" className="recipe-card-header" onClick={() => onOpen(entry)}>
        <span>
          {entry.planned_for ? `📅 ${entry.planned_for} — ` : ''}
          {entry.title}
          {entry.is_standing ? '   ·   standing' : ''}
          {entry.servings ? `   ·   🍽️ ${entry.servings}` : ''}
        </span>
      </button>
    </li>
  )
}

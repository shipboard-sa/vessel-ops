/**
 * Purpose: Galley tab shell - sub-tab nav for Galley Provisioning / Recipe Book / Meal Plan.
 * Version: v2 (2026-09-23) - v2: AppNav v3 - a recipe opened from another tab lands on the Recipe
 *   Book, a return restores the right sub-tab, and a NavScope makes this tab an origin (#74).
 * Scope: PRODUCTION - mx-inv frontend, galley feature.
 * Architecture: Rendered by App.tsx. A sub-tab mounts the first time it is shown and then stays
 *   mounted (hidden) so half-done work survives a trip elsewhere; a pending open or return aimed at
 *   a sub-tab switches to it first, and the sub-tab view consumes it.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { NavScopeProvider, useAppNav } from '../../components/AppNav'
import { ProvisioningView } from '../provisioning/ProvisioningView'
import { RecipesView } from '../recipes/RecipesView'
import { MealPlanView } from '../mealplan/MealPlanView'
import '../warehouse/WarehouseView.css'

// Food lives here, separate from the maintenance-supply Warehouse tab -
// kept apart in the nav so galley provisioning/recipes/meal plan never
// get mixed in with spares/tools/gear (the owner, 2026-09-17).
type SubTab = 'provisioning' | 'recipes' | 'mealplan'

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'provisioning', label: '🍽️ Galley Provisioning' },
  { id: 'recipes', label: '📖 Recipe Book' },
  { id: 'mealplan', label: '📅 Meal Plan' },
]

export function GalleyView() {
  const [sub, setSubState] = useState<SubTab>('provisioning')
  const [visited, setVisited] = useState<Set<SubTab>>(() => new Set<SubTab>(['provisioning']))
  const setSub = (s: SubTab) => { setSubState(s); setVisited((v) => (v.has(s) ? v : new Set(v).add(s))) }
  const pane = (s: SubTab, node: ReactNode) => (visited.has(s) ? <div hidden={sub !== s}>{node}</div> : null)
  const appNav = useAppNav()
  const pendingKind = appNav?.pendingOpen?.ref.kind
  useEffect(() => {
    if (pendingKind === 'recipe') setSub('recipes')
  }, [appNav?.pendingOpen, pendingKind])
  // A return carrying a sub-tab's own trail is left pending for that sub-tab to restore.
  useEffect(() => {
    const r = appNav?.pendingReturn
    if (r?.tab === 'galley') {
      setSub((r.sub as SubTab) ?? 'provisioning')
      if (!r.trail) appNav?.clearPendingReturn()
    }
  }, [appNav, appNav?.pendingReturn])

  return (
    <div className="warehouse-view">
      <nav className="sub-tabs">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={sub === t.id ? 'active' : undefined}
            onClick={() => setSub(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <NavScopeProvider scope={{ origin: () => ({ tab: 'galley', sub }) }}>
        {pane('provisioning', <ProvisioningView />)}
        {pane('recipes', <RecipesView />)}
        {pane('mealplan', <MealPlanView />)}
      </NavScopeProvider>
    </div>
  )
}

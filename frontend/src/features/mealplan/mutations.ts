import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiSend } from '../../api/client'
import { todayLocal } from '../../api/date'
import type { MakeRecipeResult, MealPlanOverridePick } from '../../api/types'

function useMealPlanMutation<TVars>(fn: (vars: TVars) => Promise<unknown>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meal-plan'] })
      queryClient.invalidateQueries({ queryKey: ['meal-plan-shopping-list'] })
    },
  })
}

export function useAddToMealPlan() {
  return useMealPlanMutation(
    ({ recipeId, plannedFor, notes, proteinItemId }: {
      recipeId: number; plannedFor?: string; notes?: string
      /** A chosen protein: replaces the recipe's own protein line, else is added (server-side). */
      proteinItemId?: number
    }) =>
      apiSend('POST', '/meal-plan', {
        recipe_id: recipeId, planned_for: plannedFor || null, notes: notes || null,
        protein_item_id: proteinItemId ?? null,
      }),
  )
}

export function useRemoveFromMealPlan() {
  return useMealPlanMutation((mealPlanId: number) => apiSend('DELETE', `/meal-plan/${mealPlanId}`))
}

// Saves the current swap/extra picks to the entry without drawing any
// stock - the "planning the menu" moment (the owner, 2026-09-17): feeds
// meal_plan_shopping_list() from here, separate from "Made it".
export function useSaveMealPlanOverrides() {
  return useMealPlanMutation(
    ({ mealPlanId, overrides }: { mealPlanId: number; overrides: MealPlanOverridePick[] }) =>
      apiSend('PUT', `/meal-plan/${mealPlanId}/overrides`, { overrides: overrides.length ? overrides : null }),
  )
}

// Change (or clear) the protein of a plan entry, keeping its other saved picks (v2, 2026-09-21).
export function useSetMealPlanProtein() {
  return useMealPlanMutation(
    ({ mealPlanId, proteinItemId }: { mealPlanId: number; proteinItemId: number | null }) =>
      apiSend('PUT', `/meal-plan/${mealPlanId}/protein`, { protein_item_id: proteinItemId }),
  )
}

// Marks a plan entry made: draws real stock (same recipe_consume path as
// cooking a recipe directly), then the entry falls off the list - the plan
// carries no history of its own, per the owner/crew member 2026-09-17.
export function useCompleteMealPlanEntry() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ mealPlanId, consumption }: { mealPlanId: number; consumption?: { recipe_ingredient_id?: number; quantity?: number; item_id?: number }[] }) =>
      apiSend<MakeRecipeResult>('POST', `/meal-plan/${mealPlanId}/complete`, {
        occurred_on: todayLocal(),
        consumption: consumption ?? null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meal-plan'] })
      queryClient.invalidateQueries({ queryKey: ['meal-plan-shopping-list'] })
      queryClient.invalidateQueries({ queryKey: ['items'] })
      queryClient.invalidateQueries({ queryKey: ['restock'] })
    },
  })
}

// Put the standing pantry-check recipe (every bulk item) on the plan - created the
// first time, reused after - and get back its meal_plan_id.
export function useAddPantryCheck() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiSend<{ meal_plan_id: number; recipe_id: number }>('POST', '/meal-plan/pantry-check'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meal-plan'] })
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
    },
  })
}

/**
 * Purpose: React-query mutations for the recipes feature (create / update /
 *   delete, ingredient parse + save, cook, and the imperial text-conversion
 *   proposal).
 * Version: v3 (2026-09-23) - v3: useApplyIngredientChanges ("Keep in recipe", tracker #71). v2 was 2026-09-18
 * Scope: PRODUCTION - mx-inv frontend, recipes feature.
 * Architecture: Data-writing hooks over /api/recipes/*; read hooks live in
 *   useRecipes.ts. Used by RecipeFocus, RecipeIngredients, CookFlow,
 *   AddRecipeForm and ConvertToImperial. v2: useConvertRecipeText.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiSend } from '../../api/client'
import { todayLocal } from '../../api/date'
import type { MakeRecipeResult, RecipeIngredientCandidate, RecipeTextConversion } from '../../api/types'

function useRecipeMutation<TVars>(fn: (vars: TVars) => Promise<unknown>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
      queryClient.invalidateQueries({ queryKey: ['recipe'] })
      queryClient.invalidateQueries({ queryKey: ['recipe-tag-values'] })
    },
  })
}

export interface NewRecipe {
  title: string
  body: string
  source?: string
  servings?: string
  notes?: string
  ingredients?: string[]
  methods?: string[]
  tags?: string[]
}

export function useCreateRecipe() {
  return useRecipeMutation((body: NewRecipe) => apiSend('POST', '/recipes', body))
}

export interface RecipeEditFields {
  title?: string
  source?: string | null
  servings?: string | null
  body?: string
  notes?: string | null
  ingredients?: string[]
  methods?: string[]
  tags?: string[]
}

export function useUpdateRecipe() {
  return useRecipeMutation(
    ({ recipeId, fields }: { recipeId: number; fields: RecipeEditFields }) =>
      apiSend('PATCH', `/recipes/${recipeId}`, fields),
  )
}

export function useDeleteRecipe() {
  return useRecipeMutation((recipeId: number) => apiSend('DELETE', `/recipes/${recipeId}`))
}

// Ephemeral (GET under the hood, nothing saved) - modeled as a mutation
// since it's a manual "run this now" trigger, not data to cache/subscribe to.
export function useParseIngredients() {
  return useMutation({
    mutationFn: (recipeId: number) =>
      apiGet<RecipeIngredientCandidate[]>(`/recipes/${recipeId}/parse-ingredients`),
  })
}

// Ephemeral proposal (GET, nothing saved), fired only when the user clicks
// "Convert to imperial" - a manual trigger, so a mutation like the parse above.
export function useConvertRecipeText() {
  return useMutation({
    mutationFn: (recipeId: number) =>
      apiGet<RecipeTextConversion>(`/recipes/${recipeId}/convert-text`),
  })
}

export interface SavedIngredient {
  raw_text: string
  item_id: number | null
  quantity: number | null
  unit: string | null
}

export function useSaveRecipeIngredients() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ recipeId, ingredients }: { recipeId: number; ingredients: SavedIngredient[] }) =>
      apiSend('PUT', `/recipes/${recipeId}/ingredients`, ingredients),
    onSuccess: (_data, { recipeId }) => {
      queryClient.invalidateQueries({ queryKey: ['recipe-ingredients', recipeId] })
    },
  })
}

export function useMakeRecipe() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ recipeId, consumption }: { recipeId: number; consumption?: { recipe_ingredient_id?: number; quantity?: number; item_id?: number }[] }) =>
      apiSend<MakeRecipeResult>('POST', `/recipes/${recipeId}/make`, {
        occurred_on: todayLocal(),
        consumption: consumption ?? null,
      }),
    onSuccess: (_data, { recipeId }) => {
      queryClient.invalidateQueries({ queryKey: ['recipe-ingredients', recipeId] })
      queryClient.invalidateQueries({ queryKey: ['items'] })
      queryClient.invalidateQueries({ queryKey: ['restock'] })
    },
  })
}

// (Re)link ONE saved ingredient line to a catalog item (null = reference only) -
// used when an ingredient is added to the catalog at plan or cook time.
export function useLinkIngredientItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ ingredientId, itemId }: { ingredientId: number; itemId: number | null }) =>
      apiSend('PUT', `/recipes/ingredients/${ingredientId}/item`, { item_id: itemId }),
    onSuccess: () => {
      for (const key of ['recipe-ingredients', 'meal-plan', 'items', 'food-cart']) {
        queryClient.invalidateQueries({ queryKey: [key] })
      }
    },
  })
}

// "📌 Keep in recipe" (tracker #71): save changes made at plan/cook time back onto the
// RECIPE - re-link or re-quantify saved lines, append new ones - in one transaction.
export interface RecipeIngredientChanges {
  updates: { recipe_ingredient_id: number; item_id?: number; quantity?: number | null }[]
  additions: { item_id: number; quantity: number | null }[]
}

export function useApplyIngredientChanges() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ recipeId, changes }: { recipeId: number; changes: RecipeIngredientChanges }) =>
      apiSend<{ updated: number; added: number[] }>('POST', `/recipes/${recipeId}/ingredients/changes`, changes),
    onSuccess: () => {
      for (const key of ['recipe-ingredients', 'meal-plan', 'food-cart']) {
        queryClient.invalidateQueries({ queryKey: [key] })
      }
    },
  })
}

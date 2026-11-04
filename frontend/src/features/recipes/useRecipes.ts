import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../../api/client'
import type { RecipeDetail, RecipeIngredient, RecipeListRow } from '../../api/types'

export interface RecipeFilters {
  search?: string
  ingredients?: string[]
  methods?: string[]
  tags?: string[]
}

export function useRecipes(filters: RecipeFilters) {
  return useQuery({
    queryKey: ['recipes', filters],
    queryFn: () => {
      const params = new URLSearchParams()
      if (filters.search) params.set('search', filters.search)
      for (const v of filters.ingredients ?? []) params.append('ingredients', v)
      for (const v of filters.methods ?? []) params.append('methods', v)
      for (const v of filters.tags ?? []) params.append('tags', v)
      const qs = params.toString()
      return apiGet<RecipeListRow[]>(`/recipes${qs ? `?${qs}` : ''}`)
    },
  })
}

export function useRecipe(recipeId: number | null) {
  return useQuery({
    queryKey: ['recipe', recipeId],
    queryFn: () => apiGet<RecipeDetail>(`/recipes/${recipeId}`),
    enabled: recipeId !== null,
  })
}

export function useRecipeTagValues(kind: 'ingredient' | 'method' | 'tag') {
  return useQuery({
    queryKey: ['recipe-tag-values', kind],
    queryFn: () => apiGet<string[]>(`/recipes/tags/${kind}`),
  })
}

export function useRecipeIngredients(recipeId: number | null) {
  return useQuery({
    queryKey: ['recipe-ingredients', recipeId],
    queryFn: () => apiGet<RecipeIngredient[]>(`/recipes/${recipeId}/ingredients`),
    enabled: recipeId !== null,
  })
}

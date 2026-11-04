import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../../api/client'
import type { FoodCartRow } from '../../api/types'

// The merged food shopping cart (the owner, 2026-09-17): baseline provisioning
// heuristic + meal-plan refinement, one list - see data.food_cart()'s
// docstring for the merge rule (MAX, not additive).
export function useFoodCart(crew: number, weeks: number, order: string, expiringDays = 14) {
  return useQuery({
    queryKey: ['food-cart', crew, weeks, order, expiringDays],
    queryFn: () => apiGet<FoodCartRow[]>(
      `/provisioning/food-cart?crew=${crew}&weeks=${weeks}&order=${order}&expiring_days=${expiringDays}`,
    ),
  })
}

export function useProvisioningPrefs() {
  return useQuery({
    queryKey: ['provisioning-prefs'],
    queryFn: () => apiGet<{ crew: number; weeks: number }>('/provisioning/prefs'),
  })
}

export function useAisleOrder() {
  return useQuery({
    queryKey: ['aisle-order'],
    queryFn: () => apiGet<string[]>('/provisioning/aisle-order'),
  })
}

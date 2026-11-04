/**
 * Purpose: Query/mutation hooks for the "we need more of this" request on items
 *   (schema v25 items.on_list_since): who is on the shopping list, and put an
 *   item on / take it off.
 * Version: v1 (2026-09-19)
 * Scope: PRODUCTION - mx-inv frontend, shared by recipes (pantry check), meal plan,
 *   and the Galley cart.
 * Architecture: Thin wrappers over GET /api/items/on-list and
 *   PUT /api/items/{id}/on-list; the food cart (GET /api/provisioning/food-cart)
 *   reads the same flag, so every change invalidates it. Receiving stock clears the
 *   flag server-side (data.add_stock), so no client call is needed for that.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiSend } from '../../api/client'

export interface OnListItem {
  item_id: number
  item_name: string
  item_type: string
  unit: string
  on_list_since: string
  quantity_onhand: number
}

export function useOnList() {
  return useQuery({ queryKey: ['on-list'], queryFn: () => apiGet<OnListItem[]>('/items/on-list') })
}

export function useSetOnList() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ itemId, onList }: { itemId: number; onList: boolean }) =>
      apiSend('PUT', `/items/${itemId}/on-list`, { on_list: onList }),
    onSuccess: () => {
      for (const key of ['on-list', 'food-cart', 'items', 'item', 'restock']) {
        queryClient.invalidateQueries({ queryKey: [key] })
      }
    },
  })
}

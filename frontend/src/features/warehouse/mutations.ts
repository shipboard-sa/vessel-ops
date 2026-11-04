import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiSend } from '../../api/client'
import type { ContainerType, FitStatus, ItemType, StockingPolicy } from '../../api/types'

function useWarehouseMutation<TVars>(fn: (vars: TVars) => Promise<unknown>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      // Broad invalidation - stock/item edits ripple into onhand totals,
      // the restock list, item-options pickers and open audits alike.
      for (const key of [
        'items', 'item', 'item-stock', 'item-options', 'restock', 'receive-targets',
        'compartments', 'locations', 'containers', 'container-options',
        'food-expiring', 'stock-expiring', 'food-cart', 'proteins',
        'audits', 'open-audit', 'audit-progress', 'audit-container', 'audit-unverified',
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] })
      }
    },
  })
}

// -- items ------------------------------------------------------------------

export interface NewItem {
  item_name: string
  item_type: ItemType
  unit?: string
  min_quantity?: number
  target_quantity?: number | null
  notes?: string
  details?: Record<string, unknown>
}

export function useCreateItem() {
  return useWarehouseMutation((body: NewItem) => apiSend('POST', '/items', body))
}

export interface ItemEditFields {
  item_name?: string
  item_type?: string
  unit?: string
  min_quantity?: number
  target_quantity?: number | null
  min_hold?: number | null
  annual_usage?: number | null
  stocking_policy?: StockingPolicy
  notes?: string | null
  details?: Record<string, unknown>
}

export function useUpdateItem() {
  return useWarehouseMutation(({ itemId, fields }: { itemId: number; fields: ItemEditFields }) =>
    apiSend('PATCH', `/items/${itemId}`, fields),
  )
}

// Put many items into one container in one all-or-nothing call (tracker #6).
export function useStowItems() {
  return useWarehouseMutation(
    (vars: { container_id: number; lines: { item_id: number; quantity: number }[] }) =>
      apiSend('POST', '/items/stow', vars) as Promise<{ added: number; merged: number }>,
  )
}

// Replace the whole set of systems/devices an item serves (v22).
export function useSetItemSystems() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ itemId, systems }: { itemId: number; systems: string[] }) =>
      apiSend('PUT', `/items/${itemId}/systems`, { systems }),
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ['item-systems', vars.itemId] })
      queryClient.invalidateQueries({ queryKey: ['systems'] })
      // the device screen's own Parts list (tracker #52, 2026-09-22 - was stale after a link/
      // unlink made from either side, this tab's ServesEditor or the device screen's Add Part)
      queryClient.invalidateQueries({ queryKey: ['system-items'] })
      // the Audit "no device" review list and the Restock Serves column both read these links
      queryClient.invalidateQueries({ queryKey: ['unlinked-parts'] })
      queryClient.invalidateQueries({ queryKey: ['restock'] })
    },
  })
}

// Replace the whole set of tools a tool_accessory belongs to (v29, many-to-many).
export function useSetAccessoryTools() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ itemId, toolItemIds }: { itemId: number; toolItemIds: number[] }) =>
      apiSend('PUT', `/items/${itemId}/tool-links`, { tool_item_ids: toolItemIds }),
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ['accessory-tools', vars.itemId] })
      queryClient.invalidateQueries({ queryKey: ['unlinked-tool-accessories'] })
    },
  })
}

// Record the nameplate check for a part / spare unit (v28); null status = back to unchecked.
export function useSetItemFit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ itemId, fit_status, note }: { itemId: number; fit_status: FitStatus | null; note?: string }) =>
      apiSend('PUT', `/items/${itemId}/fit`, { fit_status, note: note ?? null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fit-review'] })
      queryClient.invalidateQueries({ queryKey: ['restock'] }) // a wrong-model part never reorders
    },
  })
}

// Enter a device's make/model (the nameplate) from the fit-check screen - the same PATCH the
// Systems screen uses; the fit-check list is re-swept so the flags sharpen at once.
export function useSetDeviceModel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ name, make_model }: { name: string; make_model: string }) =>
      apiSend('PATCH', `/tasks/systems/${encodeURIComponent(name)}`, { make_model }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fit-review'] })
      queryClient.invalidateQueries({ queryKey: ['systems'] })
    },
  })
}

// Move all of a wrong-model item's stock to "To remove from boat > Trade or scrap".
export function useStageForRemoval() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (itemId: number) =>
      apiSend('POST', `/items/${itemId}/stage-for-removal`) as Promise<{ moved: number }>,
    onSuccess: () => {
      for (const key of ['fit-review', 'item-stock', 'items', 'item', 'containers', 'locations', 'compartments',
        'audit-container', 'audit-progress']) {
        queryClient.invalidateQueries({ queryKey: [key] })
      }
    },
  })
}

export function useDeleteItem() {
  return useWarehouseMutation((itemId: number) => apiSend('DELETE', `/items/${itemId}`))
}

// -- stock lots ---------------------------------------------------------

export interface NewStock {
  itemId: number
  container_id: number | null
  quantity: number
  expiry_date?: string | null
  lot_note?: string | null
  acquired_on?: string | null
  vendor?: string | null
  unit_cost?: number | null
  reason?: string
}

export function useAddStock() {
  return useWarehouseMutation(({ itemId, ...body }: NewStock) =>
    apiSend('POST', `/items/${itemId}/stock`, body),
  )
}

export interface ReceiveLine {
  container_id: number | null
  quantity: number
  expiry_date?: string | null
}

// Receive a purchase into one or several containers in one all-or-nothing call (#47).
export function useReceiveStock() {
  return useWarehouseMutation(
    ({ itemId, lines, acquired_on, older_expiry }: {
      itemId: number; lines: ReceiveLine[]; acquired_on?: string | null
      /** Dates the undated stock already aboard when a dated line is being added. */
      older_expiry?: string | null
    }) => apiSend('POST', `/items/${itemId}/receive`, { lines, acquired_on, older_expiry }),
  )
}

export interface StockEditFields {
  quantity?: number
  container_id?: number | null
  expiry_date?: string | null
  lot_note?: string | null
}

export function useUpdateStock() {
  return useWarehouseMutation(
    ({ stockId, fields }: { stockId: number; fields: StockEditFields }) =>
      apiSend('PATCH', `/items/stock/${stockId}`, { fields }),
  )
}

export function useDeleteStock() {
  return useWarehouseMutation((args: number | { stockId: number; reason?: string; note?: string }) => {
    const { stockId, reason, note } = typeof args === 'number' ? { stockId: args, reason: undefined, note: undefined } : args
    const params = new URLSearchParams()
    if (reason) params.set('reason', reason)
    if (note) params.set('note', note)
    const qs = params.toString()
    return apiSend('DELETE', `/items/stock/${stockId}${qs ? `?${qs}` : ''}`)
  })
}

// -- storage structure ---------------------------------------------------

export function useAddCompartment() {
  return useWarehouseMutation((name: string) => apiSend('POST', '/storage/compartments', { name }))
}

export function useRenameCompartment() {
  return useWarehouseMutation(
    ({ compartmentId, name }: { compartmentId: number; name: string }) =>
      apiSend('PATCH', `/storage/compartments/${compartmentId}`, { name }),
  )
}

export function useDeleteCompartment() {
  return useWarehouseMutation((compartmentId: number) =>
    apiSend('DELETE', `/storage/compartments/${compartmentId}`),
  )
}

export interface NewLocation {
  name: string
  compartment_id: number
}

export function useAddLocation() {
  return useWarehouseMutation((body: NewLocation) => apiSend('POST', '/storage/locations', body))
}

export function useDeleteLocation() {
  return useWarehouseMutation((locationId: number) =>
    apiSend('DELETE', `/storage/locations/${locationId}`),
  )
}

export interface LocationEditFields {
  location_name?: string
  compartment_id?: number
}

export function useUpdateLocation() {
  return useWarehouseMutation(
    ({ locationId, fields }: { locationId: number; fields: LocationEditFields }) =>
      apiSend('PATCH', `/storage/locations/${locationId}`, fields),
  )
}

export interface NewContainer {
  location_id: number
  name: string
  container_type: ContainerType
  notes?: string
}

export function useAddContainer() {
  return useWarehouseMutation((body: NewContainer) => apiSend('POST', '/storage/containers', body))
}

export interface ContainerEditFields {
  container_name?: string
  container_type?: ContainerType
  notes?: string | null
  favorite?: number
  /** Move the container (with all its stock rows) to another location. */
  location_id?: number
}

export function useUpdateContainer() {
  return useWarehouseMutation(
    ({ containerId, fields }: { containerId: number; fields: ContainerEditFields }) =>
      apiSend('PATCH', `/storage/containers/${containerId}`, fields),
  )
}

export function useDeleteContainer() {
  return useWarehouseMutation((containerId: number) =>
    apiSend('DELETE', `/storage/containers/${containerId}`),
  )
}

// -- audits ---------------------------------------------------------------

export interface NewAudit {
  name: string
  scope?: string
}

export function useCreateAudit() {
  return useWarehouseMutation((body: NewAudit) => apiSend('POST', '/audits', body))
}

export function useAbandonAudit() {
  return useWarehouseMutation((auditId: number) => apiSend('POST', `/audits/${auditId}/abandon`))
}

export interface RecordCount {
  auditId: number
  item_id: number
  container_id: number
  counted_qty: number
}

export function useRecordCount() {
  return useWarehouseMutation(({ auditId, ...body }: RecordCount) =>
    apiSend('POST', `/audits/${auditId}/count`, body),
  )
}

// Work a Container's tick: a lasting "verified here today" audit line in the open audit; stock untouched.
// verified=false takes a mis-tick back (only a pure verification, never a real count).
export interface VerifyHere {
  auditId: number
  item_id: number
  container_id: number
  verified: boolean
}

export function useVerifyInContainer() {
  return useWarehouseMutation(({ auditId, ...body }: VerifyHere) =>
    apiSend('POST', `/audits/${auditId}/verify`, body),
  )
}

// Work a Container's finish step: the un-ticked items' stock in this container moves to Unassigned.
export function useMoveToUnassigned() {
  return useWarehouseMutation((body: { container_id: number; item_ids: number[] }) =>
    apiSend('POST', '/items/move-to-unassigned', body),
  )
}

export interface CloseAudit {
  auditId: number
  absent_item_ids: number[]
  notes?: string
}

export function useCloseAudit() {
  return useWarehouseMutation(({ auditId, ...body }: CloseAudit) =>
    apiSend('POST', `/audits/${auditId}/close`, body),
  )
}

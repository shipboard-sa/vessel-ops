import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../../api/client'
import type {
  Audit,
  AuditContainerRow,
  AuditProgress,
  AuditUnverifiedRow,
  Compartment,
  Container,
  FoodExpiringRow,
  ItemDetail,
  ItemListRow,
  Protein,
  ItemType,
  ItemTypeInfo,
  Location,
  RestockRow,
  FitReviewRow,
  UnlinkedPart,
  UnlinkedToolAccessory,
  ToolAccessoryRow,
  StockingPolicyInfo,
  ReceiveInfo,
  StockLot,
} from '../../api/types'

// The systems/devices an item serves (v22 item_systems).
export function useItemSystems(itemId: number) {
  return useQuery({
    queryKey: ['item-systems', itemId],
    queryFn: () => apiGet<string[]>(`/items/${itemId}/systems`),
  })
}

export function useAccessoryTools(itemId: number) {
  return useQuery({
    queryKey: ['accessory-tools', itemId],
    queryFn: () => apiGet<number[]>(`/items/${itemId}/tool-links`),
  })
}

// The reverse: the accessories linked to a TOOL (tracker #76).
export function useToolAccessories(itemId: number) {
  return useQuery({
    queryKey: ['tool-accessories', itemId],
    queryFn: () => apiGet<ToolAccessoryRow[]>(`/items/${itemId}/accessories`),
  })
}

export function useItems(itemType?: ItemType | 'all', search?: string, containerId?: number | null) {
  const qType = itemType && itemType !== 'all' ? itemType : undefined
  return useQuery({
    queryKey: ['items', qType ?? 'all', search ?? '', containerId ?? ''],
    queryFn: () => {
      const params = new URLSearchParams()
      if (qType) params.set('item_type', qType)
      if (search) params.set('search', search)
      if (containerId != null) params.set('container_id', String(containerId))
      const qs = params.toString()
      return apiGet<ItemListRow[]>(`/items${qs ? `?${qs}` : ''}`)
    },
  })
}

export function useItem(itemId: number | null) {
  return useQuery({
    queryKey: ['item', itemId],
    queryFn: () => apiGet<ItemDetail>(`/items/${itemId}`),
    enabled: itemId !== null,
  })
}

export function useItemStock(itemId: number | null) {
  return useQuery({
    queryKey: ['item-stock', itemId],
    queryFn: () => apiGet<StockLot[]>(`/items/${itemId}/stock`),
    enabled: itemId !== null,
  })
}

/** Receive form data: places (homes first), suggested expiry, undated stock aboard. */
export function useReceiveInfo(itemId: number) {
  return useQuery({
    queryKey: ['receive-targets', itemId],
    queryFn: () => apiGet<ReceiveInfo>(`/items/${itemId}/receive-info`),
    staleTime: 0,
  })
}

export function useProteins() {
  return useQuery({ queryKey: ['proteins'], queryFn: () => apiGet<Protein[]>('/items/proteins') })
}

export function useUnlinkedParts() {
  return useQuery({
    queryKey: ['unlinked-parts'],
    queryFn: () => apiGet<UnlinkedPart[]>('/items/unlinked-parts'),
  })
}

export function useUnlinkedToolAccessories() {
  return useQuery({
    queryKey: ['unlinked-tool-accessories'],
    queryFn: () => apiGet<UnlinkedToolAccessory[]>('/items/unlinked-tool-accessories'),
  })
}

export function useFitReview() {
  return useQuery({
    queryKey: ['fit-review'],
    queryFn: () => apiGet<FitReviewRow[]>('/items/fit-review'),
  })
}

export function useRestockList() {
  return useQuery({
    queryKey: ['restock'],
    queryFn: () => apiGet<RestockRow[]>('/items/below-minimum'),
  })
}

export function useCompartments() {
  return useQuery({
    queryKey: ['compartments'],
    queryFn: () => apiGet<Compartment[]>('/storage/compartments'),
  })
}

export function useLocations() {
  return useQuery({
    queryKey: ['locations'],
    queryFn: () => apiGet<Location[]>('/storage/locations'),
  })
}

export function useContainers() {
  return useQuery({
    queryKey: ['containers'],
    queryFn: () => apiGet<Container[]>('/storage/containers'),
  })
}

export function useStockExpiring(days: number, itemType?: string, excludeItemType?: string) {
  return useQuery({
    queryKey: ['stock-expiring', days, itemType ?? '', excludeItemType ?? ''],
    queryFn: () => {
      const params = new URLSearchParams({ days: String(days) })
      if (itemType) params.set('item_type', itemType)
      if (excludeItemType) params.set('exclude_item_type', excludeItemType)
      return apiGet<FoodExpiringRow[]>(`/items/stock-expiring?${params.toString()}`)
    },
  })
}

export function useItemTypes() {
  return useQuery({
    queryKey: ['item-types'],
    queryFn: () => apiGet<ItemTypeInfo[]>('/items/types'),
    staleTime: Infinity, // a lookup table, not per-session data
  })
}

export function useStockingPolicies() {
  return useQuery({
    queryKey: ['stocking-policies'],
    queryFn: () => apiGet<StockingPolicyInfo[]>('/items/policies'),
    staleTime: Infinity,
  })
}

export function useItemOptions() {
  return useQuery({
    queryKey: ['item-options'],
    queryFn: () => apiGet<Record<string, number>>('/items/options'),
  })
}

export function useAudits() {
  return useQuery({
    queryKey: ['audits'],
    queryFn: () => apiGet<Audit[]>('/audits'),
  })
}

export function useOpenAudit() {
  return useQuery({
    queryKey: ['open-audit'],
    queryFn: () => apiGet<Audit | null>('/audits/open'),
  })
}

export function useAuditProgress(auditId: number | null) {
  return useQuery({
    queryKey: ['audit-progress', auditId],
    queryFn: () => apiGet<AuditProgress>(`/audits/${auditId}/progress`),
    enabled: auditId !== null,
  })
}

export function useAuditContainerView(auditId: number | null, containerId: number | null) {
  return useQuery({
    queryKey: ['audit-container', auditId, containerId],
    queryFn: () => apiGet<AuditContainerRow[]>(`/audits/${auditId}/containers/${containerId}`),
    enabled: auditId !== null && containerId !== null,
  })
}

export function useAuditUnverified(auditId: number | null) {
  return useQuery({
    queryKey: ['audit-unverified', auditId],
    queryFn: () => apiGet<AuditUnverifiedRow[]>(`/audits/${auditId}/unverified`),
    enabled: auditId !== null,
  })
}

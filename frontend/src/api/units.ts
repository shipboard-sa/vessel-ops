/**
 * Purpose: react-query hooks + helpers for the governed `units` lookup table
 *   (the one list of valid unit keys for items and recipe ingredients).
 * Version: v1 (2026-09-18)
 * Scope: PRODUCTION - mx-inv frontend, shared by warehouse and recipes.
 * Architecture: Data layer only. GET/POST /api/units (backend units router).
 *   Consumed by components/UnitPicker.tsx (every place a unit is entered) and
 *   features/recipes/CookFlow.tsx (unit-mismatch warning). Lookup table, so
 *   cached with staleTime Infinity like item types / stocking policies;
 *   creating a unit invalidates ['units'].
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiSend } from './client'
import type { UnitDimension, UnitRow } from './types'

export function useUnits() {
  return useQuery({
    queryKey: ['units'],
    queryFn: () => apiGet<UnitRow[]>('/units'),
    staleTime: Infinity, // a lookup table, not per-session data
  })
}

export interface NewUnit {
  unit_key: string
  label?: string
  dimension?: UnitDimension
  description?: string
}

export function useCreateUnit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (unit: NewUnit) => apiSend<UnitRow>('POST', '/units', unit),
    // Returned promise is awaited, so callers of mutateAsync see the refreshed list.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['units'] }),
  })
}

/** Display order of the dimension groups. */
export const UNIT_DIMENSIONS: UnitDimension[] = ['count', 'volume', 'mass', 'length', 'other']

export const DIMENSION_LABELS: Record<UnitDimension, string> = {
  count: 'Count',
  volume: 'Volume',
  mass: 'Mass',
  length: 'Length',
  other: 'Other',
}

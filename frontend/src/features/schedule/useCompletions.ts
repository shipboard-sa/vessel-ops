/**
 * Purpose: Data hooks for the Log tab (maintenance history) - the entries and the filter choices.
 * Version: v2 (2026-09-21) - v2 adds year / system / device filters and the facets query.
 * Scope: PRODUCTION - mx-inv frontend, schedule feature.
 * Architecture: Used by CompletionLog. Reads GET /api/tasks/completions (data.list_completions) and
 *   GET /api/tasks/completions/facets (data.completion_facets), schema v26 task_completions.
 */
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../../api/client'
import type { CompletionEntry, CompletionFacets } from '../../api/types'

/** What the Log shows: a recent window (by when recorded), one YEAR (by date logged), or ALL time. */
export interface CompletionFilter {
  /** 'days' = last N days recorded; 'year' = date logged in that year; 'all' = no time bound. */
  period: { kind: 'days'; days: number } | { kind: 'year'; year: number } | { kind: 'all' }
  system: string | null
  device: string | null
}

// The completion audit trail (schema v26), newest first.
export function useCompletions(filter: CompletionFilter) {
  const p = new URLSearchParams({ limit: '1000' })
  if (filter.period.kind === 'days') p.set('days', String(filter.period.days))
  else if (filter.period.kind === 'year') p.set('year', String(filter.period.year))
  else p.set('days', '0')
  if (filter.system) p.set('system', filter.system)
  if (filter.device) p.set('device', filter.device)
  return useQuery({
    queryKey: ['completions', filter],
    queryFn: () => apiGet<CompletionEntry[]>(`/tasks/completions?${p.toString()}`),
  })
}

export function useCompletionFacets() {
  return useQuery({
    queryKey: ['completions', 'facets'],
    queryFn: () => apiGet<CompletionFacets>('/tasks/completions/facets'),
  })
}

/**
 * Purpose: Data hooks for the desktop Ship's Log tab - list (with filters), one entry whole, add a crew entry,
 *   append a failure status update - plus the shared labels for kinds and the owner's statuses.
 * Version: v3 (2026-10-05) - v3 (the owner's review): useWatchkeeper, useStatusChanges (each on its own day),
 *   useLogEngine / usePropulsion, SOURCE_LABEL, windText; rules-engine entries are 'Automation' (Engine = the
 *   Yanmar), departures 🚩 (⛵ = sail plan). v2 (2026-10-05) - v2: passages (schema v38) - usePassages / useCurrentPassage / usePorts /
 *   useLogPassageEnd, shared by the desktop Passages view and the cockpit Depart / Arrive tile. v1 (2026-10-05)
 * Scope: PRODUCTION - mx-inv frontend, logbook feature.
 * Architecture: react-query over backend/routers/logbook.py (GET /api/logbook, GET /api/logbook/{id},
 *   POST /api/logbook, POST /api/logbook/{id}/status). Every write invalidates ['logbook'] and the cockpit's
 *   ['cockpit-this-watch'], so the handover screen sees a desktop entry too.
 * Invocation: imported by features/logbook/LogbookView.tsx + PassagesView.tsx and cockpit/PassageForm.tsx.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiSend } from '../../api/client'
import type { LogEntry, LogEntryBody, LogStatusChange, NotificationEntry, Passage, PassageEndBody, Propulsion, Watchkeeper } from '../../api/types'

export type LogKind = LogEntry['kind']

export const KIND_LABEL: Record<LogKind, string> = {
  failure: '🔧 Failure', observation: '👁 Observation', incident: '⚠️ Incident', watch: '🕑 Watch',
  event: '🔔 Automation', status: '⚓ Deck log', departure: '🚩 Departure', arrival: '🏁 Arrival',
  sail: '⛵ Sail plan', engine: '⚙️ Engine',
}

/** Where an entry came from, in words (the owner 10-05: 'auto' = Auto Report). */
export const SOURCE_LABEL: Record<string, string> = {
  auto: 'Auto Report', cockpit: 'Cockpit', desktop: 'Desktop', engine: 'Automation', import: 'Import',
}

/** '14 kn / 41° port' (the owner 10-05) - speed, then angle; either may be missing. */
export function windText(kn: number | null | undefined, deg: number | null | undefined): string | null {
  const a = deg == null ? null : `${Math.abs(Math.round(deg))}° ${deg < 0 ? 'port' : 'stbd'}`
  if (kn == null) return a
  return a ? `${kn} kn / ${a}` : `${kn} kn`
}

/** the owner 2026-10-05: Broke / Parts Ordered / Deferred / Accepted / Fixed (any may follow any). */
export const STATUSES: [string, string][] = [
  ['broke', 'Broke'], ['parts-ordered', 'Parts Ordered'], ['deferred', 'Deferred'],
  ['accepted', 'Accepted'], ['fixed', 'Fixed'],
]
export const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUSES)
export const CLOSED = new Set(['fixed', 'accepted'])

export interface LogFilter {
  kind?: string
  system?: string
  since?: string
  until?: string
  simulated?: boolean
  open?: boolean
  limit?: number
}

export function useLogEntries(f: LogFilter) {
  const q = new URLSearchParams()
  if (f.kind) q.set('kind', f.kind)
  if (f.system) q.set('system', f.system)
  if (f.since) q.set('since', f.since)
  if (f.until) q.set('until', f.until)
  if (f.open) q.set('open', 'true')
  q.set('simulated', String(f.simulated ?? false))
  q.set('limit', String(f.limit ?? 2000))
  const qs = q.toString()
  return useQuery({
    queryKey: ['logbook', 'list', qs],
    queryFn: () => apiGet<LogEntry[]>(`/logbook?${qs}`),
    refetchInterval: 60_000,        // the engine and the deck log write on their own
  })
}

export function useLogEntryDetail(id: number | null) {
  return useQuery({
    queryKey: ['logbook', 'entry', id],
    queryFn: () => apiGet<LogEntry>(`/logbook/${id}`),
    enabled: id !== null,
  })
}

function useInvalidate() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['logbook'] })
    qc.invalidateQueries({ queryKey: ['cockpit-this-watch'] })
    qc.invalidateQueries({ queryKey: ['passages'] })
    qc.invalidateQueries({ queryKey: ['cockpit-sail-plan'] })
  }
}

export function useAddLogEntry() {
  const done = useInvalidate()
  return useMutation({
    mutationFn: (body: LogEntryBody) => apiSend<LogEntry>('POST', '/logbook', body),
    onSuccess: done,
  })
}

export function useAddLogStatus(id: number) {
  const done = useInvalidate()
  return useMutation({
    mutationFn: (body: { status: string; note?: string | null; author?: string | null }) =>
      apiSend<LogEntry>('POST', `/logbook/${id}/status`, body),
    onSuccess: done,
  })
}

// --- passages (schema v38): one leg = a departure to the next arrival ---------------------------------------------

export function usePassages() {
  return useQuery({ queryKey: ['passages', 'list'], queryFn: () => apiGet<Passage[]>('/logbook/passages'),
                    refetchInterval: 60_000 })
}

/** The leg under way now, or null. */
export function useCurrentPassage() {
  return useQuery({
    queryKey: ['passages', 'current'],
    queryFn: () => apiGet<{ passage: Passage | null }>('/logbook/passages/current').then((r) => r.passage),
    refetchInterval: 60_000,
  })
}

/** Ports named so far, most recent first - the pick list. */
export function usePorts() {
  return useQuery({ queryKey: ['passages', 'ports'], queryFn: () => apiGet<string[]>('/logbook/ports') })
}

export function useLogPassageEnd(kind: 'departure' | 'arrival') {
  const done = useInvalidate()
  return useMutation({
    mutationFn: (body: PassageEndBody) => apiSend<LogEntry>('POST', `/logbook/${kind}`, body),
    onSuccess: done,
  })
}

/** "1 d 3 h 20 min" */
export function hoursText(h: number): string {
  const m = Math.round(h * 60)
  const d = Math.floor(m / 1440)
  return `${d ? `${d} d ` : ''}${Math.floor((m % 1440) / 60)} h ${String(m % 60).padStart(2, '0')} min`
}

// --- Ship's Log review (v39) ---------------------------------------------------------------------------------------

/** Who has the watch (null alongside / at anchor) + the names an entry can be signed with. */
export function useWatchkeeper() {
  return useQuery({ queryKey: ['passages', 'watchkeeper'], queryFn: () => apiGet<Watchkeeper>('/logbook/watchkeeper'),
                    refetchInterval: 60_000 })
}

/** Failure status changes that happened in [since, until) - shown on their own day. */
export function useStatusChanges(since: string, until: string) {
  return useQuery({
    queryKey: ['logbook', 'status-changes', since, until],
    queryFn: () => apiGet<LogStatusChange[]>(`/logbook/status-changes?since=${since}&until=${until}`),
    refetchInterval: 60_000,
  })
}

/** The sail set and engine state as logged by hand. */
export function usePropulsion() {
  return useQuery({ queryKey: ['passages', 'propulsion'], queryFn: () => apiGet<Propulsion>('/logbook/propulsion') })
}

// --- WF-807: notification journal ---------------------------------------------------------------------------------

export interface NotificationFilter {
  severity?: string
  since?: string
  until?: string
  simulated?: boolean
  q?: string
  limit?: number
}

export function useNotifications(f: NotificationFilter) {
  const q = new URLSearchParams()
  if (f.severity) q.set('severity', f.severity)
  if (f.since) q.set('since', f.since)
  if (f.until) q.set('until', f.until)
  q.set('simulated', String(f.simulated ?? false))
  if (f.q) q.set('q', f.q)
  q.set('limit', String(f.limit ?? 500))
  const qs = q.toString()
  return useQuery({
    queryKey: ['logbook', 'notifications', qs],
    queryFn: () => apiGet<NotificationEntry[]>(`/logbook/notifications?${qs}`),
    refetchInterval: 60_000,
  })
}

export function useLogEngine() {
  const done = useInvalidate()
  return useMutation({
    mutationFn: (body: { on: boolean; author?: string | null; source: 'cockpit' | 'desktop'; minutes_ago: number;
                         hours?: number | null }) =>
      apiSend<LogEntry>('POST', '/logbook/engine', body),
    onSuccess: done,
  })
}

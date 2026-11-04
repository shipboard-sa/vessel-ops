/**
 * Purpose: React Query hooks for the /cockpit tablet UI - capabilities, the connection
 *   heartbeat, the checklist list, the watch-handover weather, the two brokered writes, and the
 *   boat automation link (status + alarms every 5 s, the boat-mode tap, alarm ack, tank-fill sessions).
 * Version: v9 (2026-10-18) - v9: useRestock / useRestockAnswer (GET / POST /cockpit/restock - the cold boxes'
 *   EXPECTED? question, Ship's Automation WF-502 / D-128). v8 (2026-10-09) - v8: useFill / useFillTap (GET / POST /cockpit/fill - the rules engine's tank-fill
 *   sessions, Ship's Automation D-129); getWithDetail shared by the boat + fill polls. v7 (2026-10-05) - v7: the watch entry takes on_watch (who takes the watch); saving a sail plan refreshes
 *   the log and the logged propulsion. v6 (2026-10-05) - v6: logbook hooks (useLogEntry, useThisWatch, useLogWatch) replace
 *   useIncidentReport. v5 (2026-10-05) - v5: useSailPlanNow / useSailPlanSet (SignalK sails.activeSet) replace the
 *   never-built sail-config webhook. v4 (2026-10-05) - v4: useHandoverCard (GET /cockpit/watch-handover/boat every 30 s).
 *   v3 (2026-10-05) - v3: useBoatStatus / useBoatMode / useBoatAck (GET /cockpit/boat,
 *   POST /cockpit/mode, POST /cockpit/ack -> the rules engine via backend/boat_link.py).
 *   v2 (2026-10-04) - v2 (cockpit production pass): useCockpitPing (15 s heartbeat that
 *   drives the "no contact since" banner), useCockpitChecklists (GET /tasks/checklists, ~20 KB,
 *   instead of the ~870 KB /tasks the picker used to pull), the weather refreshes every 10 min,
 *   and capabilities are retried instead of hiding tiles forever after one failed load.
 *   v1 (2026-09-17).
 * Scope: PRODUCTION - mx-inv frontend, cockpit feature.
 * Architecture: Thin wrappers over api/client.ts; endpoints in backend/routers/cockpit.py and
 *   backend/routers/tasks.py. Retry / backoff defaults for the cockpit come from main.tsx.
 * Invocation: imported by the cockpit screens (CockpitApp, BoatStrip, TanksScreen, WatchHandover, ...).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiGet, apiSend } from '../../api/client'
import type {
  ChecklistSummary, LogEntry, LogEntryBody, SailPlanNow, SailPlanTapBody, ThisWatch, WatchHandoverWx,
} from '../../api/types'

export interface CockpitCapabilities {
  sail_plan: boolean; incident: boolean; weather: boolean
  /** v39: SignalK sails.activeSet can be updated too (else the change is logged only) */
  sail_plan_signalk?: boolean
  /** The rules engine is configured (status + alarms shown). */
  boat?: boolean
  /** ...and this server holds its token (mode tap + ack allowed). */
  boat_write?: boolean
  /** SignalK is configured - the live handover card is shown. */
  handover_live?: boolean
  /** v9: the engine is configured - the Tanks tile (taps also need boat_write). */
  fill?: boolean
  /** v11: the engine is configured - the cold boxes' EXPECTED? question (answers also need boat_write). */
  restock?: boolean
}

export interface TankLine { gal: number | null; capacity_gal: number | null; pct: number | null; used_gal: number | null }

/** GET /cockpit/watch-handover/boat - backend/handover_card.py. Every field may be null (not known / stale). */
export interface HandoverCard {
  generated_at: string
  watch_hours: number
  position: { lat: number; lon: number } | null
  sog_kn: number | null
  cog_deg: number | null
  stw_kn: number | null
  depth_ft: number | null
  wind_apparent_kn: number | null
  wind_apparent_deg: number | null
  air_f: number | null
  sea_f: number | null
  baro_hpa: number | null
  baro_3h_change_hpa: number | null
  distance_this_watch_nm: number | null
  fuel: TankLine | null
  water: TankLine | null
  house_v: number | null
  house_a: number | null
  /** The Ship's Automation weather service (each part absent when stale / not published). */
  outside?: {
    obs?: { station: string | null; nm: number | null; age_min: number | null; wind_kn: number; gust_kn: number | null
            wind_from_deg: number | null; pressure_hpa: number | null }
    waves?: { station: string | null; nm: number | null; age_min: number | null; height_ft: number
              period_s: number | null; from_deg: number | null }
    forecast?: { wind_kn: number; wind_max_kn: number | null; gust_max_kn: number | null; wave_max_ft: number | null }
  }
}

export type BoatMode = 'DOCK' | 'ANCHOR' | 'AWAY' | 'MOTOR' | 'SAIL'

export interface BoatAlarm {
  rule: string; severity: string; message: string; acked: boolean; simulated: boolean
}

export interface BoatStatus {
  mode: BoatMode | null
  /** The mode someone tapped (null = never tapped - inferred only). */
  mode_manual: BoatMode | null
  alarms: BoatAlarm[]
  healthy: boolean | null
  health_reasons: string[]
  role: string | null
  test_active: boolean
  can_write: boolean
}

export type FillTankKey = 'fuel_port' | 'fuel_stbd' | 'water_port' | 'water_stbd'

/** A fill session in the rules engine (Ship's Automation D-129). `active` = the engine chirps 90 / 95 % for it: a
 *  crew tap is active at once; a watermaker session only once its string's level is seen rising. */
export interface FillSession { source: 'tap' | 'watermaker'; since: string; by: string; active: boolean }

export interface FillTank { tank: FillTankKey; label: string; level: number | null; session: FillSession | null }

/** GET /cockpit/fill - fuel first, then water (backend/routers/cockpit.py FILL_TANKS). */
export interface FillView {
  tanks: FillTank[]
  watermaker: { running: boolean; watts: number | null }
  can_write: boolean
}

export type RestockBoxKey = 'fridge' | 'engel' | 'fz_aft' | 'fz_fwd'

/** A cold box's mark in the rules engine (WF-502): `hold` = restocked / YES - its alarm waits until `until`;
 *  `denied` = NO - its alarm fires over the limit at once. */
export interface RestockMark { kind: 'hold' | 'denied'; since: string; until: string; by: string; source: string }

export interface RestockBox { box: RestockBoxKey; label: string; asking: boolean; alarm: boolean; mark: RestockMark | null }

/** GET /cockpit/restock (backend/routers/cockpit.py RESTOCK_BOXES). */
export interface RestockView { boxes: RestockBox[]; hold_h: number | null; can_write: boolean }

/** GET that keeps the server's plain-words `detail` ("the rules engine is not answering") on failure, for the
 *  tablet, instead of a bare status code. */
async function getWithDetail<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`)
  if (!res.ok) {
    const text = await res.text()
    let detail: unknown
    try { detail = JSON.parse(text).detail } catch { /* not JSON */ }
    throw new ApiError(`GET ${path} failed: ${res.status} ${text}`, res.status, detail)
  }
  return res.json() as Promise<T>
}

export function useCockpitCapabilities() {
  return useQuery({
    queryKey: ['cockpit-capabilities'],
    queryFn: () => apiGet<CockpitCapabilities>('/cockpit/capabilities'),
    staleTime: 10 * 60_000, // server configuration, not usage - but re-read after a restart
  })
}

/** Heartbeat: success = the boat server answered within the last poll. */
export function useCockpitPing() {
  return useQuery({
    queryKey: ['cockpit-ping'],
    queryFn: () => apiGet<{ ok: boolean; server_time: string }>('/cockpit/ping'),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    retry: 1,
    staleTime: 0,
  })
}

export function useCockpitChecklists() {
  return useQuery({
    queryKey: ['cockpit-checklists'],
    queryFn: async () => {
      const rows = await apiGet<ChecklistSummary[]>('/tasks/checklists')
      return rows
        .filter((c) => !c.retired_at) // retired = out of the pick lists (schema v30)
        .sort((a, b) => a.task_name.localeCompare(b.task_name))
    },
  })
}

export function useWatchHandoverWx(enabled: boolean) {
  return useQuery({
    queryKey: ['cockpit-watch-handover-wx'],
    queryFn: () => apiGet<WatchHandoverWx>('/cockpit/watch-handover/wx'),
    enabled,
    refetchInterval: 10 * 60_000,
  })
}

export function useSailPlanNow() {
  return useQuery({
    queryKey: ['cockpit-sail-plan'],
    queryFn: () => apiGet<SailPlanNow>('/cockpit/sail-plan'),
  })
}

export function useSailPlanSet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: SailPlanTapBody) => apiSend<SailPlanNow>('POST', '/cockpit/sail-plan', body),
    onSuccess: (data) => {
      qc.setQueryData(['cockpit-sail-plan'], data)
      qc.invalidateQueries({ queryKey: ['logbook'] })
      qc.invalidateQueries({ queryKey: ['passages'] })
      qc.invalidateQueries({ queryKey: ['cockpit-this-watch'] })
    },
  })
}

export function useLogEntry() {
  return useMutation({
    mutationFn: (body: LogEntryBody) => apiSend<LogEntry>('POST', '/logbook', body),
  })
}

/** Engine events + crew entries since the last watch entry (the 'this watch' list at handover). */
export function useThisWatch() {
  return useQuery({
    queryKey: ['cockpit-this-watch'],
    queryFn: () => apiGet<ThisWatch>('/logbook/this-watch'),
    refetchInterval: 60_000,
  })
}

export function useLogWatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { notables: string | null; author?: string | null; on_watch?: string | null }) =>
      apiSend<LogEntry>('POST', '/logbook/watch', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cockpit-this-watch'] })
      qc.invalidateQueries({ queryKey: ['passages'] })
      qc.invalidateQueries({ queryKey: ['logbook'] })
    },
  })
}

/** Boat mode + alarms from the rules engine, every 5 s while the tablet is awake. */
export function useBoatStatus(enabled: boolean) {
  return useQuery({
    queryKey: ['cockpit-boat'],
    queryFn: () => getWithDetail<BoatStatus>('/cockpit/boat'),
    enabled,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    // No retry: the 5 s poll IS the retry. With retries a dead engine (2 s connect timeout + backoff)
    // never finished failing before the next poll started, so the "not answering" line never showed.
    retry: 0,
    staleTime: 0,
  })
}

export function useBoatMode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (mode: BoatMode) => apiSend('POST', '/cockpit/mode', { mode }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['cockpit-boat'] }),
  })
}

export function useBoatAck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiSend('POST', '/cockpit/ack'),
    onSettled: () => qc.invalidateQueries({ queryKey: ['cockpit-boat'] }),
  })
}

export function useHandoverCard(enabled: boolean) {
  return useQuery({
    queryKey: ['cockpit-handover-card'],
    queryFn: () => apiGet<HandoverCard>('/cockpit/watch-handover/boat'),
    enabled,
    refetchInterval: 30_000,
    retry: 1,
  })
}

/** The four tanks + fill sessions. `everyMs`: 10 s on the Tanks screen (a fill moves a few % a minute), slower for
 *  the home tile's 'Filling: ...' line. Like the boat poll, the poll is the retry. */
export function useFill(enabled: boolean, everyMs: number) {
  return useQuery({
    queryKey: ['cockpit-fill'],
    queryFn: () => getWithDetail<FillView>('/cockpit/fill'),
    enabled,
    refetchInterval: everyMs,
    refetchIntervalInBackground: false,
    retry: 0,
    staleTime: 0,
  })
}

/** 'Filling' (on) / 'Stop' (off) for one tank; the answer is the new view. */
export function useFillTap() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { tank: FillTankKey; on: boolean }) => apiSend<FillView>('POST', '/cockpit/fill', body),
    onSuccess: (view) => qc.setQueryData(['cockpit-fill'], view),
    onSettled: () => qc.invalidateQueries({ queryKey: ['cockpit-fill'] }),
  })
}

/** The cold boxes' EXPECTED? question, every 10 s (the question waits 20 min for an answer before the alarm). */
export function useRestock(enabled: boolean) {
  return useQuery({
    queryKey: ['cockpit-restock'],
    queryFn: () => getWithDetail<RestockView>('/cockpit/restock'),
    enabled,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    retry: 0,
    staleTime: 0,
  })
}

/** YES (warm food went in on purpose - 2 h to cool down) / NO (not expected - the alarm now). */
export function useRestockAnswer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { box: RestockBoxKey; answer: 'yes' | 'no' }) =>
      apiSend<RestockView>('POST', '/cockpit/restock', body),
    onSuccess: (view) => qc.setQueryData(['cockpit-restock'], view),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['cockpit-restock'] })
      qc.invalidateQueries({ queryKey: ['cockpit-boat'] })
    },
  })
}

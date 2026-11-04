/**
 * Purpose: Turn a completion's days/hours-past-due numbers into the short label shown
 *   in the completion toast and the Log tab ("15 d late", "on time", "2 d early", "30 h
 *   past due").
 * Version: v1 (2026-09-19)
 * Scope: PRODUCTION - mx-inv frontend, schedule feature.
 * Architecture: Pure formatter, no state. Numbers come from the backend
 *   (data._completion_timing, stored on task_completions and echoed by POST
 *   /api/tasks/{id}/complete); the UI never recomputes due-date math.
 */

export type LatenessTone = 'late' | 'early' | 'ontime'

export interface Lateness {
  text: string
  tone: LatenessTone
}

/** null when there was no schedule to be late against (first recorded completion,
 *  break/fix, as-used tasks). Run-hour tasks report hours; everything else days. */
export function lateness(
  daysPastDue: number | null | undefined,
  hoursPastDue: number | null | undefined,
): Lateness | null {
  if (hoursPastDue !== null && hoursPastDue !== undefined) {
    if (hoursPastDue > 0) return { text: `${hoursPastDue} h past due`, tone: 'late' }
    if (hoursPastDue < 0) return { text: `${Math.abs(hoursPastDue)} h early`, tone: 'early' }
    return { text: 'on time', tone: 'ontime' }
  }
  if (daysPastDue === null || daysPastDue === undefined) return null
  if (daysPastDue > 0) return { text: `${daysPastDue} d late`, tone: 'late' }
  if (daysPastDue < 0) return { text: `${Math.abs(daysPastDue)} d early`, tone: 'early' }
  return { text: 'on time', tone: 'ontime' }
}

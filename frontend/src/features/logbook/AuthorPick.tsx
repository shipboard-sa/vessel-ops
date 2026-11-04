/**
 * Purpose: "Signed by" - who a log entry is from (the owner 2026-10-05: set at the handover, override via the pick list).
 *   Defaults to whoever has the watch while a leg is under way; alongside / at anchor, to the last name used on THIS
 *   device. One component, two looks: big tap buttons on the cockpit, a select on the desktop.
 * Version: v1 (2026-10-05)
 * Scope: PRODUCTION - mx-inv frontend, logbook feature (shared with the cockpit).
 * Architecture: useWatchkeeper (GET /api/logbook/watchkeeper: the watchkeeper + the crew list). The server checks
 *   the name against the crew list (400 otherwise), so this is the only place a name is chosen - never typed.
 *   The last-used name is a per-device convenience in localStorage (wrapped: a blocked store just means no default).
 * Invocation: imported by the cockpit forms (IncidentForm, PassageForm, ThisWatch, SailPlanForm) and the desktop
 *   Ship's Log forms (LogbookView, PassagesView).
 */
import { useEffect, useState } from 'react'
import { useWatchkeeper } from './useLogbook'

const KEY = 'mxinv.logbook.lastAuthor'

function remembered(): string {
  try { return localStorage.getItem(KEY) ?? '' } catch { return '' }
}

/** Call after a successful save so the next form on this device starts from the same name. */
export function rememberAuthor(name: string | null | undefined) {
  if (!name) return
  try { localStorage.setItem(KEY, name) } catch { /* private window / blocked storage: no default next time */ }
}

/** [name, setName, crew, onWatch]: the default is the watchkeeper, else this device's last name, else ''. */
export function useAuthor(): [string, (n: string) => void, string[], string | null] {
  const { data } = useWatchkeeper()
  const onWatch = data?.watchkeeper?.on_watch ?? null
  const crew = data?.crew ?? []
  const [name, setName] = useState('')
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (touched || !data) return
    const last = remembered()
    setName(onWatch ?? (crew.includes(last) ? last : ''))
  }, [data, onWatch, touched]) // eslint-disable-line react-hooks/exhaustive-deps
  return [name, (n: string) => { setTouched(true); setName(n) }, crew, onWatch]
}

export function AuthorPick({ label = 'Signed by', value, onChange, crew, onWatch, variant }: {
  label?: string; value: string; onChange: (n: string) => void; crew: string[]; onWatch?: string | null
  variant: 'cockpit' | 'desktop'
}) {
  const hint = onWatch ? (value === onWatch ? ' (on watch)' : ` - ${onWatch} has the watch`) : ''
  if (variant === 'desktop') {
    return (
      <label>{label}{' '}
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Pick…</option>
          {crew.map((c) => <option key={c} value={c}>{c}{c === onWatch ? ' (on watch)' : ''}</option>)}
        </select>
      </label>
    )
  }
  return (
    <div className="cockpit-pick">
      <div className="cockpit-pick-label">{label}<span className="cockpit-wx-meta">{hint}</span></div>
      <div className="cockpit-mode-buttons" role="group" aria-label={label}>
        {crew.map((c) => (
          <button key={c} type="button" aria-pressed={value === c} className={value === c ? 'active' : undefined}
            onClick={() => onChange(c)}>{c}</button>
        ))}
      </div>
    </div>
  )
}

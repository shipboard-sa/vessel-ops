/**
 * Purpose: "This watch" on the Watch Handover screen - the engine's alarms / events and the crew's log entries since
 *   the last watch entry (closes the N-39 "alarms this watch" gap), plus the "Log this watch" button that writes the
 *   watch entry (the owner's Watch Log, 2026-09-11): handover card snapshot + this list + the crew's notables.
 * Version: v3 (2026-10-05) - v3: Handed over by / Taking the watch (the owner's review - the watchkeeper signs
 *   every entry until the next handover). v2 (2026-10-05) - v2: a CHANGE report (the owner): also status changes on older failures
 *   ("LOG-00012 Watermaker: deferred -> fixed"); the standing Deferred / Accepted register is not repeated here.
 *   v1 (2026-10-05)
 * Scope: PRODUCTION - mx-inv frontend, cockpit feature.
 * Architecture: useThisWatch (GET /api/logbook/this-watch) + useLogWatch (POST /api/logbook/watch) -
 *   backend/routers/logbook.py. A separate button, not automatic on Finish (logbook design question 3 - default
 *   until the owner answers).
 */
import { useState } from 'react'
import { friendlyError } from './CockpitBits'
import { useLogWatch, useThisWatch } from './useCockpit'
import { AuthorPick, rememberAuthor, useAuthor } from '../logbook/AuthorPick'

const hhmm = (iso: string) => iso.slice(11, 16)

export function ThisWatch() {
  const q = useThisWatch()
  const log = useLogWatch()
  const [notables, setNotables] = useState('')
  const [author, setAuthor, crew, onWatch] = useAuthor()      // who hands over (default: whoever has the watch)
  const [taking, setTaking] = useState('')                   // who takes it (the owner 10-05)
  const [done, setDone] = useState<string | null>(null)
  const rows = q.data?.entries ?? []
  const changes = q.data?.status_changes ?? []

  return (
    <div className="cockpit-wx-summary cockpit-handover-card">
      <h3>📓 This watch{q.data && <span className="cockpit-wx-meta"> - since {q.data.since_last_watch_entry
        ? `the last watch entry (${hhmm(q.data.since)})` : `${hhmm(q.data.since)} (last 6 h)`}</span>}</h3>
      {q.isError && !q.data && <p className="cockpit-status cockpit-status--error">Could not read the log - {friendlyError(q.error)}</p>}
      {q.data && rows.length === 0 && changes.length === 0 && (
        <p className="cockpit-status">No change - no alarms, no new entries, no status changes.</p>
      )}
      {rows.length > 0 && (
        <ul className="cockpit-this-watch">
          {rows.map((r) => (
            <li key={r.entry_id}>
              {/* engine entries to the second - the firing order in a critical sequence (the owner 10-05) */}
              <span className="cockpit-wx-meta">{r.source === 'engine' ? r.occurred_at.slice(11, 19) : hhmm(r.occurred_at)}</span>{' '}
              <span className={`cockpit-sev cockpit-sev--${(r.severity ?? r.kind).toLowerCase()}`}>{r.severity ?? r.kind}</span>
              {r.simulated && <span className="cockpit-sev cockpit-sev--test">TEST</span>}{' '}
              {r.title}
            </li>
          ))}
        </ul>
      )}
      {changes.length > 0 && (
        <ul className="cockpit-this-watch">
          {changes.map((c) => (
            <li key={c.update_id}>
              <span className="cockpit-wx-meta">{hhmm(c.at)}</span>{' '}
              <span className="cockpit-sev cockpit-sev--info">{c.entry_ref}</span>{' '}
              {c.title}: {c.previous} → <strong>{c.status}</strong>{c.note && <span className="cockpit-wx-meta"> ({c.note})</span>}
            </li>
          ))}
        </ul>
      )}
      {done ? (
        <p className="cockpit-status cockpit-status--done">✅ Watch logged ({done}).</p>
      ) : (
        <>
          <label className="cockpit-notes-label">
            Observations for the log (optional)
            <textarea rows={3} value={notables} onChange={(e) => setNotables(e.target.value)}
                      placeholder="Sea state, sky / weather, traffic, how she's sailing, anything odd" />
          </label>
          <AuthorPick variant="cockpit" label="Handed over by" value={author} onChange={setAuthor} crew={crew}
                      onWatch={onWatch} />
          <AuthorPick variant="cockpit" label="Taking the watch" value={taking} onChange={setTaking}
                      crew={crew.filter((c) => c !== author)} />
          <button type="button" className="cockpit-primary-action" disabled={log.isPending || !author || !taking}
                  onClick={() => log.mutate({ notables: notables.trim() || null, author, on_watch: taking },
                                             { onSuccess: (e) => { rememberAuthor(taking); setDone(e.entry_ref)
                                                                   setNotables(''); setTaking('') } })}>
            {log.isPending ? 'Logging…' : '📓 Log this watch'}
          </button>
          {log.isError && <p className="cockpit-status cockpit-status--error">Not logged - {friendlyError(log.error)}</p>}
        </>
      )}
    </div>
  )
}

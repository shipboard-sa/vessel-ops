/**
 * Purpose: Cockpit "Break / Incident" tile - a logbook entry (failure / observation / incident) with the governed
 *   System > Device pick, a one-line title, optional detail, "when" and, for a failure, an optional fix task raised
 *   in the same pass (no detour). The boat stack stamps it (position, speed, mode, sail set) - nothing typed.
 * Version: v5 (2026-10-05) - v5: signed (AuthorPick - the watchkeeper by default, the owner's review). v4 (2026-10-05) - v4: writes the mx-inv LOGBOOK (POST /api/logbook, schema v37, option C) instead of
 *   the previous developer's never-built webhook; adds incident, "when", fix task and shows the entry's ref + stamp.
 *   v3 (2026-10-04): plain-words errors. v2 (2026-09-17).
 * Scope: PRODUCTION - mx-inv frontend, cockpit feature.
 * Architecture: POST /api/logbook (backend/routers/logbook.py -> data.create_log_entry, stamp from
 *   backend/log_stamp.py). System field = the shared SystemPicker / useSystems() cascade (same as Management).
 */
import { useState } from 'react'
import { friendlyError } from './CockpitBits'
import { useLogEntry } from './useCockpit'
import { useSystems } from '../management/useTasks'
import { SystemPicker } from '../management/SystemPicker'
import type { LogEntry } from '../../api/types'
import { AuthorPick, rememberAuthor, useAuthor } from '../logbook/AuthorPick'

type Kind = 'failure' | 'observation' | 'incident'
const KINDS: [Kind, string][] = [['failure', '🔧 Failure'], ['observation', '👁 Observation'], ['incident', '⚠️ Incident']]
const WHEN: [number, string][] = [[0, 'Just now'], [5, '5 min ago'], [10, '10 min ago'], [15, '15 min ago'], [30, '30 min ago']]
const URGENCY: [string, string][] = [['routine', 'Routine'], ['urgent', 'Urgent'], ['immediate', 'Drop everything']]

function Buttons<T extends string | number>({ label, options, value, onChange }: {
  label: string; options: [T, string][]; value: T; onChange: (v: T) => void
}) {
  return (
    <div className="cockpit-pick">
      <div className="cockpit-pick-label">{label}</div>
      <div className="cockpit-mode-buttons" role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={String(v)} type="button" aria-pressed={value === v}
                  className={value === v ? 'active' : undefined} onClick={() => onChange(v)}>{text}</button>
        ))}
      </div>
    </div>
  )
}

export function IncidentForm({ onBack }: { onBack: () => void }) {
  const [kind, setKind] = useState<Kind>('failure')
  const [system, setSystem] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [when, setWhen] = useState(0)
  const [fix, setFix] = useState('')
  const [urgency, setUrgency] = useState('routine')
  const [saved, setSaved] = useState<LogEntry | null>(null)
  const mutation = useLogEntry()
  const { data: systems } = useSystems()
  const [author, setAuthor, crew, onWatch] = useAuthor()

  const header = (
    <div className="cockpit-panel-header">
      <button type="button" className="cockpit-back" onClick={onBack}>← Back</button>
      <h2>⚠️ Break / Incident</h2>
    </div>
  )

  if (saved) {
    const s = saved.stamp
    return (
      <div className="cockpit-incident-form">
        {header}
        <p className="cockpit-status cockpit-status--done">✅ Logged {saved.entry_ref}: {saved.title}</p>
        {s && (
          <p className="cockpit-wx-meta">
            Stamped: {s.lat != null && s.lon != null ? `${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}` : 'no position'}
            {s.sog_kn != null && ` · ${s.sog_kn} kn`}{s.mode && ` · ${s.mode}`}{s.sail_set && ` · ${s.sail_set}`}
          </p>
        )}
        {saved.follow_on_task_id && <p className="cockpit-status">Fix task #{saved.follow_on_task_id} raised.</p>}
        <button type="button" className="cockpit-big-button"
                onClick={() => { setSaved(null); setTitle(''); setBody(''); setFix(''); setWhen(0) }}>
          Log another
        </button>
      </div>
    )
  }

  return (
    <div className="cockpit-incident-form">
      {header}
      <Buttons label="What kind" options={KINDS} value={kind} onChange={setKind} />
      <div className="cockpit-pick">
        <div className="cockpit-pick-label">System / device{kind === 'failure' ? '' : ' (optional)'}</div>
        <SystemPicker value={system} systems={systems ?? []} onChange={setSystem} />
      </div>
      <label className="cockpit-notes-label">
        In one line
        <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)}
               placeholder={kind === 'failure' ? 'e.g. Staysail sheet car jammed' : ''} />
      </label>
      <label className="cockpit-notes-label">
        More detail (optional)
        <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <Buttons label="When" options={WHEN} value={when} onChange={setWhen} />
      {kind === 'failure' && (
        <>
          <label className="cockpit-notes-label">
            Fix task (optional - raised on the schedule now)
            <input value={fix} maxLength={120} onChange={(e) => setFix(e.target.value)} />
          </label>
          {fix.trim() && <Buttons label="How soon" options={URGENCY} value={urgency} onChange={setUrgency} />}
        </>
      )}
      <AuthorPick variant="cockpit" value={author} onChange={setAuthor} crew={crew} onWatch={onWatch} />
      <button
        type="button"
        className="cockpit-primary-action"
        disabled={mutation.isPending || !title.trim() || (kind === 'failure' && !system.trim()) || !author}
        onClick={() => mutation.mutate(
          { kind, title: title.trim(), body: body.trim() || null, system: system.trim() || null, source: 'cockpit',
            minutes_ago: when, author,
            follow_on: kind === 'failure' && fix.trim() ? { task_name: fix.trim(), urgency } : null },
          { onSuccess: (e) => { rememberAuthor(author); setSaved(e) } },
        )}
      >
        {mutation.isPending ? 'Logging…' : '✅ Log it'}
      </button>
      {mutation.isError && <p className="cockpit-status cockpit-status--error">Not logged - {friendlyError(mutation.error)}</p>}
    </div>
  )
}

/**
 * Purpose: Cockpit "Depart / Arrive" screen (schema v38, the owner 2026-10-05: each leg is a passage) - when no leg is
 *   under way it logs the DEPARTURE (from / bound for / when); while one is, it shows the leg so far and logs the
 *   ARRIVAL. Recent ports are big tap buttons; typing is only for a port never used before.
 * Version: v2 (2026-10-05) - v2: signed (AuthorPick, the watchkeeper by default) and the departure sets the
 *   first watch (the owner's review). v1 (2026-10-05)
 * Scope: PRODUCTION - mx-inv frontend, cockpit feature.
 * Architecture: Reads GET /api/logbook/passages/current + /ports, writes POST /api/logbook/departure | /arrival
 *   (backend/routers/logbook.py -> data.log_passage_end; stamped by backend/log_stamp.py). Hooks shared with the
 *   desktop Passages view (features/logbook/useLogbook.ts). The server refuses an out-of-order end (409) and the
 *   reason is shown as-is.
 * Invocation: rendered by CockpitApp.tsx for screen 'passage'.
 */
import { useState } from 'react'
import { ApiError } from '../../api/client'
import { friendlyError } from './CockpitBits'
import { hoursText, useCurrentPassage, useLogPassageEnd, usePassages, usePorts } from '../logbook/useLogbook'
import type { LogEntry } from '../../api/types'
import { AuthorPick, rememberAuthor, useAuthor } from '../logbook/AuthorPick'

const WHEN: [number, string][] = [[0, 'Just now'], [5, '5 min ago'], [10, '10 min ago'], [15, '15 min ago'],
  [30, '30 min ago'], [60, '1 h ago']]

function PortPick({ label, value, onChange, ports }: {
  label: string; value: string; onChange: (v: string) => void; ports: string[]
}) {
  return (
    <div className="cockpit-pick">
      <div className="cockpit-pick-label">{label}</div>
      {ports.length > 0 && (
        <div className="cockpit-mode-buttons" role="group" aria-label={label}>
          {ports.slice(0, 6).map((p) => (
            <button key={p} type="button" aria-pressed={value === p} className={value === p ? 'active' : undefined}
              onClick={() => onChange(p)}>{p}</button>
          ))}
        </div>
      )}
      <input className="cockpit-port-input" style={{ marginTop: '0.5rem' }} value={value} maxLength={80} onChange={(e) => onChange(e.target.value)}
        placeholder={ports.length ? 'or type a new port' : 'port name'} />
    </div>
  )
}

export function PassageForm({ onBack }: { onBack: () => void }) {
  const { data: current, isLoading } = useCurrentPassage()
  const { data: passages } = usePassages()
  const { data: ports } = usePorts()
  const lastArrival = passages?.find((p) => !p.underway)
  const kind: 'departure' | 'arrival' = current ? 'arrival' : 'departure'
  const [from, setFrom] = useState<string | null>(null)
  const [to, setTo] = useState('')
  const [at, setAt] = useState<string | null>(null)
  const [ago, setAgo] = useState(0)
  const [saved, setSaved] = useState<LogEntry | null>(null)
  const [author, setAuthor, crew, onWatch] = useAuthor()
  const [first, setFirst] = useState('')
  const m = useLogPassageEnd(kind)

  // the heading follows what was just SAVED: once an arrival is logged the leg is closed and `kind` flips
  const header = (
    <div className="cockpit-panel-header">
      <button type="button" className="cockpit-back" onClick={onBack}>← Back</button>
      <h2>{(saved?.kind ?? kind) === 'arrival' ? '🏁 Arrive' : '⛵ Depart'}</h2>
    </div>
  )
  if (saved) {
    return (
      <div className="cockpit-incident-form">
        {header}
        <p className="cockpit-status cockpit-status--done">✅ Logged {saved.entry_ref}: {saved.title}</p>
        <button type="button" className="cockpit-big-button" onClick={onBack}>Done</button>
      </div>
    )
  }
  if (isLoading) return <div className="cockpit-incident-form">{header}<p className="cockpit-status">Loading…</p></div>

  const fromVal = from ?? lastArrival?.to_port ?? ''
  const atVal = at ?? current?.bound_for ?? ''
  const ready = (kind === 'departure' ? fromVal.trim() && to.trim() : atVal.trim()) && author
  return (
    <div className="cockpit-incident-form">
      {header}
      {current ? (
        <p className="cockpit-status" style={{ marginBottom: '0.8rem' }}>
          Under way from <strong>{current.from_port}</strong>, bound for <strong>{current.bound_for}</strong> -
          {' '}{hoursText(current.hours)}{current.distance_nm != null && `, ${current.distance_nm} nm logged`}.
        </p>
      ) : lastArrival && (
        <p className="cockpit-status" style={{ marginBottom: '0.8rem' }}>Last arrival: {lastArrival.to_port}, {lastArrival.arrived_at?.slice(0, 16).replace('T', ' ')}</p>
      )}
      {kind === 'departure' ? (
        <>
          <PortPick label="Leaving" value={fromVal} onChange={setFrom} ports={ports ?? []} />
          <PortPick label="Bound for" value={to} onChange={setTo} ports={(ports ?? []).filter((p) => p !== fromVal)} />
        </>
      ) : (
        <PortPick label="Arrived at" value={atVal} onChange={setAt} ports={ports ?? []} />
      )}
      <div className="cockpit-pick">
        <div className="cockpit-pick-label">When</div>
        <div className="cockpit-mode-buttons" role="group" aria-label="When">
          {WHEN.map(([v, t]) => (
            <button key={v} type="button" aria-pressed={ago === v} className={ago === v ? 'active' : undefined}
              onClick={() => setAgo(v)}>{t}</button>
          ))}
        </div>
      </div>
      <AuthorPick variant="cockpit" value={author} onChange={setAuthor} crew={crew} onWatch={onWatch} />
      {kind === 'departure' && (
        <AuthorPick variant="cockpit" label="First watch" value={first || author} onChange={setFirst} crew={crew} />
      )}
      <button type="button" className="cockpit-primary-action" disabled={!ready || m.isPending}
        onClick={() => m.mutate(
          kind === 'departure'
            ? { port: fromVal.trim(), bound_for: to.trim(), source: 'cockpit', minutes_ago: ago, author,
                first_watch: first || author }
            : { port: atVal.trim(), source: 'cockpit', minutes_ago: ago, author },
          { onSuccess: (e) => { rememberAuthor(author); setSaved(e) } },
        )}>
        {m.isPending ? 'Logging…' : kind === 'departure' ? '⛵ Log departure' : '🏁 Log arrival'}
      </button>
      {m.isError && (
        <p className="cockpit-status cockpit-status--error">
          Not logged - {m.error instanceof ApiError && typeof m.error.detail === 'string' ? m.error.detail
            : friendlyError(m.error)}
        </p>
      )}
    </div>
  )
}

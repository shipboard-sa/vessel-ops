/**
 * Purpose: The desktop Ship's Log "⛵ Passages" view (schema v38, the owner 2026-10-05: each leg is a passage) - the leg
 *   under way (or the last arrival), Log departure / Log arrival, and every passage with its facts and a
 *   "Print this passage" button.
 * Version: v2 (2026-10-05) - v2: signed (AuthorPick) and, for a departure, the first watch (the owner's review).
 *   v1 (2026-10-05)
 * Scope: PRODUCTION - mx-inv frontend, logbook feature.
 * Architecture: Rendered by LogbookView.tsx as its third view. Reads GET /api/logbook/passages (+ /current, /ports)
 *   and writes POST /api/logbook/departure | /arrival through useLogbook.ts; the server enforces the order (a 409
 *   says why). A passage is derived from its two entries - opening it opens its departure entry. Print opens
 *   GET /api/report/logbook?passage=<id> (backend/logbook_report.py).
 * Invocation: imported by features/logbook/LogbookView.tsx.
 */
import { useState } from 'react'
import type { Passage } from '../../api/types'
import { hoursText, useCurrentPassage, useLogPassageEnd, usePassages, usePorts } from './useLogbook'
import { AuthorPick, rememberAuthor, useAuthor } from './AuthorPick'

const WHEN: [number, string][] = [
  [0, 'Just now'], [15, '15 min ago'], [30, '30 min ago'], [60, '1 h ago'], [120, '2 h ago'], [240, '4 h ago'],
  [480, '8 h ago'], [720, '12 h ago'], [1440, '24 h ago'],
]

const when = (iso: string) => iso.slice(0, 16).replace('T', ' ')

function PassageEndForm({ kind, defaultPort, onDone }: {
  kind: 'departure' | 'arrival'; defaultPort: string; onDone: () => void
}) {
  const [port, setPort] = useState(defaultPort)
  const [bound, setBound] = useState('')
  const [ago, setAgo] = useState(0)
  const [notes, setNotes] = useState('')
  const { data: ports } = usePorts()
  const [author, setAuthor, crew, onWatch] = useAuthor()
  const [first, setFirst] = useState('')
  const m = useLogPassageEnd(kind)
  const ready = port.trim() && (kind === 'arrival' || bound.trim())
  return (
    <form className="historical-form" onSubmit={(ev) => {
      ev.preventDefault()
      if (!ready) return
      m.mutate({ port: port.trim(), bound_for: kind === 'departure' ? bound.trim() : null, body: notes.trim() || null,
                 source: 'desktop', minutes_ago: ago, author: author || null,
                 first_watch: kind === 'departure' ? (first || author || null) : null },
               { onSuccess: () => { rememberAuthor(author); onDone() } })
    }}>
      <datalist id="log-ports">{(ports ?? []).map((p) => <option key={p} value={p} />)}</datalist>
      <label>{kind === 'departure' ? 'Departed from' : 'Arrived at'}
        <input list="log-ports" value={port} onChange={(e) => setPort(e.target.value)} required />
      </label>
      {kind === 'departure' && (
        <label>Bound for
          <input list="log-ports" value={bound} onChange={(e) => setBound(e.target.value)} required />
        </label>
      )}
      <label>When{' '}
        <select value={ago} onChange={(e) => setAgo(Number(e.target.value))}>
          {WHEN.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
      </label>
      <label>Notes (optional)
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder={kind === 'departure' ? 'e.g. Departure brief done, crew the owner + crew member, fuel 190 gal' : ''} />
      </label>
      <AuthorPick variant="desktop" value={author} onChange={setAuthor} crew={crew} onWatch={onWatch} />
      {kind === 'departure' && (
        <AuthorPick variant="desktop" label="First watch" value={first || author} onChange={setFirst} crew={crew} />
      )}
      <p className="completion-meta">The boat stamps it (position, speed, mode, sail set) - nothing to type.</p>
      <div className="log-form-buttons">
        <button type="submit" disabled={!ready || m.isPending}>
          {kind === 'departure' ? '⛵ Log departure' : '🏁 Log arrival'}
        </button>
        <button type="button" className="link-button" onClick={onDone}>Cancel</button>
      </div>
      {m.isError && <p className="schedule-status--error">{(m.error as Error).message}</p>}
    </form>
  )
}

function Facts({ p }: { p: Passage }) {
  const bits = [hoursText(p.hours) + (p.underway ? ' so far' : ''),
    p.distance_nm != null ? `${p.distance_nm} nm logged` : 'distance: too few logged positions',
    ...(p.engine_hours_run != null ? [`engine ${p.engine_hours_run} h`] : [])]
  const counts = [[p.failures, 'failure'], [p.incidents, 'incident'], [p.alarms, 'alarm'], [p.observations, 'observation']]
    .filter(([n]) => (n as number) > 0).map(([n, w]) => `${n} ${w}${n === 1 ? '' : 's'}`)
  return <span className="completion-meta">{[...bits, ...counts].join(' · ')}</span>
}

export function PassagesView({ onOpen }: { onOpen: (entryId: number) => void }) {
  const { data: passages, isLoading, isError, error } = usePassages()
  const { data: current } = useCurrentPassage()
  const [form, setForm] = useState<'departure' | 'arrival' | null>(null)
  const last = passages?.find((p) => !p.underway)
  return (
    <>
      <div className="log-passage-now">
        {current ? (
          <>
            <strong>⛵ Under way: {current.from_port} → {current.bound_for}</strong>
            <span className="completion-meta">since {when(current.departed_at)}</span> <Facts p={current} />
            <button type="button" onClick={() => setForm(form ? null : 'arrival')}>🏁 Log arrival</button>
          </>
        ) : (
          <>
            <strong>{last ? `🏁 In ${last.to_port}` : 'No passage logged yet'}</strong>
            {last?.arrived_at && <span className="completion-meta">since {when(last.arrived_at)}</span>}
            <button type="button" onClick={() => setForm(form ? null : 'departure')}>⛵ Log departure</button>
          </>
        )}
      </div>
      {form && (
        <PassageEndForm key={form} kind={form}
          defaultPort={form === 'arrival' ? (current?.bound_for ?? '') : (last?.to_port ?? '')}
          onDone={() => setForm(null)} />
      )}
      {isLoading && <p className="schedule-status">Loading…</p>}
      {isError && <p className="schedule-status schedule-status--error">{(error as Error).message}</p>}
      {passages && passages.length === 0 && (
        <p className="bucket-empty">
          No passages yet. A passage is one leg: log the departure as you leave and the arrival when she is secured.
        </p>
      )}
      <ul className="log-passages">
        {(passages ?? []).map((p) => (
          <li key={p.passage_id} className={p.underway ? 'log-passage log-passage--underway' : 'log-passage'}>
            <div className="log-passage-head">
              <button type="button" className="record-link log-title" onClick={() => onOpen(p.passage_id)}>
                {p.from_port} → {p.to_port ?? p.bound_for}
              </button>
              {p.underway && <span className="log-pill log-pill--deferred">Under way</span>}
              <span className="log-ref">{p.passage_ref}</span>
              <a className="log-day-print" href={`/api/report/logbook?passage=${p.passage_id}`} target="_blank"
                rel="noreferrer">🖨️ Print this passage</a>
            </div>
            <div className="completion-meta">
              {when(p.departed_at)} → {p.arrived_at ? when(p.arrived_at) : '…'}
            </div>
            <Facts p={p} />
          </li>
        ))}
      </ul>
    </>
  )
}

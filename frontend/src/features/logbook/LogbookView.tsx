/**
 * Purpose: The desktop Ship's Log tab (the owner 2026-10-05: "this is the ship's log - no more paper") - the logbook
 *   day by day with filters, the failure register grouped by status, one entry full-screen (stamp, status chain,
 *   add a status update), a desktop "new entry" form, and printable day / passage logs.
 * Version: v3 (2026-10-05) - v3 (the owner's review): 'Boat Instruments'; wind as '14 kn / 41° port'; source in words
 *   (Auto Report ...); every form is SIGNED (AuthorPick - the watchkeeper by default); status changes show as their
 *   own line on the day they happened, opening the original failure; sail-plan / engine entries; rules-engine
 *   entries are 'Automation'. v2 (2026-10-05) - v2: a third view, ⛵ Passages (schema v38 - PassagesView.tsx); departure / arrival
 *   entries in the day-by-day list and its Show filter. v1 (2026-10-05)
 * Scope: PRODUCTION - mx-inv frontend, logbook feature (schema v37).
 * Architecture: The "📖 Ship's Log" tab of App.tsx. Reads / writes through useLogbook.ts (backend/routers/
 *   logbook.py). Append-only like the maintenance history: nothing here edits or deletes - a failure moves by
 *   appending a status update. Print buttons open GET /api/report/logbook (backend/logbook_report.py) in a new
 *   tab. A passage = one leg, a departure to the next arrival (the owner 10-05) - PassagesView. The handover
 *   is a CHANGE report on the cockpit; the standing register (Deferred / Accepted, it will get long) lives HERE.
 *   System and fix-task names are RecordLinks (open on Management; Back returns here via NavScope).
 * Invocation: rendered by App.tsx for the 'logbook' tab.
 */
import { useMemo, useState } from 'react'
import type { LogEntry, LogStatusChange } from '../../api/types'
import { todayLocal } from '../../api/date'
import { FocusScreen, useFocusTrail } from '../../components/FocusScreen'
import { NavScopeProvider, useReturnRestore } from '../../components/AppNav'
import { RecordLink } from '../../components/RecordLink'
import { SystemPicker } from '../management/SystemPicker'
import { useSystems } from '../management/useTasks'
import {
  CLOSED, KIND_LABEL, SOURCE_LABEL, STATUSES, STATUS_LABEL, useAddLogEntry, useAddLogStatus, useLogEntries,
  useLogEntryDetail, useNotifications, useStatusChanges, windText, type LogKind,
} from './useLogbook'
import { AuthorPick, rememberAuthor, useAuthor } from './AuthorPick'
import { PassagesView } from './PassagesView'
import './LogbookView.css'

import type { NotificationEntry } from '../../api/types'

type View = 'days' | 'register' | 'passages' | 'notifications'

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function prettyDay(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined,
    { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })
}

/** HH:MM, or HH:MM:SS for an engine entry (Owner: the firing order of a critical sequence). */
function timeOf(e: LogEntry): string {
  return e.occurred_at.slice(11, e.source === 'engine' ? 19 : 16)
}

/** The engine's body is a deck line + a JSON detail blob; split them. */
function splitBody(e: LogEntry): { text: string; detail: string | null } {
  const lines = (e.body ?? '').split('\n')
  if (e.kind !== 'event') return { text: e.body ?? '', detail: null }
  const json = lines.filter((l) => l.trimStart().startsWith('{'))
  return { text: lines.filter((l) => !l.trimStart().startsWith('{')).join('\n'), detail: json.join('\n') || null }
}

function printHref(day: string, to?: string, tests?: boolean): string {
  const q = new URLSearchParams({ day })
  if (to && to !== day) q.set('to', to)
  if (tests) q.set('tests', '1')
  return `/api/report/logbook?${q.toString()}`
}

function StatusPill({ status }: { status: string | null }) {
  if (!status) return null
  return <span className={`log-pill log-pill--${status}`}>{STATUS_LABEL[status] ?? status}</span>
}

function LogRow({ e, onOpen }: { e: LogEntry; onOpen: (id: number) => void }) {
  if (e.kind === 'status') {
    return (
      <li className="log-row log-row--status">
        <span className="log-time">{timeOf(e)}</span>
        <button type="button" className="link-button log-deckline" onClick={() => onOpen(e.entry_id)}>
          ⚓ {e.body ?? e.title}
        </button>
      </li>
    )
  }
  return (
    <li className={`log-row log-row--${e.kind}`}>
      <span className="log-time">{timeOf(e)}</span>
      <span className="log-kind">{KIND_LABEL[e.kind]}</span>
      {e.severity && e.severity !== 'info' && <span className={`log-sev log-sev--${e.severity}`}>{e.severity}</span>}
      {e.simulated && <span className="log-sev log-sev--test">TEST</span>}
      <button type="button" className="record-link log-title" onClick={() => onOpen(e.entry_id)}>{e.title}</button>
      {e.kind === 'failure' && <StatusPill status={e.status} />}
      {e.system && <RecordLink to={{ kind: 'system', name: e.system }} className="log-system">{e.system}</RecordLink>}
      <span className="log-ref">{e.entry_ref}</span>
    </li>
  )
}

/** A failure's status change on the day it happened (the owner 10-05) - tapping it opens the original failure. */
function ChangeRow({ c, onOpen }: { c: LogStatusChange; onOpen: (id: number) => void }) {
  return (
    <li className="log-row log-row--change">
      <span className="log-time">{c.at.slice(11, 16)}</span>
      <span className="log-kind">🔧 Status</span>
      <button type="button" className="record-link log-title" onClick={() => onOpen(c.entry_id)}>
        {c.entry_ref} {c.title}
      </button>
      <StatusPill status={c.previous} /> → <StatusPill status={c.status} />
      {c.note && <span className="completion-meta">{c.note}</span>}
      {c.author && <span className="completion-meta">by {c.author}</span>}
    </li>
  )
}

type DayRow = { at: string; entry?: LogEntry; change?: LogStatusChange }

const PERIODS: [string, string][] = [
  ['1', 'Today'], ['2', 'Since yesterday'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'],
  ['range', 'From / to…'],
]
const KIND_FILTER: [string, string][] = [
  ['', 'Everything'], ['failure', 'Failures'], ['incident', 'Incidents'], ['observation', 'Observations'],
  ['watch', 'Watch handovers'], ['departure', 'Departures'], ['arrival', 'Arrivals'], ['sail', 'Sail changes'],
  ['engine', 'Engine on / off'], ['event', 'Automation (alarms)'], ['status', 'Deck log only'],
]

function DaysView({ onOpen }: { onOpen: (id: number) => void }) {
  const today = todayLocal()
  const [period, setPeriod] = useState('7')
  const [from, setFrom] = useState(addDays(today, -6))
  const [to, setTo] = useState(today)
  const [kind, setKind] = useState('')
  const [system, setSystem] = useState('')
  const [deck, setDeck] = useState(true)
  const [tests, setTests] = useState(false)
  const { data: systems } = useSystems()

  const [d0, d1] = period === 'range'
    ? (from <= to ? [from, to] : [to, from])
    : [addDays(today, -(Number(period) - 1)), today]
  const { data, isLoading, isError, error } = useLogEntries({
    kind: kind || undefined, system: system || undefined, since: d0, until: addDays(d1, 1), simulated: tests,
  })
  const { data: changeData } = useStatusChanges(d0, addDays(d1, 1))
  const changes = useMemo(() => (changeData ?? []).filter((c) =>
    (kind === '' || kind === 'failure') && (!system || c.system === system)), [changeData, kind, system])
  const shownEntries = useMemo(() => (data ?? []).filter((e) => deck || kind === 'status' || e.kind !== 'status'), [data, deck, kind])
  const shown: DayRow[] = useMemo(() => [
    ...shownEntries.map((e) => ({ at: e.occurred_at, entry: e })),
    ...changes.map((c) => ({ at: c.at, change: c })),
  ].sort((a, b) => b.at.slice(0, 16).localeCompare(a.at.slice(0, 16))), [shownEntries, changes])   // newest first
  const days = useMemo(() => {
    const m = new Map<string, DayRow[]>()
    for (const r of shown) {
      const d = r.at.slice(0, 10)
      if (!m.has(d)) m.set(d, [])
      m.get(d)!.push(r)
    }
    return [...m.entries()]
  }, [shown])
  const filtered = kind !== '' || system !== '' || !deck || tests

  return (
    <>
      <div className="log-filters">
        <label>Period{' '}
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </label>
        {period === 'range' && (
          <>
            <label>From <input type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} /></label>
            <label>To <input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} /></label>
          </>
        )}
        <label>Show{' '}
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {KIND_FILTER.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </label>
        <div className="log-system-filter">
          <SystemPicker value={system} systems={systems ?? []} onChange={setSystem} />
          {system && <button type="button" className="link-button" onClick={() => setSystem('')}>All systems</button>}
        </div>
        <label className="log-check"><input type="checkbox" checked={deck} onChange={(e) => setDeck(e.target.checked)} /> Deck log lines</label>
        <label className="log-check"><input type="checkbox" checked={tests} onChange={(e) => setTests(e.target.checked)} /> Automation test events</label>
        {filtered && (
          <button type="button" className="link-button"
            onClick={() => { setKind(''); setSystem(''); setDeck(true); setTests(false) }}>Clear filters</button>
        )}
        <a className="completion-log-report" href={printHref(d0, d1, tests)} target="_blank" rel="noreferrer"
          title="The whole period as a printed log, oldest first, with the open-failure register - opens in a new tab. Prints every kind of entry, whatever this screen is filtered to.">
          🖨️ Print {d0 === d1 ? 'this day' : 'these days'}
        </a>
      </div>
      {isLoading && <p className="schedule-status">Loading…</p>}
      {isError && <p className="schedule-status schedule-status--error">{(error as Error).message}</p>}
      {data && <p className="completion-summary">{shown.length} entr{shown.length === 1 ? 'y' : 'ies'} shown.</p>}
      {data && shown.length === 0 && (
        <p className="bucket-empty">{filtered ? 'Nothing matches these filters.' : 'Nothing logged in this period.'}</p>
      )}
      {days.map(([day, rows]) => (
        <section key={day} className="log-day">
          <h3>
            {prettyDay(day)} <span className="completion-count">({rows.length})</span>
            <a className="log-day-print" href={printHref(day, undefined, tests)} target="_blank" rel="noreferrer">🖨️ Print this day</a>
          </h3>
          <ul>{rows.map((r) => r.entry
            ? <LogRow key={`e${r.entry.entry_id}`} e={r.entry} onOpen={onOpen} />
            : <ChangeRow key={`c${r.change!.update_id}`} c={r.change!} onOpen={onOpen} />)}</ul>
        </section>
      ))}
    </>
  )
}

function RegisterView({ onOpen }: { onOpen: (id: number) => void }) {
  const { data, isLoading, isError, error } = useLogEntries({ kind: 'failure', simulated: true })
  const groups = STATUSES.map(([s, label]) => ({
    s, label, rows: (data ?? []).filter((e) => e.status === s).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)),
  }))
  const open = (data ?? []).filter((e) => !CLOSED.has(e.status ?? '')).length
  return (
    <>
      <p className="completion-summary">
        Every failure ever logged, by its status now.{data && <> <strong>{open} open</strong></>} (Broke, Parts Ordered, Deferred);
        Accepted and Fixed are closed. Oldest first in each group.
      </p>
      {isLoading && <p className="schedule-status">Loading…</p>}
      {isError && <p className="schedule-status schedule-status--error">{(error as Error).message}</p>}
      {data && groups.map((g) => (
        <details key={g.s} className="log-register-group" open={!CLOSED.has(g.s)}>
          <summary><StatusPill status={g.s} /> <span className="completion-count">({g.rows.length})</span></summary>
          {g.rows.length === 0 ? <p className="bucket-empty">None.</p> : (
            <ul>
              {g.rows.map((e) => (
                <li key={e.entry_id} className="log-row log-row--failure">
                  <span className="log-time">{e.occurred_at.slice(0, 10)}</span>
                  <button type="button" className="record-link log-title" onClick={() => onOpen(e.entry_id)}>{e.title}</button>
                  {e.system && <RecordLink to={{ kind: 'system', name: e.system }} className="log-system">{e.system}</RecordLink>}
                  <span className="log-ref">{e.entry_ref}</span>
                </li>
              ))}
            </ul>
          )}
        </details>
      ))}
    </>
  )
}

function StampBlock({ e }: { e: LogEntry }) {
  const s = e.stamp
  if (!s) return <p className="bucket-empty">No boat data was stamped on this entry (the boat stack was not answering).</p>
  const rows: [string, string | null][] = [
    ['Position', s.lat != null && s.lon != null ? `${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}` : null],
    ['Mode', s.mode], ['SOG / COG', s.sog_kn != null ? `${s.sog_kn} kn${s.cog_deg != null ? ` / ${s.cog_deg}°T` : ''}` : null],
    ['Sail set', s.sail_set], ['Apparent wind', windText(s.wind_apparent_kn, s.wind_apparent_deg)],
    ['Barometer', s.baro_hpa != null ? `${s.baro_hpa} hPa` : null],
    ['Engine hours', s.engine_hours != null ? `${s.engine_hours} h` : null],
  ]
  return (
    <>
      <dl className="log-stamp">
        {rows.filter(([, v]) => v !== null).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      {s.card && (
        <details className="log-card">
          <summary>The full handover card as it stood</summary>
          <pre>{JSON.stringify(s.card, null, 1)}</pre>
        </details>
      )}
    </>
  )
}

function StatusForm({ id }: { id: number }) {
  const [status, setStatus] = useState('')
  const [note, setNote] = useState('')
  const [author, setAuthor, crew, onWatch] = useAuthor()
  const m = useAddLogStatus(id)
  return (
    <form className="historical-form log-status-form" onSubmit={(ev) => {
      ev.preventDefault()
      if (!status) return
      m.mutate({ status, note: note.trim() || null, author: author || null },
        { onSuccess: () => { setStatus(''); setNote(''); rememberAuthor(author) } })
    }}>
      <label>New status{' '}
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Pick…</option>
          {STATUSES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
      </label>
      <label>Note (optional)
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. part on order from Defender, ETA 10-14" />
      </label>
      <AuthorPick variant="desktop" value={author} onChange={setAuthor} crew={crew} onWatch={onWatch} />
      <button type="submit" disabled={!status || m.isPending}>Add status update</button>
      {m.isError && <p className="schedule-status--error">{(m.error as Error).message}</p>}
    </form>
  )
}

function EntryDetail({ id }: { id: number }) {
  const { data: e, isLoading, isError, error } = useLogEntryDetail(id)
  if (isLoading) return <p className="schedule-status">Loading…</p>
  if (isError || !e) return <p className="schedule-status schedule-status--error">{(error as Error)?.message}</p>
  const { text, detail } = splitBody(e)
  const late = e.source !== 'engine' && e.recorded_at.slice(0, 16) !== e.occurred_at.slice(0, 16)
  return (
    <div className="log-detail">
      <h2>
        {e.kind === 'status' ? 'Deck log' : e.title}{' '}
        {e.kind === 'failure' && <StatusPill status={e.status} />}
        {e.simulated && <span className="log-sev log-sev--test">TEST</span>}
      </h2>
      <p className="log-detail-meta">
        {e.entry_ref} · {KIND_LABEL[e.kind]}
        {e.severity && e.severity !== 'info' && <> · <span className={`log-sev log-sev--${e.severity}`}>{e.severity}</span></>}
        {' '}· {e.occurred_at.replace('T', ' ')}
        {late && <> (noted {e.recorded_at.replace('T', ' ')})</>}
        {e.author && <> · by {e.author}</>} · {SOURCE_LABEL[e.source] ?? e.source}
      </p>
      {e.on_watch && <p>{e.kind === 'departure' ? 'First watch' : 'Took the watch'}: <strong>{e.on_watch}</strong></p>}
      {e.system && <p>System: <RecordLink to={{ kind: 'system', name: e.system }}>{e.system}</RecordLink></p>}
      {e.follow_on_task_id && (
        <p>Fix task: <RecordLink to={{ kind: 'task', id: e.follow_on_task_id }}>#{e.follow_on_task_id}</RecordLink></p>
      )}
      {text.trim() && <div className="log-body">{text.trim()}</div>}
      {detail && <details className="log-card"><summary>Automation detail</summary><pre>{detail}</pre></details>}
      <h3>Boat Instruments</h3>
      <StampBlock e={e} />
      {e.kind === 'failure' && (
        <>
          <h3>Status history</h3>
          <ol className="log-chain">
            {(e.statuses ?? []).map((s) => (
              <li key={s.update_id}>
                <span className="log-time">{s.at.replace('T', ' ')}</span> <StatusPill status={s.status} />
                {s.note && <> {s.note}</>}{s.author && <span className="completion-meta"> · {s.author}</span>}
              </li>
            ))}
          </ol>
          <StatusForm id={e.entry_id} />
        </>
      )}
      <p className="completion-meta log-append-note">
        The log is append-only: an entry is never edited. A failure moves by a status update; a correction is a new entry.
      </p>
    </div>
  )
}

const WHEN: [number, string][] = [
  [0, 'Just now'], [15, '15 min ago'], [30, '30 min ago'], [60, '1 h ago'], [120, '2 h ago'], [240, '4 h ago'],
  [480, '8 h ago'], [720, '12 h ago'], [1440, '24 h ago'],
]

function NewEntryForm({ onDone }: { onDone: (id: number | null) => void }) {
  const [kind, setKind] = useState<'failure' | 'observation' | 'incident'>('failure')
  const [system, setSystem] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [when, setWhen] = useState(0)
  const [fix, setFix] = useState('')
  const [urgency, setUrgency] = useState('routine')
  const { data: systems } = useSystems()
  const [author, setAuthor, crew, onWatch] = useAuthor()
  const m = useAddLogEntry()
  return (
    <form className="historical-form" onSubmit={(ev) => {
      ev.preventDefault()
      if (!title.trim()) return
      m.mutate({
        kind, title: title.trim(), body: body.trim() || null, system: system || null, source: 'desktop',
        minutes_ago: when, author: author || null,
        follow_on: kind === 'failure' && fix.trim() ? { task_name: fix.trim(), urgency } : null,
      }, { onSuccess: (e) => { rememberAuthor(author); onDone(e.entry_id) } })
    }}>
      <div className="completion-log-views" role="group" aria-label="Kind">
        {(['failure', 'observation', 'incident'] as const).map((k) => (
          <button key={k} type="button" className={kind === k ? 'is-active' : undefined} onClick={() => setKind(k)}>
            {KIND_LABEL[k as LogKind]}
          </button>
        ))}
      </div>
      <SystemPicker value={system} systems={systems ?? []} onChange={setSystem} />
      <label>What happened (one line)
        <input value={title} onChange={(e) => setTitle(e.target.value)} required />
      </label>
      <label>Detail (optional)
        <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <label>When{' '}
        <select value={when} onChange={(e) => setWhen(Number(e.target.value))}>
          {WHEN.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
      </label>
      {kind === 'failure' && (
        <>
          <label>Raise a fix task (optional)
            <input value={fix} onChange={(e) => setFix(e.target.value)} placeholder="e.g. Replace the bilge pump float switch" />
          </label>
          {fix.trim() && (
            <label>Urgency{' '}
              <select value={urgency} onChange={(e) => setUrgency(e.target.value)}>
                <option value="routine">Routine</option><option value="urgent">Urgent</option>
                <option value="immediate">Drop everything</option>
              </select>
            </label>
          )}
        </>
      )}
      <AuthorPick variant="desktop" value={author} onChange={setAuthor} crew={crew} onWatch={onWatch} />
      <p className="completion-meta">The boat stamps it (position, speed, mode, sail set) - nothing to type.</p>
      <div className="log-form-buttons">
        <button type="submit" disabled={!title.trim() || m.isPending}>Log it</button>
        <button type="button" className="link-button" onClick={() => onDone(null)}>Cancel</button>
      </div>
      {m.isError && <p className="schedule-status--error">{(m.error as Error).message}</p>}
    </form>
  )
}

const SEV_FILTER: [string, string][] = [
  ['', 'All severities'], ['P1', 'P1'], ['P2', 'P2'], ['NUDGE', 'NUDGE'], ['info', 'Info'],
  ['P1,P2', 'P1 + P2 only'],
]

function posText(e: NotificationEntry): string {
  if (e.lat == null || e.lon == null) return ''
  return `${e.lat.toFixed(4)}, ${e.lon.toFixed(4)}`
}

function NotificationsView({ onOpen }: { onOpen: (id: number) => void }) {
  const today = todayLocal()
  const [period, setPeriod] = useState('30')
  const [from, setFrom] = useState(addDays(today, -29))
  const [to, setTo] = useState(today)
  const [sev, setSev] = useState('')
  const [search, setSearch] = useState('')
  const [tests, setTests] = useState(false)

  const [d0, d1] = period === 'range'
    ? (from <= to ? [from, to] : [to, from])
    : [addDays(today, -(Number(period) - 1)), today]
  const { data, isLoading, isError, error } = useNotifications({
    severity: sev || undefined, since: d0, until: addDays(d1, 1), simulated: tests,
    q: search.trim() || undefined,
  })

  return (
    <>
      <div className="log-filters">
        <label>Period{' '}
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </label>
        {period === 'range' && (
          <>
            <label>From <input type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} /></label>
            <label>To <input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} /></label>
          </>
        )}
        <label>Severity{' '}
          <select value={sev} onChange={(e) => setSev(e.target.value)}>
            {SEV_FILTER.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </label>
        <label>Search{' '}
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="device, path, message…" style={{ width: '14em' }} />
        </label>
        <label className="log-check"><input type="checkbox" checked={tests} onChange={(e) => setTests(e.target.checked)} /> Test events</label>
      </div>
      {isLoading && <p className="schedule-status">Loading…</p>}
      {isError && <p className="schedule-status schedule-status--error">{(error as Error).message}</p>}
      {data && <p className="completion-summary">{data.length} notification{data.length === 1 ? '' : 's'} shown.</p>}
      {data && data.length === 0 && <p className="bucket-empty">No notifications in this period.</p>}
      {data && data.length > 0 && (
        <table className="log-notif-table">
          <thead>
            <tr>
              <th>Time</th><th>Sev</th><th>Message</th><th>N2K path</th><th>Device</th><th>Position</th><th>Ref</th>
            </tr>
          </thead>
          <tbody>
            {data.map((e) => (
              <tr key={e.entry_id} className={e.simulated ? 'log-notif--test' : undefined}>
                <td className="log-time">{e.occurred_at.slice(0, 16).replace('T', ' ')}</td>
                <td>{e.severity && e.severity !== 'info' && <span className={`log-sev log-sev--${e.severity}`}>{e.severity}</span>}</td>
                <td><button type="button" className="record-link" onClick={() => onOpen(e.entry_id)}>{e.title}</button></td>
                <td className="log-notif-path">{e.n2k_path?.replace('notifications.', '') ?? ''}</td>
                <td className="log-notif-src">{e.device_message || e.n2k_source || ''}</td>
                <td className="log-notif-pos">{posText(e)}</td>
                <td className="log-ref">{e.entry_ref}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

export function LogbookView() {
  const [view, setView] = useState<View>('days')
  const [adding, setAdding] = useState(false)
  const focus = useFocusTrail<number>()
  useReturnRestore('logbook', (r) => {
    if (r.sub === 'days' || r.sub === 'register' || r.sub === 'passages' || r.sub === 'notifications') setView(r.sub)
    if (Array.isArray(r.trail) && r.trail.length) focus.openPath(r.trail as number[])
  })
  const scope = useMemo(() => ({ origin: () => ({ tab: 'logbook' as const, sub: view, trail: focus.trail }) }),
    [view, focus.trail])

  return (
    <NavScopeProvider scope={scope}>
      <div className="logbook">
        {focus.current !== null && (
          <FocusScreen focus={focus}
            listLabel={view === 'days' ? "Ship's Log" : view === 'register' ? 'Failure Register' : view === 'passages' ? 'Passages' : 'Notifications'}
            labelOf={(id) => `LOG-${String(id).padStart(5, '0')}`}>
            <EntryDetail id={focus.current} />
          </FocusScreen>
        )}
        <div hidden={focus.current !== null}>
          <div className="log-head">
            <div className="completion-log-views">
              <button type="button" className={view === 'days' ? 'is-active' : undefined} onClick={() => setView('days')}>
                📖 Day by day
              </button>
              <button type="button" className={view === 'register' ? 'is-active' : undefined} onClick={() => setView('register')}>
                🔧 Failure register
              </button>
              <button type="button" className={view === 'passages' ? 'is-active' : undefined} onClick={() => setView('passages')}>
                ⛵ Passages
              </button>
              <button type="button" className={view === 'notifications' ? 'is-active' : undefined} onClick={() => setView('notifications')}>
                📡 Notifications
              </button>
            </div>
            <button type="button" onClick={() => setAdding((v) => !v)}>{adding ? 'Close' : '＋ New entry'}</button>
          </div>
          {adding && <NewEntryForm onDone={(id) => { setAdding(false); if (id !== null) focus.open(id) }} />}
          {view === 'days' && <DaysView onOpen={focus.open} />}
          {view === 'register' && <RegisterView onOpen={focus.open} />}
          {view === 'passages' && <PassagesView onOpen={focus.open} />}
          {view === 'notifications' && <NotificationsView onOpen={focus.open} />}
        </div>
      </div>
    </NavScopeProvider>
  )
}

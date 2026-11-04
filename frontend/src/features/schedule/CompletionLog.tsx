/**
 * Purpose: The maintenance history - every task completion that was recorded, newest
 *   first, grouped by day: which task, the date logged, how late/early it was, the
 *   completion's own notes, the spares used, and a void control for mistakes.
 * Version: v10 (2026-09-23) - v10: shows an entry's kind of event and evidence path. v9 (2026-09-23) - v9 (tracker #76, no-detour): "File under invoice" is InvoicePick -
 *   "＋ New invoice…" first opens the invoice form right here and picks it; the old "add one under
 *   Invoices on file first" message is gone. v8 (2026-09-23) - v8: an entry's system and task are two targets (system opens the
 *   device, task name opens the record), the project and each part used open their own pages
 *   (tracker #74, "clickable to detail"). v7 (2026-09-22): an entry shows its outcome ("Problem found" / "Partly done"),
 *   the follow-on tasks it raised (each opens its task; open / done / retired) and a
 *   "＋ Follow-on task…" control to raise more later (schema v34, one entry -> many). v6: a second view, "📄 Invoices on file" (InvoicesPanel, schema v33
 *   documents), and on each entry who did it, its own cost, the invoice it is filed under and a
 *   "File under invoice" control (PUT /api/tasks/completions/{id}/document - the one change the
 *   append-only history allows besides voiding). v5: a historical entry is labelled "(recorded from records)"
 *   rather than "(task since removed)" - it never had a task. v4 (2026-09-22) added the
 *   printable CARFAX-style report (opens
 *   /api/report/history honouring the current system/device filter) and the "add a past service
 *   record" backfill form (tracker #44); v3 (2026-09-21) added the year / all-time period and
 *   system / device filters; v2 was 2026-09-19.
 * Scope: PRODUCTION - mx-inv frontend, schedule feature.
 * Architecture: The "🧾 Log" tab of ScheduleBoard. Reads GET /api/tasks/completions
 *   (data.list_completions, backed by task_completions + task_completion_parts, schema
 *   v26) and voids via POST /api/tasks/completions/{id}/void. The history is APPEND-ONLY
 *   (enforced by triggers): an entry is never edited or deleted, only voided with a
 *   reason and shown struck through. Opening an entry hands its task id to the board's
 *   full-record focus screen. (This is the app's OWN durable record;
 *   backend/vessel_log.py separately forwards the same event to the previous developer's log webhook when
 *   that is switched on.)
 */
import { useState } from 'react'
import type { CompletionEntry } from '../../api/types'
import { lateness } from './lateness'
import { useAddFollowOns, useVoidCompletion } from './mutations'
import type { FollowOnDraft } from '../../api/types'
import { EVENT_KIND_LABELS, FollowOnEditor, OUTCOME_LABELS, blankFollowOn, followOnsToSend } from './OutcomeFields'
import { HistoricalRecordForm } from './HistoricalRecordForm'
import { InvoicesPanel } from './InvoicesPanel'
import { useCompletionFacets, useCompletions, type CompletionFilter } from './useCompletions'
import { errorText, money, useFileCompletion } from './useDocuments'
import { InvoicePick } from './InvoiceForm'
import { RecordLink, SystemTaskLabel } from '../../components/RecordLink'
import { useProjects } from '../projects/useProjects'

// The period picker's values: 'd:N' = last N days recorded, 'y:YYYY' = a year (by date logged), 'all'.
function periodOf(key: string): CompletionFilter['period'] {
  if (key === 'all') return { kind: 'all' }
  if (key.startsWith('y:')) return { kind: 'year', year: Number(key.slice(2)) }
  return { kind: 'days', days: Number(key.slice(2)) }
}

// The report honours whatever the tab is filtered to (system / device), but NOT the period:
// a service history is the whole story, not the last 7 days. Cost and vendor are left out
// unless the URL asks for them - see backend/history_report.py.
function reportHref(system: string, device: string): string {
  const q = new URLSearchParams()
  if (device) q.set('device', device)
  else if (system) q.set('system', system)
  const qs = q.toString()
  return `/api/report/history${qs ? `?${qs}` : ''}`
}

export function CompletionLog({ onOpenRecord }: { onOpenRecord: (taskId: number) => void }) {
  const [view, setView] = useState<'history' | 'invoices'>('history')
  return (
    <section className="schedule-workarea completion-log">
      <div className="completion-log-views" role="tablist">
        <button type="button" role="tab" aria-selected={view === 'history'}
          className={view === 'history' ? 'is-active' : ''} onClick={() => setView('history')}>
          Service history
        </button>
        <button type="button" role="tab" aria-selected={view === 'invoices'}
          className={view === 'invoices' ? 'is-active' : ''} onClick={() => setView('invoices')}>
          📄 Invoices on file
        </button>
      </div>
      {view === 'history' ? <ServiceHistory onOpenRecord={onOpenRecord} /> : <InvoicesPanel />}
    </section>
  )
}

function ServiceHistory({ onOpenRecord }: { onOpenRecord: (taskId: number) => void }) {
  const [periodKey, setPeriodKey] = useState('d:7')
  const [adding, setAdding] = useState(false)
  const [system, setSystem] = useState('')
  const [device, setDevice] = useState('')
  const { data: facets } = useCompletionFacets()
  const period = periodOf(periodKey)
  const { data, isLoading, isError, error } = useCompletions({
    period, system: system || null, device: device || null,
  })
  const devices = facets?.systems.find((s) => s.system === system)?.devices ?? []
  const filtered = Boolean(system || device) || period.kind !== 'days'

  // A recent window groups by the LOCAL day it was recorded; a year / all-time history groups by
  // the date the work was logged for (what "what did we do in 2026?" means).
  const groups = new Map<string, CompletionEntry[]>()
  for (const c of data ?? []) {
    const day = period.kind === 'days' ? c.recorded_on_local : c.completed_on
    groups.set(day, [...(groups.get(day) ?? []), c])
  }

  // On-time summary over live entries that had a schedule to be measured against.
  const measured = (data ?? []).filter(
    (c) => !c.voided_at && lateness(c.days_past_due, c.hours_past_due) !== null,
  )
  const lateOnes = measured.filter((c) => lateness(c.days_past_due, c.hours_past_due)?.tone === 'late')
  const lateDays = lateOnes.filter((c) => c.hours_past_due === null && (c.days_past_due ?? 0) > 0)
  const avgLate = lateDays.length
    ? Math.round(lateDays.reduce((n, c) => n + (c.days_past_due ?? 0), 0) / lateDays.length)
    : null

  return (
    <>
      <p className="schedule-bucket-caption">
        The maintenance history: every task completion the app has recorded, newest first - the
        date it was logged for, how late or early it was, notes, and spares used. Entries are
        never edited or deleted; a mistake is <strong>voided</strong> with a reason and stays
        visible, struck through. The log starts when this was switched on; earlier completions
        were not kept. A completion logged for an OLD date leaves an overdue task overdue - those
        are marked.
      </p>
      <div className="completion-log-filters">
        <label className="completion-log-range">
          Period{' '}
          <select value={periodKey} onChange={(e) => setPeriodKey(e.target.value)}>
            <optgroup label="Recent (by when recorded)">
              <option value="d:1">Last day</option>
              <option value="d:7">Last 7 days</option>
              <option value="d:30">Last 30 days</option>
              <option value="d:90">Last 90 days</option>
              <option value="d:365">Last 365 days</option>
            </optgroup>
            <optgroup label="A year (by date logged)">
              {(facets?.years ?? []).map((y) => <option key={y} value={`y:${y}`}>{y}</option>)}
            </optgroup>
            <option value="all">All time</option>
          </select>
        </label>
        <label className="completion-log-range">
          System{' '}
          <select value={system} onChange={(e) => { setSystem(e.target.value); setDevice('') }}>
            <option value="">All systems</option>
            {(facets?.systems ?? []).map((s) => (
              <option key={s.system} value={s.system}>{s.system} ({s.count})</option>
            ))}
          </select>
        </label>
        {system && devices.length > 0 && (
          <label className="completion-log-range">
            Device{' '}
            <select value={device} onChange={(e) => setDevice(e.target.value)}>
              <option value="">All devices</option>
              {devices.map((d) => <option key={d.device} value={d.device}>{d.device} ({d.count})</option>)}
            </select>
          </label>
        )}
        {filtered && (
          <button type="button" className="link-button"
            onClick={() => { setPeriodKey('d:7'); setSystem(''); setDevice('') }}>
            Clear filters
          </button>
        )}
        <button type="button" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Close' : '＋ Past service record'}
        </button>
        <a
          className="completion-log-report"
          href={reportHref(system, device)}
          target="_blank" rel="noreferrer"
          title="A printable service history for whatever this tab is filtered to - opens in a new tab"
        >
          🖨️ Printable report
        </a>
      </div>

      {adding && <HistoricalRecordForm onDone={() => setAdding(false)} />}
      {data && <p className="completion-summary">{data.length} entr{data.length === 1 ? 'y' : 'ies'} shown.</p>}
      {measured.length > 0 && (
        <p className="completion-summary">
          Of {measured.length} scheduled completion{measured.length === 1 ? '' : 's'} in this period:{' '}
          <strong>{measured.length - lateOnes.length} on time or early</strong>,{' '}
          <strong>{lateOnes.length} late</strong>
          {avgLate !== null && <> (averaging {avgLate} d late)</>}.
        </p>
      )}
      {isLoading && <p className="schedule-status">Loading…</p>}
      {isError && <p className="schedule-status schedule-status--error">{(error as Error).message}</p>}
      {data && data.length === 0 && (
        <p className="bucket-empty">
          {filtered ? 'Nothing matches these filters.' : 'Nothing recorded in this period yet.'}
        </p>
      )}
      {[...groups.entries()].map(([day, rows]) => (
        <div key={day} className="completion-day">
          <h4>{day} <span className="completion-count">({rows.length})</span></h4>
          <ul>
            {rows.map((c) => (
              <CompletionRow key={c.completion_id} c={c} onOpenRecord={onOpenRecord} />
            ))}
          </ul>
        </div>
      ))}
    </>
  )
}

// Filing an entry under an invoice is the ONE change the append-only history allows besides
// voiding: which piece of paper paid for the work is a cross-reference, not a fact about what
// was done (schema v33). An entry with its own cost never gets this control - cost OR invoice.
function FileUnderInvoice({ c, onDone }: { c: CompletionEntry; onDone: () => void }) {
  const file = useFileCompletion()
  const [picked, setPicked] = useState<number | null>(c.document_id)
  const go = (documentId: number | null) =>
    file.mutate({ completionId: c.completion_id, documentId }, { onSuccess: onDone })

  return (
    <div className="completion-void-form">
      <InvoicePick value={picked} onPick={setPicked} noneLabel="— pick an invoice —" />
      <button type="button" disabled={picked === null || file.isPending ||
        picked === c.document_id} onClick={() => { if (picked !== null) go(picked) }}>
        {file.isPending ? '…' : 'File it'}
      </button>
      {c.document_id !== null && (
        <button type="button" disabled={file.isPending} onClick={() => go(null)}>Detach</button>
      )}
      <button type="button" onClick={onDone}>Cancel</button>
      {file.isError && <p className="task-detail-hint task-complete-warning">❌ {errorText(file.error)}</p>}
    </div>
  )
}

// v34: raise follow-on task(s) from an existing entry - spotted later, or from a past service
// record. The history row is not touched; each new task points back at it.
function RaiseFollowOns({ c, onDone }: { c: CompletionEntry; onDone: () => void }) {
  const [rows, setRows] = useState<FollowOnDraft[]>([blankFollowOn()])
  const add = useAddFollowOns()
  const send = followOnsToSend(rows)
  return (
    <div className="completion-void-form">
      <FollowOnEditor rows={rows} onChange={setRows} jobSystem={c.system}
        hint="Each becomes its own break/fix task on the schedule, linked back to this entry." />
      <button type="button" disabled={!send.length || add.isPending}
        onClick={() => add.mutate({ completionId: c.completion_id, followOns: send }, { onSuccess: onDone })}>
        {add.isPending ? '…' : `Create ${send.length || ''} task${send.length === 1 ? '' : 's'}`}
      </button>
      <button type="button" onClick={onDone}>Cancel</button>
      {add.isError && <p className="task-detail-hint task-complete-warning">❌ {errorText(add.error)}</p>}
    </div>
  )
}

function CompletionRow({
  c, onOpenRecord,
}: { c: CompletionEntry; onOpenRecord: (taskId: number) => void }) {
  const [voiding, setVoiding] = useState(false)
  const [filing, setFiling] = useState(false)
  const [raising, setRaising] = useState(false)
  const [reason, setReason] = useState('')
  const voidIt = useVoidCompletion()
  const { data: projects } = useProjects()
  const late = lateness(c.days_past_due, c.hours_past_due)
  const timeOf = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  // Entries snapshot the project NAME only (no id) - find the live project by exact name.
  const projectId = c.project_name
    ? projects?.find((p) => p.name === c.project_name)?.project_id ?? null
    : null
  const submitVoid = () => {
    if (!reason.trim()) return
    voidIt.mutate({ completionId: c.completion_id, reason }, { onSuccess: () => setVoiding(false) })
  }

  return (
    <li className={c.voided_at ? 'completion-row completion-row--voided' : 'completion-row'}>
      <div className="completion-line">
        <span className="completion-time">{timeOf(c.recorded_at)}</span>
        <span className="completion-title">
          {c.task_exists && c.task_id !== null ? (
            <SystemTaskLabel
              system={c.system} taskId={c.task_id} taskName={c.task_name}
              onOpenTask={() => onOpenRecord(c.task_id as number)}
            />
          ) : (
            <span>
              <SystemTaskLabel system={c.system} taskId={null} taskName={c.task_name} />{' '}
              {/* A historical record NEVER had a task (task_id is NULL by design), so
                  "task since removed" would be simply untrue for it. */}
              <em>{c.source === 'historical' ? '(recorded from records)' : '(task since removed)'}</em>
            </span>
          )}
        </span>
        {late && !c.voided_at && (
          <span className={`completion-lateness completion-lateness--${late.tone}`}>{late.text}</span>
        )}
        {c.voided_at && <span className="completion-voided-tag">VOIDED</span>}
        {c.backdated && (
          <span className="completion-backdated" title="The date logged is not the day it was recorded">
            · logged for {c.completed_on}
          </span>
        )}
        {c.project_name && (
          <span className="completion-meta">
            · project:{' '}
            <RecordLink to={projectId !== null ? { kind: 'project', id: projectId } : null}>{c.project_name}</RecordLink>
          </span>
        )}
        {c.hours_at_completion !== null && (
          <span className="completion-meta">· {c.hours_at_completion} h</span>
        )}
        {c.source && c.source !== 'schedule' && (
          <span className="completion-meta">· {c.source}</span>
        )}
        {c.outcome && c.outcome !== 'done_ok' && !c.voided_at && (
          <span className={`completion-outcome completion-outcome--${c.outcome}`}>{OUTCOME_LABELS[c.outcome]}</span>
        )}
        {c.event_kind && EVENT_KIND_LABELS[c.event_kind] && (
          <span className="completion-outcome">{EVENT_KIND_LABELS[c.event_kind]}</span>
        )}
        {c.performed_by && <span className="completion-meta">· by {c.performed_by}</span>}
        {c.cost !== null && <span className="completion-meta">· {money(c.cost)}</span>}
        {!c.voided_at && !voiding && !filing && c.cost === null && (
          <button type="button" className="completion-void-btn" onClick={() => setFiling(true)}
            title="Which invoice paid for this work">
            {c.document_id ? '📄 Refile…' : '📄 File under invoice…'}
          </button>
        )}
        {!c.voided_at && !voiding && !raising && (
          <button type="button" className="completion-void-btn" onClick={() => setRaising(true)}
            title="Something still needs doing because of this job">
            ＋ Follow-on task…
          </button>
        )}
        {!c.voided_at && !voiding && (
          <button type="button" className="completion-void-btn" onClick={() => setVoiding(true)}>
            Void…
          </button>
        )}
      </div>

      {c.follow_ons.length > 0 && (
        <p className="completion-notes completion-follow-ons">
          ↪ Follow-on{c.follow_ons.length === 1 ? '' : 's'}:{' '}
          {c.follow_ons.map((f, i) => (
            <span key={f.task_id}>
              {i > 0 && ', '}
              <button type="button" className="link-button" onClick={() => onOpenRecord(f.task_id)}>
                {f.task_name}
              </button>
              {f.done ? ' ✅' : f.retired ? ' (retired)' : ' (open)'}
            </span>
          ))}
        </p>
      )}
      {raising && <RaiseFollowOns c={c} onDone={() => setRaising(false)} />}

      {c.document_id !== null && (
        <p className="completion-notes">
          📄 Paid under {c.document_vendor}{c.document_number ? ` #${c.document_number}` : ''}
        </p>
      )}
      {filing && <FileUnderInvoice c={c} onDone={() => setFiling(false)} />}
      {c.notes && <p className="completion-notes">📝 {c.notes}</p>}
      {c.evidence_path && <p className="completion-notes">📎 Evidence on file: <code>{c.evidence_path}</code></p>}
      {c.parts.length > 0 && (
        <p className="completion-parts">
          🔩 Used:{' '}
          {c.parts.map((p, i) => (
            <span key={i}>
              {i > 0 && ', '}
              <RecordLink to={p.item_id !== null ? { kind: 'item', id: p.item_id } : null}>{p.item_name}</RecordLink>
              {' '}×{p.quantity} {p.unit}
              {p.part_number
                ? (p.part_number === 'CONFIRM'
                    ? <em title="Part number not yet confirmed"> (P/N unconfirmed)</em>
                    : <> (P/N {p.part_number})</>)
                : null}
            </span>
          ))}
        </p>
      )}
      {c.voided_at && (
        <p className="completion-void-reason">
          Voided {new Date(c.voided_at).toLocaleString()}: {c.void_reason}
        </p>
      )}

      {voiding && (
        <div className="completion-void-form">
          <input
            type="text" autoFocus value={reason} placeholder="Why is this entry wrong? (required)"
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submitVoid() }
              if (e.key === 'Escape') setVoiding(false)
            }}
          />
          <button type="button" onClick={submitVoid} disabled={!reason.trim() || voidIt.isPending}>
            {voidIt.isPending ? '…' : 'Void entry'}
          </button>
          <button type="button" onClick={() => setVoiding(false)}>Cancel</button>
          <p className="task-detail-hint">
            The entry stays in the history, struck through. If it is this task&apos;s latest
            completion, the task goes back to its previous due date. Then log the correct
            completion normally.
          </p>
          {voidIt.isError && (
            <p className="task-detail-hint task-complete-warning">❌ {voidIt.error.message}</p>
          )}
        </div>
      )}
    </li>
  )
}

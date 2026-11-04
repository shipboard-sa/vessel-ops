/**
 * Purpose: "Add a past service record" - the form that gets work the app never saw (a yard
 *   invoice, the rigger's job, anything from before this existed) into the maintenance
 *   history, so the printable report tells the whole story rather than only the part that
 *   happened to be ticked in the app.
 * Version: v7 (2026-09-23) - v7: kind of event + evidence path (v32 columns, first written). v6 (2026-09-23) - v6 (tracker #76, no-detour): the system/device select is the shared
 *   SystemPicker (type to search, "＋ New system / device" first) and "Paid under invoice" is
 *   InvoicePick - "＋ New invoice…" first opens the invoice form right here and picks it.
 *   v5 (2026-09-23) - v5: the "Recorded" note names the system/device it was filed under
 *   as a link that opens it (tracker #74). v4 (2026-09-22) adds "How did it go?" and follow-on task(s) (schema v34).
 *   v3 adds "Paid under invoice" (schema v33 documents): picking one
 *   disables the entry's own cost - a job carries its own cost OR an invoice, never both - and
 *   the pick stays set between saves, so a yard invoice's jobs go in one after another.
 *   v2 uses the shared PerformedByField (crew roster + everyone
 *   already in the history) instead of a bare text box. v1 (2026-09-22): first version.
 * Scope: PRODUCTION - mx-inv frontend, schedule feature.
 * Architecture: Rendered by CompletionLog (the "🧾 Log" tab of ScheduleBoard) behind a
 *   disclosure button. Posts to POST /api/tasks/completions/historical
 *   (data.add_historical_record), which writes a task_completions row with
 *   source='historical' and task_id NULL. The system/device picker is fed by
 *   GET /api/tasks/systems, so the entry files itself under the right device in the report.
 *
 * Why this is NOT "complete a task back-dated" (tracker #44): a historical record has no task
 * behind it and must not reschedule anything. If the work really was one of the boat's tracked
 * tasks, the right move is to complete THAT task with an old date - the Complete panel already
 * does it, and it correctly moves the task's next due date. This form is for the other case:
 * a fact about the boat's past that no task on the schedule represents.
 */
import { useState } from 'react'
import { useSystems } from '../management/useTasks'
import { useAddHistoricalRecord } from './mutations'
import { PerformedByField } from './PerformedByField'
import { todayLocal } from '../../api/date'
import { errorText } from './useDocuments'
import { InvoicePick } from './InvoiceForm'
import { SystemPicker } from '../management/SystemPicker'
import type { CompletionOutcome, FollowOnDraft } from '../../api/types'
import { FollowOnEditor, OutcomePicker, blankFollowOn, followOnsToSend, needsFollowOn, EVENT_KIND_LABELS } from './OutcomeFields'
import { RecordLink } from '../../components/RecordLink'

export function HistoricalRecordForm({ onDone }: { onDone: () => void }) {
  const { data: systems } = useSystems()
  const add = useAddHistoricalRecord()

  const [system, setSystem] = useState('')
  const [what, setWhat] = useState('')
  const [when, setWhen] = useState(todayLocal())
  const [performedBy, setPerformedBy] = useState('')
  const [vendor, setVendor] = useState('')
  const [cost, setCost] = useState('')
  const [notes, setNotes] = useState('')
  // Kept between saves on purpose: a multi-page yard invoice is entered as several jobs in a row.
  const [documentId, setDocumentId] = useState<number | null>(null)
  const [outcome, setOutcome] = useState<CompletionOutcome | null>(null)
  const [eventKind, setEventKind] = useState('')
  const [evidence, setEvidence] = useState('')
  const [followOns, setFollowOns] = useState<FollowOnDraft[]>([blankFollowOn()])
  const [saved, setSaved] = useState<{ text: string; system: string } | null>(null)

  const canSave = system && what.trim() && when && !add.isPending

  const save = () => {
    if (!canSave) return
    const parsedCost = documentId !== null || cost.trim() === '' ? null : Number(cost)
    if (parsedCost !== null && !Number.isFinite(parsedCost)) return
    setSaved(null)
    add.mutate({
      system,
      what_was_done: what.trim(),
      completed_on: when,
      performed_by: performedBy.trim() || null,
      vendor: vendor.trim() || null,
      cost: parsedCost,
      notes: notes.trim() || null,
      document_id: documentId,
      outcome,
      event_kind: eventKind || null,
      evidence_path: evidence.trim() || null,
      follow_ons: needsFollowOn(outcome) ? followOnsToSend(followOns) : null,
    }, {
      onSuccess: () => {
        const n = needsFollowOn(outcome) ? followOnsToSend(followOns).length : 0
        setSaved({
          text: `${what.trim()} (${when})${n ? ` + ${n} follow-on task${n === 1 ? '' : 's'}` : ''}.`,
          system,
        })
        setWhat(''); setPerformedBy(''); setVendor(''); setCost(''); setNotes(''); setEvidence('')
        setOutcome(null); setFollowOns([blankFollowOn()])
      },
    })
  }

  return (
    <div className="historical-form">
      <p className="mgmt-status">
        For work this app never saw - a yard invoice, the rigger, anything from before it
        existed. It joins the same append-only history and <strong>changes no schedule</strong>.
        If the work was really one of the boat&rsquo;s tracked tasks, complete that task with an
        old date instead, so its next due date moves.
      </p>

      <div className="historical-form-row">
        {/* A record files under whichever level (system or device) the work belongs to. */}
        <SystemPicker value={system} systems={systems ?? []} onChange={setSystem} />
        <label>
          Date it was done
          <input type="date" value={when} max={todayLocal()}
            onChange={(e) => setWhen(e.target.value)} />
        </label>
      </div>

      <label>
        What was done
        <input
          value={what} placeholder="e.g. Full standing rigging replacement"
          onChange={(e) => setWhat(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save() } }}
        />
      </label>

      <div className="historical-form-row">
        <PerformedByField
          value={performedBy}
          onChange={setPerformedBy}
          hint="(shown on the report)"
        />
        <label>
          Vendor / invoice <span className="hint">(kept private)</span>
          <input value={vendor} placeholder="e.g. Harbor Rigging (inv 1234)"
            onChange={(e) => setVendor(e.target.value)} />
        </label>
        <div className="search-pick-field">
          <span>Paid under invoice <span className="hint">(one invoice, many jobs)</span></span>
          <InvoicePick
            value={documentId}
            noneLabel="— none / own cost —"
            onPick={(id) => { setDocumentId(id); if (id !== null) setCost('') }}
          />
        </div>
        <label>
          Cost <span className="hint">(kept private)</span>
          <input type="number" min="0" step="0.01" value={cost}
            placeholder={documentId !== null ? 'on the invoice' : 'optional'} disabled={documentId !== null}
            title={documentId !== null ? 'The invoice carries the money - a job has its own cost OR an invoice, never both' : undefined}
            onChange={(e) => setCost(e.target.value)} />
        </label>
      </div>

      <div className="historical-form-row">
        <label>
          Kind of event
          <select value={eventKind} onChange={(e) => setEventKind(e.target.value)}>
            <option value="">Service / repair</option>
            {Object.entries(EVENT_KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label>
          Evidence on file <span className="hint">(path to the photo / PDF, optional)</span>
          <input value={evidence} placeholder="e.g. C:\Boat\Paperwork\haulout-2026.pdf"
            onChange={(e) => setEvidence(e.target.value)} />
        </label>
      </div>

      <label>
        Notes
        <textarea rows={2} value={notes}
          placeholder="What was actually done, what is still outstanding…"
          onChange={(e) => setNotes(e.target.value)} />
      </label>

      <OutcomePicker value={outcome} onChange={setOutcome} />
      {needsFollowOn(outcome) && (
        <FollowOnEditor rows={followOns} onChange={setFollowOns} jobSystem={system || null} />
      )}

      <p className="mgmt-status historical-form-privacy">
        Vendor and cost stay off the printed report unless it is asked for them explicitly -
        what the boat had done and what it cost are different things to hand someone.
      </p>

      <div className="historical-form-actions">
        <button type="button" onClick={save} disabled={!canSave}>
          {add.isPending ? 'Recording…' : '📗 Record it'}
        </button>
        <button type="button" onClick={onDone}>Done</button>
      </div>

      {saved && (
        <p className="mgmt-status">
          ✅ Recorded under{' '}
          <RecordLink to={saved.system ? { kind: 'system', name: saved.system } : null}>{saved.system}</RecordLink>
          : {saved.text} Add another, or press Done.
        </p>
      )}
      {add.isError && <p className="mgmt-status mgmt-status--error">{errorText(add.error)}</p>}
    </div>
  )
}

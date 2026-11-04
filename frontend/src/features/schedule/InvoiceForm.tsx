/**
 * Purpose: Record or edit one invoice / receipt on file - the SPINE of the paper only: vendor,
 *   number, date (or the period a refit spans), the total ONCE, where the PDF is, the project
 *   and a free-text expense class. Line items are deliberately not transcribed.
 * Version: v2 (2026-09-23) - v2 (tracker #76, no-detour): "＋ New project…" is the first choice
 *   in the project select (one-line name box, POST /projects, kind 'other', then selected);
 *   optional onCreated(id, label) + initialVendor so the form can be opened INLINE from an invoice
 *   pick list; exports InvoicePick - the type-to-search invoice picker with "＋ New invoice…" as
 *   the first row (used by HistoricalRecordForm and CompletionLog's file-under control).
 *   v1 (2026-09-22).
 * Scope: PRODUCTION - mx-inv frontend, schedule feature.
 * Architecture: Rendered by InvoicesPanel (the Log tab's "🧾 Invoices on file" view), and inline
 *   inside InvoicePick when a job's invoice is not on file yet. Saves via
 *   POST / PUT /api/documents (data.create_document / update_document, schema v33). The
 *   expense-class box is a <datalist> fed by GET /api/documents/expense-classes - every class
 *   already used, so the spelling stays stable - and still accepts anything typed, because the
 *   classes have to match whatever goes on the return (design/INVOICE_DOCUMENTS_DESIGN.md).
 */
import { useId, useState } from 'react'
import type { InvoiceDocument } from '../../api/types'
import { useProjects } from '../projects/useProjects'
import { useCreateProject } from '../projects/mutations'
import { SearchPick } from '../../components/SearchPick'
import {
  type DocumentFields, documentLabel, errorText, money, useDocuments, useExpenseClasses, useSaveDocument,
} from './useDocuments'

const blank = (s: string) => (s.trim() === '' ? null : s.trim())

const NEW = '__new__'

export function InvoiceForm({
  existing, onDone, onCreated, initialVendor,
}: {
  existing: InvoiceDocument | null
  /** Cancel - and, when onCreated is not given, also called after a save. */
  onDone: () => void
  /** A NEW invoice was saved: its id and pick-list label (instead of onDone). */
  onCreated?: (documentId: number, label: string) => void
  initialVendor?: string
}) {
  const save = useSaveDocument()
  const { data: projects } = useProjects()
  const createProject = useCreateProject()
  const [newProject, setNewProject] = useState<string | null>(null)
  const { data: classes } = useExpenseClasses()
  const listId = `expense-classes-${useId()}`

  const [vendor, setVendor] = useState(existing?.vendor ?? initialVendor ?? '')
  const [number, setNumber] = useState(existing?.doc_number ?? '')
  const [date, setDate] = useState(existing?.doc_date ?? '')
  const [spansPeriod, setSpansPeriod] = useState(Boolean(existing?.period_start || existing?.period_end))
  const [start, setStart] = useState(existing?.period_start ?? '')
  const [end, setEnd] = useState(existing?.period_end ?? '')
  const [total, setTotal] = useState(existing?.total == null ? '' : String(existing.total))
  const [path, setPath] = useState(existing?.file_path ?? '')
  const [projectId, setProjectId] = useState(existing?.project_id == null ? '' : String(existing.project_id))
  const [expenseClass, setExpenseClass] = useState(existing?.expense_class ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')

  const parsedTotal = total.trim() === '' ? null : Number(total)
  const totalOk = parsedTotal === null || Number.isFinite(parsedTotal)
  const hasDate = Boolean(date || (spansPeriod && (start || end)))
  const canSave = vendor.trim() !== '' && hasDate && totalOk && !save.isPending

  const submit = () => {
    if (!canSave) return
    const fields: DocumentFields = {
      vendor: vendor.trim(),
      doc_number: blank(number),
      doc_date: blank(date),
      period_start: spansPeriod ? blank(start) : null,
      period_end: spansPeriod ? blank(end) : null,
      total: parsedTotal,
      file_path: blank(path),
      project_id: projectId === '' ? null : Number(projectId),
      expense_class: blank(expenseClass),
      notes: blank(notes),
    }
    save.mutate({ id: existing?.document_id ?? null, fields }, {
      onSuccess: (res) => {
        if (!existing && onCreated) {
          onCreated(res.document_id, documentLabel({
            vendor: fields.vendor, doc_number: fields.doc_number,
            doc_day: fields.doc_date ?? fields.period_start ?? fields.period_end,
          }))
        } else onDone()
      },
    })
  }

  const addProject = () => {
    const name = (newProject ?? '').trim()
    if (!name) return
    createProject.mutate({ name, kind: 'other' }, {
      onSuccess: (res) => { setProjectId(String((res as { project_id: number }).project_id)); setNewProject(null) },
    })
  }

  return (
    <div className="historical-form invoice-form">
      <p className="mgmt-status">
        The spine of the paper only - who, when, the total once, and where the PDF is. Don&rsquo;t
        type the line items: the PDF is already searchable. One invoice can cover many jobs; file
        the jobs under it from the Log.
      </p>
      <div className="historical-form-row">
        <label>
          Vendor
          <input value={vendor} autoFocus placeholder="e.g. Harbor Marine Service"
            onChange={(e) => setVendor(e.target.value)} />
        </label>
        <label>
          Invoice no.
          <input value={number} placeholder="optional" onChange={(e) => setNumber(e.target.value)} />
        </label>
        <label>
          Invoice date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>

      <label className="invoice-form-check">
        <input type="checkbox" checked={spansPeriod} onChange={(e) => setSpansPeriod(e.target.checked)} />
        {' '}Covers a period of work (a refit spanning weeks)
      </label>
      {spansPeriod && (
        <div className="historical-form-row">
          <label>
            Work from
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label>
            to
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
      )}

      <div className="historical-form-row">
        <label>
          Total
          <input type="number" step="0.01" value={total} placeholder="the invoice total"
            onChange={(e) => setTotal(e.target.value)} />
        </label>
        <label>
          Expense class <span className="hint">(your words - offered back next time)</span>
          <input list={listId} value={expenseClass} placeholder="e.g. Repairs"
            onChange={(e) => setExpenseClass(e.target.value)} />
          <datalist id={listId}>
            {(classes ?? []).map((c) => <option key={c.name} value={c.name}>{`used ${c.uses}×`}</option>)}
          </datalist>
        </label>
        {newProject !== null ? (
          <div className="search-pick-field">
            <span>New project</span>
            <div className="system-picker-new">
              <input
                autoFocus value={newProject} placeholder="Project name"
                onChange={(e) => setNewProject(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); addProject() }
                  if (e.key === 'Escape') { e.preventDefault(); setNewProject(null) }
                }}
              />
              <button type="button" onClick={addProject} disabled={!newProject.trim() || createProject.isPending}>✓</button>
              <button type="button" onClick={() => setNewProject(null)}>✕</button>
              {createProject.isError && <span className="mgmt-status mgmt-status--error">{errorText(createProject.error)}</span>}
            </div>
          </div>
        ) : (
          <label>
            Project
            <select value={projectId} onChange={(e) => { if (e.target.value === NEW) setNewProject(''); else setProjectId(e.target.value) }}>
              <option value={NEW}>＋ New project…</option>
              <option value="">— none —</option>
              {(projects ?? []).map((p) => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
            </select>
          </label>
        )}
      </div>

      <label>
        Where the PDF is <span className="hint">(a file path on this computer)</span>
        <input value={path} placeholder="e.g. C:\Boat\Invoices\engine-service-2026.pdf"
          onChange={(e) => setPath(e.target.value)} />
      </label>
      <label>
        Notes
        <textarea rows={2} value={notes} placeholder="What it covers; anything not delivered…"
          onChange={(e) => setNotes(e.target.value)} />
      </label>

      <div className="historical-form-actions">
        <button type="button" onClick={submit} disabled={!canSave}>
          {save.isPending ? 'Saving…' : existing ? '💾 Save changes' : '📄 Add invoice'}
        </button>
        <button type="button" onClick={onDone}>Cancel</button>
        {!hasDate && <span className="hint">Give the invoice date or the period it covers.</span>}
        {!totalOk && <span className="hint">The total must be a number.</span>}
      </div>
      {save.isError && <p className="mgmt-status mgmt-status--error">{errorText(save.error)}</p>}
    </div>
  )
}

/**
 * Pick the invoice on file a job was paid under - type to find (vendor, number, date), "＋ New
 * invoice…" first: the invoice form opens right here and the new invoice comes back picked
 * (tracker #76 - no more "add one under Invoices on file first").
 */
export function InvoicePick({
  value, onPick, noneLabel = '— none —', disabled,
}: {
  value: number | null
  onPick: (documentId: number | null) => void
  noneLabel?: string
  disabled?: boolean
}) {
  const { data: docs } = useDocuments()
  return (
    <SearchPick<InvoiceDocument>
      options={docs ?? []}
      keyOf={(d) => d.document_id}
      labelOf={(d) => documentLabel(d)}
      hintOf={(d) => [d.total !== null ? money(d.total) : null, d.expense_class].filter(Boolean).join(' · ')}
      value={value}
      onPick={(k) => onPick(k === null ? null : Number(k))}
      placeholder="Type a vendor, invoice no. or date…"
      noneLabel={noneLabel}
      disabled={disabled}
      newLabel={(t) => (t ? `＋ New invoice from “${t}”…` : '＋ New invoice…')}
      renderNew={(typed, done, cancel) => (
        <InvoiceForm existing={null} initialVendor={typed} onDone={cancel} onCreated={(id, label) => done(id, label)} />
      )}
    />
  )
}

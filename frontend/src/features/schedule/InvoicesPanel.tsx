/**
 * Purpose: "Invoices on file" - one year's vendor invoices / receipts grouped by expense class
 *   with a subtotal each, the CSV export, and add / edit / delete of an invoice.
 * Version: v2 (2026-09-23) - v2: an invoice's project name opens the project (tracker #74).
 *   v1 was 2026-09-22.
 * Scope: PRODUCTION - mx-inv frontend, schedule feature.
 * Architecture: Rendered by CompletionLog (the "🧾 Log" tab) as its second view. Reads
 *   GET /api/documents/years and /api/documents/year/{year} (data.documents_year_view, schema
 *   v33); the CSV link is GET /api/documents/year/{year}/csv. Forms via InvoiceForm.
 *
 * WORDING IS THE FEATURE (design/INVOICE_DOCUMENTS_DESIGN.md): the card / bank statement is the
 * financial authority and this is not a ledger. Every figure is headed "invoices on file", with
 * a plain count of what has been indexed and how many have no total - never "total spend" or
 * "year total". No tax advice, no tax categories supplied: the classes are the owner's words.
 */
import { useState } from 'react'
import type { InvoiceDocument } from '../../api/types'
import { useConfirm } from '../../components/ConfirmDialog'
import { InvoiceForm } from './InvoiceForm'
import { RecordLink } from '../../components/RecordLink'
import { errorText, money, useDeleteDocument, useDocumentYearView, useDocumentYears } from './useDocuments'

export function InvoicesPanel() {
  const { data: years } = useDocumentYears()
  const [picked, setPicked] = useState<number | null>(null)
  const year = picked ?? years?.[0] ?? null
  const { data: view, isLoading } = useDocumentYearView(year)
  const [editing, setEditing] = useState<InvoiceDocument | 'new' | null>(null)
  const del = useDeleteDocument()
  const confirm = useConfirm()

  const remove = async (d: InvoiceDocument) => {
    const ok = await confirm({
      title: 'Remove this invoice from the index?',
      message: `${d.vendor}${d.doc_number ? ` #${d.doc_number}` : ''} - only the index entry goes; the PDF on disk is untouched.`,
      confirmLabel: 'Remove',
    })
    if (ok) del.mutate(d.document_id)
  }

  return (
    <div className="invoices-panel">
      <p className="schedule-bucket-caption">
        The paper behind the work: vendor invoices and receipts, one entry per piece of paper with
        its total stored once. This is an <strong>index</strong>, not the books - the card and bank
        statements are the authority, and every figure here is only what is <em>on file</em>.
        File the jobs an invoice paid for from the Log (&ldquo;📄 File under invoice&rdquo;).
      </p>

      <div className="completion-log-filters">
        <label className="completion-log-range">
          Year{' '}
          <select value={year ?? ''} onChange={(e) => setPicked(Number(e.target.value))}
            disabled={!years || years.length === 0}>
            {(years ?? []).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => setEditing(editing === 'new' ? null : 'new')}>
          {editing === 'new' ? 'Close' : '＋ Invoice'}
        </button>
        {year !== null && view && view.count > 0 && (
          <a className="completion-log-report" href={`/api/documents/year/${year}/csv`}
            title="One row per invoice on file, to sit beside the card summary in a spreadsheet">
            ⬇️ CSV for {year}
          </a>
        )}
        <a className="completion-log-report" href="/api/report/history?cost=1" target="_blank" rel="noreferrer"
          title="The whole-vessel service history WITH costs, vendors and the invoices section - for your own records, not for handing to a buyer">
          🖨️ History report with invoices
        </a>
      </div>

      {editing === 'new' && <InvoiceForm existing={null} onDone={() => setEditing(null)} />}
      {del.isError && <p className="mgmt-status mgmt-status--error">{errorText(del.error)}</p>}

      {years && years.length === 0 && editing !== 'new' && (
        <p className="bucket-empty">No invoices on file yet.</p>
      )}
      {isLoading && <p className="schedule-status">Loading…</p>}

      {view && view.count > 0 && (
        <>
          <p className="completion-summary">
            <strong>Invoices on file for {view.year}:</strong> {view.count} indexed, totalling{' '}
            {money(view.on_file)}
            {view.untotalled > 0 && <> ({view.untotalled} with no total entered)</>}. Not a year
            total - only what has been indexed so far.
          </p>
          {view.classes.map((g) => (
            <div key={g.expense_class} className="completion-day invoice-class">
              <h4>
                {g.expense_class}{' '}
                <span className="completion-count">
                  ({g.count} on file · {money(g.subtotal)}
                  {g.untotalled > 0 && `, ${g.untotalled} untotalled`})
                </span>
              </h4>
              <ul>
                {g.documents.map((d) => (
                  editing !== 'new' && editing?.document_id === d.document_id ? (
                    <li key={d.document_id}><InvoiceForm existing={d} onDone={() => setEditing(null)} /></li>
                  ) : (
                    <InvoiceRow key={d.document_id} d={d}
                      onEdit={() => setEditing(d)} onRemove={() => remove(d)} />
                  )
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function InvoiceRow({ d, onEdit, onRemove }: { d: InvoiceDocument; onEdit: () => void; onRemove: () => void }) {
  const when = d.doc_date
    ?? [d.period_start, d.period_end].filter(Boolean).join(' – ')
  return (
    <li className="completion-row invoice-row">
      <div className="completion-line">
        <span className="completion-time">{when}</span>
        <span className="completion-title">
          <strong>{d.vendor}</strong>{d.doc_number && <> #{d.doc_number}</>}
        </span>
        <span className="completion-meta">
          · {d.total === null ? <em>no total</em> : money(d.total)}
        </span>
        {d.project_name && (
          <span className="completion-meta">
            · project:{' '}
            <RecordLink to={d.project_id !== null ? { kind: 'project', id: d.project_id } : null}>{d.project_name}</RecordLink>
          </span>
        )}
        <span className="completion-meta" title="Live history entries filed under this invoice">
          · {d.completion_count === 0 ? 'no work filed' : `${d.completion_count} job${d.completion_count === 1 ? '' : 's'} filed`}
        </span>
        <button type="button" className="completion-void-btn" onClick={onEdit}>Edit</button>
        <button type="button" className="completion-void-btn" onClick={onRemove}
          disabled={d.completion_count > 0}
          title={d.completion_count > 0 ? 'Detach the jobs filed under it first' : 'Remove from the index'}>
          Remove
        </button>
      </div>
      {d.file_path && <p className="completion-notes">📎 {d.file_path}</p>}
      {d.notes && <p className="completion-notes">📝 {d.notes}</p>}
    </li>
  )
}

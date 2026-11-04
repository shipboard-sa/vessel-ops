/**
 * Purpose: Data hooks for invoices / receipts on file (schema v33) - list, one year's view,
 *   expense-class suggestions, and the create / update / delete / file-under mutations.
 * Version: v1 (2026-09-22)
 * Scope: PRODUCTION - mx-inv frontend, schedule feature.
 * Architecture: Used by InvoicesPanel, InvoiceForm, HistoricalRecordForm and CompletionLog's
 *   "file under invoice" control. Reads/writes /api/documents/* (backend/routers/documents.py)
 *   and PUT /api/tasks/completions/{id}/document. Every mutation invalidates both
 *   ['documents'] and ['completions'] (a filed entry shows its invoice on the Log).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiSend } from '../../api/client'
import type { InvoiceDocument, InvoiceYearView } from '../../api/types'

export interface ExpenseClassChoice { name: string; uses: number }

export interface DocumentFields {
  vendor: string
  doc_number: string | null
  doc_date: string | null
  period_start: string | null
  period_end: string | null
  total: number | null
  file_path: string | null
  project_id: number | null
  expense_class: string | null
  notes: string | null
}

export function useDocuments() {
  return useQuery({
    queryKey: ['documents', 'all'],
    queryFn: () => apiGet<InvoiceDocument[]>('/documents'),
  })
}

export function useDocumentYears() {
  return useQuery({
    queryKey: ['documents', 'years'],
    queryFn: () => apiGet<number[]>('/documents/years'),
  })
}

export function useDocumentYearView(year: number | null) {
  return useQuery({
    queryKey: ['documents', 'year', year],
    queryFn: () => apiGet<InvoiceYearView>(`/documents/year/${year}`),
    enabled: year !== null,
  })
}

export function useExpenseClasses() {
  return useQuery({
    queryKey: ['documents', 'expense-classes'],
    queryFn: () => apiGet<ExpenseClassChoice[]>('/documents/expense-classes'),
  })
}

function useDocMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const queryClient = useQueryClient()
  return useMutation<TResult, Error, TVars>({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      queryClient.invalidateQueries({ queryKey: ['completions'] })
    },
  })
}

export function useSaveDocument() {
  return useDocMutation(({ id, fields }: { id: number | null; fields: DocumentFields }) =>
    id === null
      ? apiSend<{ document_id: number }>('POST', '/documents', fields)
      : apiSend<{ ok: boolean }>('PUT', `/documents/${id}`, fields).then(() => ({ document_id: id })),
  )
}

export function useDeleteDocument() {
  return useDocMutation((id: number) => apiSend<{ ok: boolean }>('DELETE', `/documents/${id}`))
}

export function useFileCompletion() {
  return useDocMutation(({ completionId, documentId }: { completionId: number; documentId: number | null }) =>
    apiSend<{ ok: boolean }>('PUT', `/tasks/completions/${completionId}/document`, { document_id: documentId }),
  )
}

/** "Seabrook Marine #4411 (2025-06-30)" - how an invoice is named in a pick list. */
export function documentLabel(d: Pick<InvoiceDocument, 'vendor' | 'doc_number' | 'doc_day'>): string {
  return `${d.vendor}${d.doc_number ? ` #${d.doc_number}` : ''}${d.doc_day ? ` (${d.doc_day})` : ''}`
}

export function money(n: number): string {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

export function errorText(e: unknown): string {
  const detail = (e as { detail?: { message?: string } } | null)?.detail
  return detail?.message ?? (e as Error).message
}

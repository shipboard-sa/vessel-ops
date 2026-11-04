/**
 * Purpose: Cockpit (tablet) checklist runner - pick a checklist, tick its steps, open a step's details.
 * Version: v3 (2026-10-04) - v3 (cockpit production pass): the picker reads the ~20 KB
 *   GET /tasks/checklists (retired ones left out) instead of the ~870 KB GET /tasks, and shows
 *   a run in progress; load failures say so in plain words with a Retry button; "Finish run"
 *   waits for the steps to load, asks before logging (a stray wet tap logged and reset the
 *   whole run), and shows a failed finish instead of doing nothing.
 *   v2 (2026-09-23): ChecklistSteps runs readOnly here (tick-only). v1 2026-09-17.
 * Scope: PRODUCTION - mx-inv /cockpit UI.
 * Architecture: Reuses management/ChecklistSteps + StepDetail (canEdit false) with cockpit styling
 *   (CockpitApp.css); no AppNav here, so record names render as plain text. ChecklistRunPanel is
 *   exported for WatchHandover.
 */
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ChecklistSummary } from '../../api/types'
import { useChecklistItems } from '../management/useTasks'
import { useFinishChecklistRun } from '../management/mutations'
import { ChecklistSteps } from '../management/ChecklistSteps'
import { StepDetail } from '../management/StepDetail'
import { useConfirm } from '../../components/ConfirmDialog'
import { useCockpitChecklists } from './useCockpit'
import { LoadError, friendlyError } from './CockpitBits'

export function CockpitChecklists({ onHome }: { onHome: () => void }) {
  const { data: checklists, isLoading, isError, error, refetch } = useCockpitChecklists()
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const selected = checklists?.find((t) => t.task_id === selectedId) ?? null
  if (selected) return <ChecklistRunPanel checklist={selected} onBack={() => setSelectedId(null)} />

  return (
    <div className="cockpit-checklist-picker">
      <div className="cockpit-panel-header">
        <button type="button" className="cockpit-back" onClick={onHome}>← Back</button>
        <h2>☑️ Run a Checklist</h2>
      </div>
      {isLoading && <p className="cockpit-status">Loading checklists…</p>}
      {isError && !checklists && <LoadError what="the checklists" error={error} onRetry={() => refetch()} />}
      {checklists && (
        <ul className="cockpit-tap-list">
          {checklists.length === 0 && <li className="cockpit-status">No checklists yet - add them in Management on the desktop app.</li>}
          {checklists.map((c) => (
            <li key={c.task_id}>
              <button type="button" className="cockpit-tap-item" onClick={() => setSelectedId(c.task_id)}>
                <span className="cockpit-tap-item-name">{c.task_name}</span>
                <span className="cockpit-tap-item-meta">{pickerMeta(c)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function pickerMeta(c: ChecklistSummary): string {
  const ticked = (c.step_count ?? 0) - (c.open_step_count ?? 0)
  const last = c.last_completed_date ? `last run ${c.last_completed_date}` : 'never run'
  return ticked > 0 ? `${last} · in progress (${ticked} of ${c.step_count} steps ticked)` : last
}

// Exported so WatchHandover can drop straight into running a specific
// checklist (Watch Handover Checklist) without going through the picker.
export function ChecklistRunPanel({
  checklist, onBack,
}: { checklist: { task_id: number; task_name: string }; onBack: () => void }) {
  const finishRun = useFinishChecklistRun()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  // Same query (and cache entry) ChecklistSteps renders from - read here for the open count.
  const items = useChecklistItems(checklist.task_id)
  const [justFinished, setJustFinished] = useState(false)
  // A step's Details (how to, what you need, where it is stowed) replaces the run screen; read-only
  // here - the helm tablet is for looking, not restructuring the data (tracker #28).
  const [stepId, setStepId] = useState<number | null>(null)

  if (stepId !== null) {
    return (
      <div className="cockpit-checklist-run">
        <div className="cockpit-panel-header">
          <button type="button" className="cockpit-back" onClick={() => setStepId(null)}>← Back</button>
          <h2>{checklist.task_name}</h2>
        </div>
        <StepDetail taskId={stepId} canEdit={false} />
      </div>
    )
  }

  const finish = async () => {
    const open = (items.data ?? []).filter((s) => !s.done).length
    const ok = await confirm({
      title: `Finish "${checklist.task_name}"?`,
      message: (open > 0 ? `${open} step${open === 1 ? ' is' : 's are'} still not ticked.\n` : '') +
        'This logs the run as complete today and clears every tick, ready for next time.',
      confirmLabel: 'Finish and log it',
      cancelLabel: 'Not yet',
    })
    if (!ok) return
    finishRun.mutate(checklist.task_id, {
      onSuccess: () => {
        setJustFinished(true)
        queryClient.invalidateQueries({ queryKey: ['cockpit-checklists'] })
      },
    })
  }

  return (
    <div className="cockpit-checklist-run">
      <div className="cockpit-panel-header">
        <button type="button" className="cockpit-back" onClick={onBack}>← Back</button>
        <h2>{checklist.task_name}</h2>
      </div>

      {justFinished ? (
        <>
          <p className="cockpit-status cockpit-status--done">
            ✅ Logged as complete and reset - ready to run again next time.
          </p>
          <button type="button" className="cockpit-big-button" onClick={onBack}>← Back</button>
        </>
      ) : (
        <>
          {items.isError && !items.data && (
            <LoadError what="the steps" error={items.error} onRetry={() => items.refetch()} />
          )}
          <ChecklistSteps checklistId={checklist.task_id} onOpenStep={setStepId} readOnly />
          {finishRun.isError && (
            <p className="cockpit-status cockpit-status--error" role="alert">
              Not finished - {friendlyError(finishRun.error)}
            </p>
          )}
          <button
            type="button"
            className="cockpit-primary-action"
            onClick={finish}
            disabled={finishRun.isPending || !items.data}
          >
            {finishRun.isPending ? 'Finishing…' : '✅ Finish run'}
          </button>
        </>
      )}
    </div>
  )
}

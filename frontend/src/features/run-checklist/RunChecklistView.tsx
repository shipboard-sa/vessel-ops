/**
 * Purpose: "Run a Checklist" tab - pick a checklist, then work it step by step in a focused view.
 * Version: v2 (2026-09-23) - v2: an AppNav origin - a record named in a step (its full task record,
 *   system, a part) opens on its own tab and Back returns to the same checklist and step (#74).
 * Scope: PRODUCTION - mx-inv frontend, run-checklist feature.
 * Architecture: Rendered by App.tsx. ChecklistSteps (management/) renders the ticks; a step's
 *   Details is StepDetail in a FocusScreen. The picked checklist + step trail ride in the
 *   ReturnTarget (extra / trail) so a cross-tab trip can rebuild the screen.
 */
import { useEffect, useState } from 'react'
import { NavScopeProvider, useReturnRestore } from '../../components/AppNav'
import type { RawTask } from '../../api/types'
import { useTasks } from '../management/useTasks'
import { useFinishChecklistRun } from '../management/mutations'
import { ChecklistSteps } from '../management/ChecklistSteps'
import { StepDetail } from '../management/StepDetail'
import { FocusScreen, useFocusTrail } from '../../components/FocusScreen'
import { RecordLink } from '../../components/RecordLink'
import './RunChecklistView.css'

export function RunChecklistView() {
  const { data: tasks, isLoading, isError, error } = useTasks()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [restoreTrail, setRestoreTrail] = useState<number[] | null>(null)
  useReturnRestore('run-checklist', (r) => {
    if (typeof r.extra === 'number') setSelectedId(r.extra)
    setRestoreTrail((r.trail as number[] | undefined) ?? null)
  })

  if (isLoading) return <p className="mgmt-status">Loading checklists…</p>
  if (isError) return <p className="mgmt-status mgmt-status--error">{(error as Error).message}</p>
  if (!tasks) return null

  const checklists = tasks
    .filter((t) => t.task_kind === 'checklist' && t.parent_task_id === null)
    .sort((a, b) => a.task_name.localeCompare(b.task_name))

  const selected = checklists.find((t) => t.task_id === selectedId) ?? null

  return selected
    ? <ChecklistRun checklist={selected} onBack={() => setSelectedId(null)} initialTrail={restoreTrail} />
    : <ChecklistPicker checklists={checklists} onPick={setSelectedId} />
}

function ChecklistPicker({
  checklists, onPick,
}: { checklists: RawTask[]; onPick: (id: number) => void }) {
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()
  const filtered = q
    ? checklists.filter((c) => c.task_name.toLowerCase().includes(q) || c.system.toLowerCase().includes(q))
    : checklists

  return (
    <div className="run-checklist-picker">
      <h2>▶ Run a Checklist</h2>
      <p className="mgmt-status">Pick one to run - the screen focuses on just that checklist while you work it.</p>
      <input
        type="text"
        placeholder="🔍 Search checklists"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <ul className="run-checklist-list">
        {filtered.length === 0 && <li className="mgmt-empty">No checklists match.</li>}
        {filtered.map((c) => (
          <li key={c.task_id} onClick={() => onPick(c.task_id)}>
            <span className="run-checklist-name">{c.task_name}</span>
            <span className="run-checklist-meta">
              {c.last_completed_date ? `last run ${c.last_completed_date}` : 'never run'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ChecklistRun({
  checklist, onBack, initialTrail,
}: { checklist: RawTask; onBack: () => void; initialTrail: number[] | null }) {
  const finishRun = useFinishChecklistRun()
  const [justFinished, setJustFinished] = useState(false)
  // A step's Details opens as a focus screen (Back returns to the run; the ticks live on the server).
  const focus = useFocusTrail<number>()
  const { data: tasks } = useTasks()
  useEffect(() => {
    if (initialTrail?.length) focus.openPath(initialTrail)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTrail])
  const scope = {
    origin: () => ({ tab: 'run-checklist' as const, trail: focus.trail, extra: checklist.task_id }),
  }

  return (
    <NavScopeProvider scope={scope}>
      {focus.current !== null && (
        <FocusScreen
          focus={focus} listLabel={checklist.task_name}
          labelOf={(id) => tasks?.find((t) => t.task_id === id)?.task_name ?? 'step'}
        >
          <StepDetail taskId={focus.current} canEdit />
        </FocusScreen>
      )}
      <div hidden={focus.current !== null}>
    <div className="run-checklist-focus">
      <div className="run-checklist-header">
        <button type="button" className="link-button" onClick={onBack}>← Back to checklist list</button>
        <h2>{checklist.task_name}</h2>
        <p className="mgmt-status">
          <RecordLink to={{ kind: 'system', name: checklist.system }}><code>{checklist.system}</code></RecordLink>
          {checklist.last_completed_date && ` · last run ${checklist.last_completed_date}`}
        </p>
      </div>

      {justFinished ? (
        <p className="run-checklist-done">
          ✅ Logged as complete and reset - ready to run again next time.
        </p>
      ) : (
        <>
          <ChecklistSteps checklistId={checklist.task_id} onOpenStep={focus.open} />
          <button
            type="button"
            className="run-checklist-finish"
            onClick={() => finishRun.mutate(checklist.task_id, { onSuccess: () => setJustFinished(true) })}
            disabled={finishRun.isPending}
          >
            {finishRun.isPending ? 'Finishing…' : '✅ Finish run (completes + closes every step, then resets for next time)'}
          </button>
        </>
      )}
    </div>
      </div>
    </NavScopeProvider>
  )
}

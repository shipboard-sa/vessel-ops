/**
 * Purpose: One phase's heading on the project screen - name, target dates,
 *   task counts, move up/down, and an inline editor (name, dates, notes,
 *   delete). Also the "+ Add phase" form at the end of the plan.
 * Version: v1 (2026-09-19)
 * Scope: PRODUCTION - mx-inv frontend, projects feature.
 * Architecture: Child of ProjectScreen.tsx, which owns the phase list and the
 *   task groups; calls projects/mutations (useUpdatePhase, useDeletePhase,
 *   useCreatePhase). Phases are the per-project stage list from schema v23 -
 *   a phase is a bucket with notes, not a scheduler.
 */
import { useState } from 'react'
import type { ProjectPhase } from '../../api/types'
import { useConfirm } from '../../components/ConfirmDialog'
import {
  errorText, useCreatePhase, useDeletePhase, useUpdatePhase,
} from './mutations'

export function PhaseHeader({
  phase, onMoveUp, onMoveDown,
}: {
  phase: ProjectPhase
  onMoveUp: (() => void) | undefined
  onMoveDown: (() => void) | undefined
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(phase.name)
  const [notes, setNotes] = useState(phase.notes ?? '')
  const [start, setStart] = useState(phase.target_start ?? '')
  const [end, setEnd] = useState(phase.target_end ?? '')
  const update = useUpdatePhase()
  const remove = useDeletePhase()
  const confirm = useConfirm()

  const dates = [phase.target_start, phase.target_end].filter(Boolean).join(' → ')

  return (
    <div className="phase-header">
      <div className="phase-header-row">
        <span className="step-reorder">
          <button type="button" title="Move phase up" disabled={!onMoveUp} onClick={onMoveUp}>▲</button>
          <button type="button" title="Move phase down" disabled={!onMoveDown} onClick={onMoveDown}>▼</button>
        </span>
        <h4 className="phase-title">{phase.name}</h4>
        <span className="phase-meta">
          {phase.open_count} open / {phase.task_count} task{phase.task_count === 1 ? '' : 's'}
          {dates && ` · ${dates}`}
        </span>
        <button type="button" title="Edit this phase" onClick={() => setEditing((v) => !v)}>
          {editing ? '✕' : '✏️'}
        </button>
      </div>
      {!editing && phase.notes && <p className="phase-notes">{phase.notes}</p>}
      {editing && (
        <div className="phase-edit">
          <div className="project-editor-row">
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Target start
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label>
              Target end
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </div>
          <label>
            Notes
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <div className="project-editor-actions">
            <button
              type="button"
              disabled={update.isPending || !name.trim()}
              onClick={() =>
                update.mutate(
                  {
                    phaseId: phase.phase_id,
                    fields: {
                      name, notes: notes.trim() || null,
                      target_start: start || null, target_end: end || null,
                    },
                  },
                  { onSuccess: () => setEditing(false) },
                )
              }
            >
              {update.isPending ? 'Saving…' : '💾 Save phase'}
            </button>
            <button
              type="button"
              className="danger"
              onClick={async () => {
                if (await confirm({
                  title: `Delete phase "${phase.name}"?`,
                  message: `Its ${phase.task_count} task(s) stay on the project with no phase.`,
                  confirmLabel: 'Delete phase',
                })) remove.mutate(phase.phase_id)
              }}
            >
              🗑 Delete phase
            </button>
            {update.isError && (
              <span className="mgmt-status mgmt-status--error">{errorText(update.error)}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function AddPhaseForm({ projectId }: { projectId: number }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const create = useCreatePhase()

  if (!adding) {
    return (
      <button type="button" className="link-button" onClick={() => setAdding(true)}>
        + Add phase
      </button>
    )
  }
  return (
    <form
      className="phase-add"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return
        create.mutate(
          { projectId, name },
          { onSuccess: () => { setName(''); setAdding(false) } },
        )
      }}
    >
      <input
        autoFocus
        placeholder="New phase name (e.g. Yard work)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button type="submit" disabled={create.isPending || !name.trim()}>Add</button>
      <button type="button" onClick={() => { setAdding(false); setName('') }}>Cancel</button>
      {create.isError && (
        <span className="mgmt-status mgmt-status--error">{errorText(create.error)}</span>
      )}
    </form>
  )
}

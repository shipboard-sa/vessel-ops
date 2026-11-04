/**
 * Purpose: Search-first picker for adding existing, not-yet-on-a-project tasks
 *   to a project (search box + optional system narrow + checkbox list).
 * Version: v2 (2026-09-23)
 *   - v2: each row is a CheckRow - the box picks, the system and the task name each open
 *     their own record (tracker #74).
 * Scope: PRODUCTION - mx-inv frontend, projects feature.
 * Architecture: Child of ProjectScreen.tsx (which supplies the unassigned
 *   task list). Moved verbatim out of ProjectCard.tsx (v2) in the focus-screen
 *   conversion; assigns via projects/mutations useSetTaskProject.
 */
import { useState } from 'react'
import type { RawTask } from '../../api/types'
import { useSetTaskProject } from './mutations'
import { CheckRow, SystemTaskLabel } from '../../components/RecordLink'

// Search-first picker for tasks that aren't on any project yet. (It used to
// open with a *system* dropdown, which read as "pick a system" rather than
// "pick a task" - the owner, 2026-09-18.)
const PICKER_LIMIT = 50

export function AddExistingTasks({ projectId, unassigned }: { projectId: number; unassigned: RawTask[] }) {
  const setTaskProject = useSetTaskProject()
  const [search, setSearch] = useState('')
  const [system, setSystem] = useState('')
  const [picked, setPicked] = useState<Set<number>>(new Set())

  const systems = Array.from(new Set(unassigned.map((t) => t.system))).sort()
  const q = search.trim().toLowerCase()
  const matches = unassigned.filter(
    (t) => (!system || t.system === system)
      && (!q || t.task_name.toLowerCase().includes(q) || t.system.toLowerCase().includes(q)),
  )
  const shown = matches.slice(0, PICKER_LIMIT)

  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  return (
    <div className="add-tasks-picker">
      <h4>Add existing tasks to this project</h4>
      <div className="add-tasks-filters">
        <input
          placeholder="Search tasks by name or system…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={system} onChange={(e) => setSystem(e.target.value)} title="Narrow to one system">
          <option value="">All systems</option>
          {systems.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <p className="mgmt-status">
        {matches.length} task(s) not on any project
        {matches.length > PICKER_LIMIT && ` - showing the first ${PICKER_LIMIT}, narrow the search to see the rest`}
      </p>
      {shown.length > 0 && (
        <ul className="add-tasks-list">
          {shown.map((t) => (
            <li key={t.task_id}>
              <CheckRow
                checked={picked.has(t.task_id)} onToggle={() => toggle(t.task_id)}
                to={null}
                name={<SystemTaskLabel system={t.system} taskId={t.task_id} taskName={t.task_name} />}
              />
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        disabled={picked.size === 0 || setTaskProject.isPending}
        onClick={() => {
          picked.forEach((taskId) => setTaskProject.mutate({ taskId, projectId }))
          setPicked(new Set())
        }}
      >
        Add {picked.size > 0 ? `${picked.size} selected task(s)` : 'selected tasks'}
      </button>
    </div>
  )
}

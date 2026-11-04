/**
 * Purpose: The Management tab - a Tasks list and a Systems list (each light), and one
 *   full-screen focus trail that walks tasks, systems and devices with a breadcrumb.
 * Version: v6 (2026-09-23) - v6: the destination for AppNav task/system opens from any tab
 *   (Back returns there) and a NavScope so record names inside open on this trail (tracker #74).
 *   v5 (2026-09-22): retired tasks (schema v30, tracker #66) are hidden from the task
 *   list behind a "Show retired (N)" toggle and badged 📦 with a struck-through name when shown -
 *   v4 (2026-09-22) restored this view's own trail after AppNav sends the user away and back
 *   (tracker #58) and hands SystemScreen a returnTab/returnTrail to do so - v3 was 2026-09-19
 * Scope: PRODUCTION - mx-inv frontend, management feature.
 * Architecture: Rendered by App.tsx. Owns one useFocusTrail<NavKey> (focusKeys.ts): opening
 *   a task or a system/device repaints the screen (FocusScreen); a task's System link and a
 *   device screen's task rows push onto the same trail, so Back goes ONE level and the
 *   breadcrumb (Systems > Propulsion > Main Engine > a task) jumps to any earlier level.
 *   Lists stay mounted but hidden while a screen is open, so search/filters/expanded systems
 *   survive Back. v3 replaces the old "Manage systems" panel (SystemsAdmin) with the Systems
 *   list + SystemScreen (tracker #32/#36/#37, the owner 2026-09-19).
 */
import { useEffect, useMemo, useState } from 'react'
import { useSystems, useTasks } from './useTasks'
import { TaskDetail } from './TaskDetail'
import { useCreateChecklist, useCreateTask } from './mutations'
import { SystemPicker } from './SystemPicker'
import { SystemsList } from './SystemsList'
import { SystemScreen } from './SystemScreen'
import { CHECKLISTS_SYSTEM } from './housekeeping'
import { navLabel, systemKey, systemPath, taskKey, trailIndexOf, type NavKey } from './focusKeys'
import { FocusScreen, useFocusTrail } from '../../components/FocusScreen'
import { NavScopeProvider, useAnchoredFocus, useReturnRestore, type RecordRef } from '../../components/AppNav'
import type { RawTask } from '../../api/types'
import './ManagementView.css'

type KindFilter = 'all' | 'task' | 'checklist'
type Mode = 'tasks' | 'systems'

export function ManagementView() {
  const { data: tasks, isLoading, isError, error } = useTasks()
  const { data: systems } = useSystems()
  const [mode, setMode] = useState<Mode>('tasks')
  const [search, setSearch] = useState('')
  const [system, setSystem] = useState('all')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  // Retired tasks (v30 / tracker #66) keep their master row for the MX log but are
  // done with - hidden here unless you go looking, which is also the only way to
  // reach one to un-retire it.
  const [showRetired, setShowRetired] = useState(false)
  const focus = useFocusTrail<NavKey>()
  const [showNewTask, setShowNewTask] = useState(false)
  const [showNewChecklist, setShowNewChecklist] = useState(false)
  const { back: backFocus } = focus

  // Another tab opened a task or system/device here (tracker #74): show it; Back from it
  // returns to that tab. A cross-tab open from THIS view came back: restore its trail (#58).
  const shown = useAnchoredFocus(focus, (ref) =>
    ref.kind === 'task' ? [taskKey(ref.id)]
      : ref.kind === 'system' ? systemPath(ref.name, systems ?? [])
        : null)
  useReturnRestore('management', (r) => { if (r.trail) focus.openPath(r.trail as NavKey[]) })

  // Top-level items only - checklist steps and other subtasks are managed
  // inline under their parent, same as the schedule board's own filtering.
  const topLevel = useMemo(
    () => (tasks ?? []).filter((t) => t.parent_task_id === null),
    [tasks],
  )

  const systemNames = useMemo(
    () => Array.from(new Set(topLevel.map((t) => t.system))).filter((s) => s !== CHECKLISTS_SYSTEM).sort(),
    [topLevel],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return topLevel.filter((t) => {
      if (system !== 'all' && t.system !== system) return false
      if (kindFilter === 'checklist' && t.task_kind !== 'checklist') return false
      if (kindFilter === 'task' && t.task_kind === 'checklist') return false
      if (!showRetired && t.retired) return false
      if (q && !t.task_name.toLowerCase().includes(q)) return false
      return true
    })
  }, [topLevel, search, system, kindFilter, showRetired])

  const retiredCount = useMemo(() => topLevel.filter((t) => t.retired).length, [topLevel])

  const current = focus.current
  // Looked up from the full unfiltered list, not just topLevel - a
  // reference can point at a checklist step or project task that the
  // top-level Management list deliberately excludes.
  const selectedTask =
    current?.kind === 'task' ? (tasks ?? []).find((t) => t.task_id === current.id) ?? null : null
  // A focused TASK can vanish (deleted from its own screen) - fall back one level. Systems are
  // deliberately not handled by an effect: after a rename the trail holds the new name a tick
  // before the cache does, so SystemScreen copes with a missing system itself.
  useEffect(() => {
    if (current?.kind === 'task' && tasks && !selectedTask) backFocus()
  }, [current, tasks, selectedTask, backFocus])

  if (isLoading) return <p className="mgmt-status">Loading tasks…</p>
  if (isError) return <p className="mgmt-status mgmt-status--error">{(error as Error).message}</p>
  if (!tasks) return null

  // Following a link to something already on the trail walks BACK to it instead of stacking a
  // duplicate level (task -> its system -> the same task ...).
  const jump = (key: NavKey) => {
    const i = trailIndexOf(focus.trail, key)
    if (i >= 0) focus.goTo(i + 1)
    else focus.push(key)
  }
  const openTask = (id: number) => jump(taskKey(id))
  const openSystem = (name: string) => jump(systemKey(name))
  const scope = {
    origin: () => ({ tab: 'management' as const, trail: focus.trail }),
    openLocal: (ref: RecordRef) => {
      if (ref.kind === 'task') { openTask(ref.id); return true }
      if (ref.kind === 'system') { openSystem(ref.name); return true }
      return false
    },
  }

  return (
    <NavScopeProvider scope={scope}>
    <div className="management-view">
      {current && (
        <FocusScreen
          focus={shown}
          listLabel={mode === 'systems' ? 'Systems' : 'Tasks'}
          labelOf={(k) => navLabel(k, tasks)}
        >
          {selectedTask && (
            <TaskDetail
              key={selectedTask.task_id}
              task={selectedTask as RawTask}
              onClose={shown.back}
              onNavigateToTask={openTask}
              onOpenSystem={openSystem}
            />
          )}
          {current.kind === 'system' && (
            <SystemScreen
              key={current.name}
              name={current.name}
              onOpenTask={openTask}
              onOpenSystem={openSystem}
              onRenamed={(n) => focus.replaceCurrent(systemKey(n))}
              onMoved={(p) =>
                focus.openPath(p ? [systemKey(p), systemKey(current.name)] : [systemKey(current.name)])}
              onDeleted={shown.back}
              returnTab="management"
              returnTrail={focus.trail}
            />
          )}
        </FocusScreen>
      )}

      {/* Kept mounted (just hidden) while a screen is open, so search text, filters and
          which systems are expanded are exactly as left when you come Back. */}
      <div hidden={!!current}>
        <div className="mgmt-mode-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'tasks'}
            className={mode === 'tasks' ? 'active' : ''} onClick={() => setMode('tasks')}>
            🛠️ Tasks &amp; checklists
          </button>
          <button type="button" role="tab" aria-selected={mode === 'systems'}
            className={mode === 'systems' ? 'active' : ''} onClick={() => setMode('systems')}>
            ⚙️ Systems &amp; devices
          </button>
        </div>

        {mode === 'systems' ? (
          <SystemsList onOpen={(name) => focus.openPath(systemPath(name, systems ?? []))} />
        ) : (
          <>
            <div className="mgmt-toolbar">
              <input
                type="text"
                placeholder="🔍 Search task titles"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select value={system} onChange={(e) => setSystem(e.target.value)}>
                <option value="all">All systems</option>
                {systemNames.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as KindFilter)}>
                <option value="all">Tasks + checklists</option>
                <option value="task">Tasks only</option>
                <option value="checklist">Checklists only</option>
              </select>
              {retiredCount > 0 && (
                <label className="mgmt-show-retired" title="Retired tasks keep their maintenance history but are off the schedule">
                  <input
                    type="checkbox"
                    checked={showRetired}
                    onChange={(e) => setShowRetired(e.target.checked)}
                  />
                  Show retired ({retiredCount})
                </label>
              )}
              <button type="button" onClick={() => setShowNewTask((v) => !v)}>+ New task</button>
              <button type="button" onClick={() => setShowNewChecklist((v) => !v)}>+ New checklist</button>
            </div>

            {showNewTask && <NewTaskForm onDone={() => setShowNewTask(false)} />}
            {showNewChecklist && <NewChecklistForm onDone={() => setShowNewChecklist(false)} />}

            <div className="mgmt-body">
              <ul className="mgmt-list">
                {filtered.length === 0 && <li className="mgmt-empty">No tasks match.</li>}
                {filtered.map((t) => (
                  <li
                    key={t.task_id}
                    className={t.retired ? 'mgmt-retired-badge' : undefined}
                    onClick={() => focus.open(taskKey(t.task_id))}
                  >
                    <span className="mgmt-kind-badge">{t.retired ? '📦' : t.task_kind === 'checklist' ? '✅' : '🛠️'}</span>
                    <span className="mgmt-item-name">{t.task_name}</span>
                    {/* The system is its own target: it opens the device, not the task (#74). */}
                    <button
                      type="button" className="record-link mgmt-item-system"
                      onClick={(e) => { e.stopPropagation(); focus.openPath(systemPath(t.system, systems ?? [])) }}
                    >
                      {t.system}
                    </button>
                    {!!t.is_critical && <span className="mgmt-critical-dot" title="Critical" />}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
    </NavScopeProvider>
  )
}

function NewTaskForm({ onDone }: { onDone: () => void }) {
  const createTask = useCreateTask()
  const { data: systems } = useSystems()
  const [system, setSystem] = useState('')
  const [name, setName] = useState('')

  return (
    <form
      className="mgmt-inline-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (!system.trim() || !name.trim()) return
        createTask.mutate(
          { system: system.trim(), task_name: name.trim(), task_kind: 'one_off', interval_type: 'break_fix' },
          { onSuccess: onDone },
        )
      }}
    >
      <SystemPicker value={system} systems={systems ?? []} onChange={setSystem} />
      <input placeholder="Task name" value={name} onChange={(e) => setName(e.target.value)} />
      <button type="submit" disabled={createTask.isPending}>Create</button>
      <button type="button" onClick={onDone}>Cancel</button>
    </form>
  )
}

function NewChecklistForm({ onDone }: { onDone: () => void }) {
  const createChecklist = useCreateChecklist()
  const [name, setName] = useState('')

  return (
    <form
      className="mgmt-inline-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return
        createChecklist.mutate({ name: name.trim() }, { onSuccess: onDone })
      }}
    >
      <input placeholder="Checklist name" value={name} onChange={(e) => setName(e.target.value)} />
      <button type="submit" disabled={createChecklist.isPending}>Create</button>
      <button type="button" onClick={onDone}>Cancel</button>
    </form>
  )
}

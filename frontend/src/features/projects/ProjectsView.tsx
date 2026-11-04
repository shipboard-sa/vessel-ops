/**
 * Purpose: Projects tab shell - the compact project list, a full-screen
 *   project focus screen, and (nested from it) Management's task editor,
 *   each with a "Back" to where you were.
 * Version: v6 (2026-09-23) - v6: the destination for AppNav project opens from any tab (Back
 *   returns there) and a NavScope so task/system/project names inside open on this trail (#74).
 *   v5 (2026-09-22): restores this view's own trail after AppNav sends the user away
 *   and back (tracker #58) and hands SystemScreen a returnTab/returnTrail to do so - v4 was 2026-09-19
 * Scope: PRODUCTION - mx-inv frontend, projects feature.
 * Architecture: Rendered by App.tsx. Owns one focus trail of
 *   {project|task|system}: list -> ProjectScreen -> TaskDetail -> SystemScreen, with a
 *   breadcrumb ("Projects > Refit > a task > Main Engine") and a Back that goes ONE level
 *   (v4, tracker #32). ProjectCard rows open a project; ProjectScreen task rows push a
 *   task; a task's System link pushes its system/device screen (shared with Management,
 *   see management/focusKeys.ts). Same "repaint the screen with the sub-element" pattern
 *   as ManagementView (the owner, 2026-09-18: prefer that over inline expansion).
 */
import { useEffect, useState } from 'react'
import { useProjects } from './useProjects'
import { useTasks } from '../management/useTasks'
import { useCreateProject } from './mutations'
import { ProjectCard } from './ProjectCard'
import { ProjectScreen } from './ProjectScreen'
import { TaskDetail } from '../management/TaskDetail'
import { SystemScreen } from '../management/SystemScreen'
import { navLabel, systemKey, taskKey, trailIndexOf, type NavKey } from '../management/focusKeys'
import { PROJECT_KINDS, type ProjectKind } from '../../api/types'
import { FocusScreen, useFocusTrail } from '../../components/FocusScreen'
import { NavScopeProvider, useAnchoredFocus, useReturnRestore, type RecordRef } from '../../components/AppNav'
import './ProjectsView.css'

// What the trail can hold. A trail always starts with the project, then any mix of
// tasks and systems/devices stacked on top (a task, a cross-reference jump from it,
// the system it belongs to, ...).
type ProjectFocus = { kind: 'project'; id: number } | NavKey

export function ProjectsView() {
  const { data: projects, isLoading, isError, error } = useProjects()
  const { data: allTasks } = useTasks()
  const focus = useFocusTrail<ProjectFocus>()
  const { clear: clearFocus, back: backFocus } = focus
  // Another tab opened a project here (tracker #74): show it, Back returns there. A cross-tab
  // open from THIS view came back: restore exactly the trail it left (#58).
  const shown = useAnchoredFocus<ProjectFocus>(focus, (ref) =>
    ref.kind === 'project' ? [{ kind: 'project', id: ref.id }] : null)
  useReturnRestore('projects', (r) => { if (r.trail) focus.openPath(r.trail as ProjectFocus[]) })
  const root = focus.trail[0]
  const projectId = root?.kind === 'project' ? root.id : null
  const project = projectId === null ? null : (projects ?? []).find((p) => p.project_id === projectId) ?? null
  const current = focus.current
  const taskId = current?.kind === 'task' ? current.id : null
  const focusedTask = taskId === null ? null : (allTasks ?? []).find((t) => t.task_id === taskId) ?? null

  // The focused project can vanish (deleted from its own screen) - fall back to the list.
  useEffect(() => {
    if (projectId !== null && projects && !project) clearFocus()
  }, [projectId, projects, project, clearFocus])

  // The focused task can vanish (deleted from its own editor) - fall back one step. (A missing
  // system is handled inside SystemScreen: after a rename the trail leads the cache by a tick.)
  useEffect(() => {
    if (taskId !== null && allTasks && !focusedTask) backFocus()
  }, [taskId, allTasks, focusedTask, backFocus])

  if (isLoading) return <p className="mgmt-status">Loading projects…</p>
  if (isError) return <p className="mgmt-status mgmt-status--error">{(error as Error).message}</p>
  if (!projects) return null

  // A link to something already on the trail walks back to it rather than stacking a duplicate.
  const jump = (key: NavKey) => {
    const i = trailIndexOf(focus.trail, key)
    if (i >= 0) focus.goTo(i + 1)
    else focus.push(key)
  }
  const openTask = (id: number) => jump(taskKey(id))
  const openSystem = (name: string) => jump(systemKey(name))
  // Inside an open project, task and system links stay on this trail; a different project
  // (or anything from the bare list) goes through AppNav like any other tab.
  const scope = {
    origin: () => ({ tab: 'projects' as const, trail: focus.trail }),
    openLocal: (ref: RecordRef) => {
      if (!project) return false
      if (ref.kind === 'task') { openTask(ref.id); return true }
      if (ref.kind === 'system') { openSystem(ref.name); return true }
      if (ref.kind === 'project') { focus.open({ kind: 'project', id: ref.id }); return true }
      return false
    },
  }
  const labelOf = (k: ProjectFocus) =>
    k.kind === 'project'
      ? (projects.find((p) => p.project_id === k.id)?.name ?? 'project')
      : navLabel(k, allTasks)

  return (
    <NavScopeProvider scope={scope}>
    <div className="projects-view">
      {project && (
        <FocusScreen focus={shown} listLabel="projects" labelOf={labelOf}>
          {/* Kept mounted (just hidden) while a task is stacked on top, so
              unsaved project edits and the add-task forms survive Back. */}
          <div hidden={current?.kind !== 'project'}>
            <ProjectScreen
              key={project.project_id}
              project={project}
              allTasks={allTasks ?? []}
              onOpenTask={openTask}
              onDeleted={shown.clear}
            />
          </div>
          {focusedTask && (
            <TaskDetail
              key={focusedTask.task_id}
              task={focusedTask}
              onClose={focus.back}
              onNavigateToTask={openTask}
              onOpenSystem={openSystem}
            />
          )}
          {current?.kind === 'system' && (
            <SystemScreen
              key={current.name}
              name={current.name}
              onOpenTask={openTask}
              onOpenSystem={openSystem}
              onRenamed={(n) => focus.replaceCurrent(systemKey(n))}
              onMoved={() => focus.back()}
              onDeleted={focus.back}
              returnTab="projects"
              returnTrail={focus.trail}
            />
          )}
        </FocusScreen>
      )}

      {/* Kept mounted (just hidden) while a project is focused. */}
      <div hidden={!!project}>
        <h2>Projects ({projects.length})</h2>
        <ul className="project-list">
          {projects.map((p) => (
            <ProjectCard
              key={p.project_id}
              project={p}
              onOpen={() => focus.open({ kind: 'project', id: p.project_id })}
            />
          ))}
        </ul>

        <NewProjectForm />
      </div>
    </div>
    </NavScopeProvider>
  )
}

function NewProjectForm() {
  const createProject = useCreateProject()
  const [expanded, setExpanded] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ProjectKind>('other')

  if (!expanded) {
    return (
      <button type="button" className="link-button" onClick={() => setExpanded(true)}>
        + New project
      </button>
    )
  }

  return (
    <form
      className="mgmt-inline-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return
        createProject.mutate(
          { name: name.trim(), kind },
          { onSuccess: () => { setName(''); setExpanded(false) } },
        )
      }}
    >
      <input placeholder="Name, e.g. Next haul-out" value={name} onChange={(e) => setName(e.target.value)} />
      <select value={kind} onChange={(e) => setKind(e.target.value as ProjectKind)}>
        {PROJECT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
      </select>
      <button type="submit" disabled={createProject.isPending}>Create</button>
      <button type="button" onClick={() => setExpanded(false)}>Cancel</button>
    </form>
  )
}

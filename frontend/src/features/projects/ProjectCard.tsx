/**
 * Purpose: One compact project row in the Projects list - name, kind, status
 *   and open/total task counts. Clicking it opens the project focus screen.
 * Version: v3 (2026-09-18)
 * Scope: PRODUCTION - mx-inv frontend, projects feature.
 * Architecture: Rendered by ProjectsView.tsx, which owns the focus trail.
 *   Presentational only; the editor / task list / add-task forms moved to
 *   ProjectScreen.tsx when projects went to focus screens instead of
 *   expanding inline (the owner, 2026-09-18).
 */
import type { Project } from '../../api/types'
import { KIND_ICON, STATUS_ICON } from './projectIcons'

export function ProjectCard({ project, onOpen }: { project: Project; onOpen: () => void }) {
  return (
    <li className="project-card">
      <button type="button" className="project-card-header" onClick={onOpen}>
        <span>{KIND_ICON[project.kind]} {project.name}</span>
        <span className="project-card-meta">
          {STATUS_ICON[project.status]} {project.status} · {project.open_count}/{project.task_count} open
        </span>
      </button>
    </li>
  )
}

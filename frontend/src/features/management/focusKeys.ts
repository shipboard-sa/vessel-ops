/**
 * Purpose: The shared vocabulary for the Management/Projects navigation trail - what one
 *   level of "where you are" can be (a task, or a system/device) - and the breadcrumb label
 *   for each.
 * Version: v1 (2026-09-19)
 * Scope: PRODUCTION - mx-inv frontend, management feature.
 * Architecture: Type + two pure helpers, no state. Used with components/FocusScreen's
 *   useFocusTrail by ManagementView and ProjectsView so one trail can walk
 *   Systems > System > Device > Task (or Project > Task > System > Device) with a
 *   breadcrumb and a Back that goes one level (tracker #32/#36/#37, the owner 2026-09-19).
 */
import type { RawTask, SystemInfo } from '../../api/types'

export type NavKey =
  | { kind: 'task'; id: number }
  | { kind: 'system'; name: string }

export const taskKey = (id: number): NavKey => ({ kind: 'task', id })
export const systemKey = (name: string): NavKey => ({ kind: 'system', name })

/** The trail to open a system or device with its ancestors, e.g. [Propulsion, Main Engine]. */
export function systemPath(name: string, systems: SystemInfo[]): NavKey[] {
  const parent = systems.find((s) => s.name === name)?.parent_name
  return parent ? [systemKey(parent), systemKey(name)] : [systemKey(name)]
}

/** Index of `key` already on the trail (tasks by id, systems by name), or -1. */
export function trailIndexOf(trail: { kind: string }[], key: NavKey): number {
  return trail.findIndex((k) =>
    k.kind === key.kind
    && (key.kind === 'task' ? (k as { id?: number }).id === key.id : (k as { name?: string }).name === key.name))
}

export function navLabel(key: NavKey, tasks: RawTask[] | undefined): string {
  if (key.kind === 'system') return key.name
  return tasks?.find((t) => t.task_id === key.id)?.task_name ?? 'task'
}

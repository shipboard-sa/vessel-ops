/**
 * Purpose: Names the one "housekeeping" system - `Checklists` - that only exists to satisfy
 *   tasks.system (a required FK) for checklist steps, and says where the UI must NOT offer it.
 * Version: v1 (2026-09-20)
 * Scope: PRODUCTION - mx-inv frontend, management feature.
 * Architecture: Tiny shared constant + helper, no state. `Checklists` is a real row in `systems`
 *   (backend/data.py defaults new checklists to it) but is not equipment, so SystemsList, the
 *   device pick lists (SystemPicker, ServesEditor), the task system filter and TaskDetail's
 *   "Open <system>" link skip it. Checklists themselves are reached via Management > Tasks &
 *   checklists (kind filter), the schedule and the cockpit, never via the Systems tree
 *   (tracker #31, the owner 2026-09-20: hide it).
 */
import type { SystemInfo } from '../../api/types'

export const CHECKLISTS_SYSTEM = 'Checklists'

/** Systems the UI may offer as a place a task or part lives; `keep` = a value already chosen. */
export function offerableSystems(systems: SystemInfo[], keep?: string): SystemInfo[] {
  return systems.filter((s) => s.name !== CHECKLISTS_SYSTEM || s.name === keep)
}

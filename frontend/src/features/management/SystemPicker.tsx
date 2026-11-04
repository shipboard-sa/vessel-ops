/**
 * Purpose: The system/device picker - where a task (or incident, or follow-on) is filed.
 * Version: v3 (2026-09-24) - v3: a button showing "System › Device" that opens SystemCascade, the
 *   System › Device tap columns with a search box on top - the same view as the container picker
 *   (the owner 2026-09-24: one interface for every tree). v2 (2026-09-23) was type-to-search over every
 *   system and device with "＋ New" first (tracker #76); v1 the two-select cascade.
 * Scope: PRODUCTION - mx-inv frontend, management feature; used by TaskDetail, ManagementView's
 *   New task, NewProjectTaskForm, TaskReferences, the Log's past-service form + follow-ons, and
 *   the cockpit IncidentForm.
 * Architecture: Two levels over the systems picklist (schema v14): a top-level system (a
 *   category, e.g. "Fresh Water System") and optionally a device nested under it. tasks.system
 *   stores whichever is the final choice. New systems/devices are created inside the cascade via
 *   useCreateSystem (the owner's data-integrity-via-pick-lists rule) - never free text. Same props as
 *   v2, so callers did not change. Not a <form>: it lives inside other forms (tracker #34/#35).
 */
import { useState } from 'react'
import type { SystemInfo } from '../../api/types'
import { offerableSystems } from './housekeeping'
import { SystemCascade } from './SystemCascade'
import { TapTrigger } from '../../components/TapColumns'

export function SystemPicker({
  value, systems, onChange, disabled,
}: {
  value: string
  systems: SystemInfo[]
  onChange: (name: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  // A just-created entry is not in `systems` until the query refetches.
  const [made, setMade] = useState<string | null>(null)
  // `Checklists` (housekeeping, see housekeeping.ts) is only offered when it is already the value.
  const offered = offerableSystems(systems, value)
  const current = systems.find((s) => s.name === value)
  const label = current ? (current.parent_name ? `${current.parent_name} › ${current.name}` : current.name)
    : value && value === made ? value : value || null

  return (
    <div className="system-picker-fields">
      <div className="search-pick-field">
        <span>System or device</span>
        <TapTrigger
          icon="⚙️"
          label={systems.length === 0 && value ? `${value} (loading systems…)` : label}
          empty={systems.length === 0 ? 'Loading systems…' : 'Pick a system or device…'}
          disabled={disabled || systems.length === 0}
          onOpen={() => setOpen(true)}
        />
      </div>
      {open && (
        <SystemCascade
          title="Which system or device?"
          systems={offered}
          value={value || null}
          onClose={() => setOpen(false)}
          onPick={(name) => {
            if (name !== null) { setMade(name); onChange(name) }
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}

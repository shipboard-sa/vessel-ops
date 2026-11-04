/**
 * Purpose: Pick-from-existing-values control for free-form grouping labels (checklist sub-list
 *   group, food category) with an inline "＋ New…" entry.
 * Version: v2 (2026-09-23) - v2: the "＋ New" choice is the first option, not the last (#76).
 * Scope: PRODUCTION - mx-inv frontend, shared by management/ChecklistSteps and
 *   warehouse/FoodDetailsFields.
 * Architecture: Presentational + local "adding" state; the caller owns the options list.
 */
import { useState } from 'react'

// Value of the "+ new ..." option (never a real group name).
const NEW_ENTRY = '__new__'

// Shared by checklist steps' "sub-list group" and project tasks' "phase" -
// both are the same idea (an optional free-form label used to cluster
// sibling rows) and both should be a pick-from-existing-values control
// rather than free text, to keep the label vocabulary from drifting into
// near-duplicates ("Yanmar" vs "yanmar" vs "Yanmar engine").
export function GroupPicker({
  value, options, onChange, noneLabel, newLabel, newPlaceholder,
}: {
  value: string | null
  options: string[]
  onChange: (group: string | null) => void
  noneLabel: string
  newLabel: string
  newPlaceholder: string
}) {
  const [addingNew, setAddingNew] = useState(false)
  const [newValue, setNewValue] = useState('')

  const commitNew = () => {
    if (!newValue.trim()) return
    onChange(newValue.trim())
    setAddingNew(false); setNewValue('')
  }

  if (addingNew) {
    return (
      // Not a <form>: this picker is used inside other forms (Add New Stuff's food
      // details), and a nested <form> submit navigated the page (tracker #34/#35).
      <div className="group-picker-new">
        <input
          autoFocus placeholder={newPlaceholder} value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitNew() }
            if (e.key === 'Escape') { e.preventDefault(); setAddingNew(false) }
          }}
        />
        <button type="button" onClick={commitNew}>✓</button>
        <button type="button" onClick={() => setAddingNew(false)}>✕</button>
      </div>
    )
  }

  return (
    <select
      className="group-picker"
      value={value ?? ''}
      onChange={(e) => {
        if (e.target.value === NEW_ENTRY) { setAddingNew(true); return }
        onChange(e.target.value || null)
      }}
    >
      <option value="">{noneLabel}</option>
      <option value={NEW_ENTRY}>{newLabel}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

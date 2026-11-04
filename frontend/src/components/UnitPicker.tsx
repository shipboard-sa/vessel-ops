/**
 * Purpose: The one shared unit picker - a governed <select> over the `units`
 *   lookup table (grouped by dimension), with an inline "+ new unit..." form.
 * Version: v3 (2026-09-23) - v3: "+ new unit…" is the first choice, not the last (tracker #76)
 *   - v2 2026-09-18
 * Scope: PRODUCTION - mx-inv frontend, used everywhere a unit is entered.
 * Architecture: Presentational + local "adding" state; data via api/units.ts
 *   (useUnits / useCreateUnit). Used by warehouse/AddItemTab, warehouse/
 *   ItemDetailPanel and recipes/RecipeIngredients (IngredientReview). Never
 *   produces a free-text value: onChange only ever gets a unit_key the backend
 *   knows (or one this component just created), or null when allowEmpty.
 *   v2: lists only `offered` units, plus the current value even when it is a
 *   legacy not-offered unit (labelled) so an item still on kg shows and saves.
 */
import { useState } from 'react'
import { ApiError } from '../api/client'
import { DIMENSION_LABELS, UNIT_DIMENSIONS, useCreateUnit, useUnits } from '../api/units'
import type { UnitDimension, UnitRow } from '../api/types'
import './UnitPicker.css'

const NEW_SENTINEL = '__new_unit__'

export interface UnitPickerProps {
  value: string | null
  onChange: (unitKey: string | null) => void
  /** Offer a "no unit" choice (recipe ingredients). value null then means "none". */
  allowEmpty?: boolean
  emptyLabel?: string
  disabled?: boolean
  ariaLabel?: string
}

function optionText(u: UnitRow) {
  const base = u.label && u.label !== u.unit_key ? `${u.unit_key} · ${u.label}` : u.unit_key
  return u.offered ? base : `${base} (legacy - not offered)`
}

/** Readable message from a failed POST /units (409 exists / 422 blank / other). */
function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const d = err.detail
    if (typeof d === 'string' && d) return d
    if (Array.isArray(d)) {
      const msgs = d
        .map((x) => (x && typeof x === 'object' && 'msg' in x ? String((x as { msg: unknown }).msg) : ''))
        .filter(Boolean)
      if (msgs.length) return msgs.join('; ')
    }
    if (err.status === 409) return 'That unit already exists - pick it from the list.'
    if (err.status === 422) return 'Enter a unit key.'
  }
  return err instanceof Error ? err.message : 'Could not add the unit.'
}

export function UnitPicker({
  value, onChange, allowEmpty, emptyLabel = '— none —', disabled, ariaLabel = 'Unit',
}: UnitPickerProps) {
  const { data: units } = useUnits()
  const createUnit = useCreateUnit()
  const [adding, setAdding] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newDim, setNewDim] = useState<UnitDimension>('count')
  const [error, setError] = useState<string | null>(null)

  // Offered units only, but never hide the current value (legacy kg/L stay selectable).
  const listed = (units ?? []).filter((u) => u.offered || u.unit_key === value)
  // Group order follows the API's own (imperial-first) order, not a fixed one.
  const dims: UnitDimension[] = [...new Set(listed.map((u) => u.dimension))]
  const known = units?.some((u) => u.unit_key === value) ?? false
  // Units still loading (or a legacy/unknown value): keep the current value
  // visible so the select never silently shows the wrong thing.
  const showStray = value !== null && !known

  const cancel = () => { setAdding(false); setNewKey(''); setError(null) }

  const add = async () => {
    const key = newKey.trim()
    if (!key) { setError('Enter a unit key.'); return }
    setError(null)
    try {
      const created = await createUnit.mutateAsync({ unit_key: key, dimension: newDim })
      onChange(created.unit_key)
      cancel()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div className="unit-picker">
      <select
        aria-label={ariaLabel}
        disabled={disabled}
        value={adding ? NEW_SENTINEL : (value ?? '')}
        onChange={(e) => {
          if (e.target.value === NEW_SENTINEL) { setAdding(true); return }
          setAdding(false)
          onChange(e.target.value === '' ? null : e.target.value)
        }}
      >
        {allowEmpty
          ? <option value="">{emptyLabel}</option>
          : value === null && <option value="" disabled>— choose —</option>}
        {/* The "new" choice is always first, never at the bottom (the owner, 2026-09-23, #76). */}
        <option value={NEW_SENTINEL}>＋ New unit…</option>
        {showStray && (
          <option value={value}>{units ? `${value} (not in list)` : value}</option>
        )}
        {dims.map((dim) => {
          const inDim = listed.filter((u) => u.dimension === dim)
          return (
            <optgroup key={dim} label={DIMENSION_LABELS[dim]}>
              {inDim.map((u) => <option key={u.unit_key} value={u.unit_key}>{optionText(u)}</option>)}
            </optgroup>
          )
        })}
      </select>
      {adding && (
        <div className="unit-picker-new">
          <input
            autoFocus
            aria-label="New unit key"
            placeholder="key, e.g. pinch"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => {
              // Inside a parent <form>: Enter must add the unit, not submit the item.
              if (e.key === 'Enter') { e.preventDefault(); void add() }
              if (e.key === 'Escape') cancel()
            }}
          />
          <select
            aria-label="New unit dimension"
            value={newDim}
            onChange={(e) => setNewDim(e.target.value as UnitDimension)}
          >
            {UNIT_DIMENSIONS.map((d) => <option key={d} value={d}>{DIMENSION_LABELS[d]}</option>)}
          </select>
          <button type="button" onClick={() => void add()} disabled={createUnit.isPending || !newKey.trim()}>
            {createUnit.isPending ? 'Adding…' : 'Add'}
          </button>
          <button type="button" onClick={cancel}>Cancel</button>
        </div>
      )}
      {error && <p className="unit-picker-error" role="alert">{error}</p>}
    </div>
  )
}

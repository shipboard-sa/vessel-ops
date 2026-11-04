/**
 * Purpose: The shared "who did the work" box - type anything, or pick from the crew roster
 *   and everyone already named in the maintenance history.
 * Version: v1 (2026-09-22)
 * Scope: PRODUCTION - mx-inv frontend, schedule feature.
 * Architecture: Used by the Complete panel (TaskCardDetail) and the past-service-record form
 *   (HistoricalRecordForm). Reads GET /api/tasks/completions/performed-by
 *   (data.list_performed_by_choices = crew_members UNION the distinct performed_by values
 *   already in task_completions, deduplicated case-insensitively). The value posts straight
 *   through as free text on the completion.
 *
 * Why a <datalist> and not a <select> (tracker #44): `performed_by` is stored as a TEXT
 * SNAPSHOT on the history row, never a foreign key - a history row is a fact, so it holds the
 * name itself and survives the roster changing, exactly like task_name and system do. That
 * means a name NOT on the roster has to remain typeable: the yard you use once should not
 * require roster maintenance first. What free text actually costs is not lost data but
 * inconsistent spelling ("Sailing Services" vs "Sailing Services, Miami" reading as two
 * outfits later), and offering back what has already been typed is the fix for that. A
 * datalist gives both: a real pick list, and anything else you want to type.
 */
import { useId } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../../api/client'

export interface PerformedByChoice {
  name: string
  kind: string
  source: 'roster' | 'history'
  uses: number
}

export function usePerformedByChoices() {
  return useQuery({
    queryKey: ['completions', 'performed-by'],
    queryFn: () => apiGet<PerformedByChoice[]>('/tasks/completions/performed-by'),
  })
}

export function PerformedByField({
  value, onChange, label = 'Done by', hint, id,
}: {
  value: string
  onChange: (value: string) => void
  label?: string
  hint?: string
  /** Optional stable id; React generates one otherwise, so two of these can share a screen. */
  id?: string
}) {
  const { data } = usePerformedByChoices()
  const generatedId = useId()
  const listId = id ?? `performed-by-${generatedId}`
  const choices = data ?? []

  return (
    <label className="performed-by">
      {label} {hint && <span className="hint">{hint}</span>}
      <input
        list={listId}
        value={value}
        placeholder="e.g. the skipper, or the yard that did it"
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {choices.map((c) => (
          <option key={`${c.source}:${c.name}`} value={c.name}>
            {c.source === 'history' && c.uses > 0
              ? `used ${c.uses}×`
              : c.kind === 'vendor' ? 'vendor' : ''}
          </option>
        ))}
      </datalist>
    </label>
  )
}

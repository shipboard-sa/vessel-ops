/**
 * Purpose: The tool_accessory-only field of an item - a free-text spec - as a reusable
 *   piece plus the value helpers, same shape as FoodDetailsFields.
 * Version: v2 (2026-09-22) - v2: dropped "Belongs to tool" (a single parent_tool_item_id) -
 *   an accessory can serve more than one tool (the owner, 2026-09-22: same-size sanding discs across
 *   two sanders), so that link moved to the many-to-many ToolLinksEditor (mirrors
 *   ServesEditor's "part of these devices" pattern) which saves immediately, separate from
 *   this form's batched "Save item". v1 was 2026-09-22.
 * Scope: PRODUCTION - mx-inv frontend, warehouse feature.
 * Architecture: Used by ItemDetailPanel. Maps to tool_accessory_details.spec.
 */
export interface ToolAccessoryDetailValues {
  spec: string | null
}

export const EMPTY_TOOL_ACCESSORY: ToolAccessoryDetailValues = {
  spec: null,
}

export function toolAccessoryValuesFrom(details: Record<string, unknown> | undefined): ToolAccessoryDetailValues {
  const d = details ?? {}
  return {
    spec: (d.spec as string | null | undefined) ?? null,
  }
}

export function toolAccessoryDetailsPayload(v: ToolAccessoryDetailValues): Record<string, unknown> {
  return { spec: v.spec || null }
}

export function ToolAccessoryDetailsFields({
  value, onChange,
}: {
  value: ToolAccessoryDetailValues
  onChange: (next: Partial<ToolAccessoryDetailValues>) => void
}) {
  return (
    <fieldset className="tool-accessory-details-fields">
      <legend>🪛 Tool accessory details</legend>
      <label>
        Spec
        <input
          type="text" placeholder="model / size / part number"
          value={value.spec ?? ''}
          onChange={(e) => onChange({ spec: e.target.value })}
        />
      </label>
    </fieldset>
  )
}

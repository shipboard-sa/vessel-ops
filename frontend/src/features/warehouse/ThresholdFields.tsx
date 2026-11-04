/**
 * Purpose: The three stocking-threshold inputs (Reorder at / Target / Min hold)
 *   with plain-language help, shared by the Add New Stuff form and the item screen.
 * Version: v1 (2026-09-19)
 * Scope: PRODUCTION - mx-inv frontend, warehouse feature.
 * Architecture: Presentational, controlled component used by AddItemTab and
 *   ItemDetailPanel so both forms label and explain the fields identically
 *   (the owner, 2026-09-19, tracker #10: the confusion was nomenclature, so one
 *   wording in one place). Values are number | null; null = blank = "not set".
 */
export interface ThresholdValues {
  min_quantity: number
  target_quantity: number | null
  min_hold: number | null
}

export function ThresholdFields({
  policy, values, onChange,
}: {
  policy: string | null | undefined
  values: ThresholdValues
  onChange: (next: Partial<ThresholdValues>) => void
}) {
  const num = (v: string): number | null => (v === '' ? null : Number(v))
  return (
    <div className="threshold-fields">
      <div className="item-detail-row">
        <label>
          Reorder when below
          <input
            type="number" min={0} step={1}
            value={values.min_quantity ?? 0}
            onChange={(e) => onChange({ min_quantity: num(e.target.value) ?? 0 })}
          />
        </label>
        <label>
          Buy up to (target)
          <input
            type="number" min={0} step={1}
            value={values.target_quantity ?? ''}
            onChange={(e) => onChange({ target_quantity: num(e.target.value) })}
          />
        </label>
        <label>
          Always keep at least (min hold)
          <input
            type="number" min={0} step={1}
            value={values.min_hold ?? ''}
            onChange={(e) => onChange({ min_hold: num(e.target.value) })}
          />
        </label>
      </div>
      <p className="item-policy-hint">
        <strong>Reorder when below</strong>: the item goes on the Restock List when on hand is
        under this number (0 = never). <strong>Buy up to</strong>: how many to bring it back
        to; blank = the reorder number. <strong>Always keep at least</strong>: a critical-spare
        floor that lists the item even if the reorder number wouldn't; blank = none.
      </p>
      {policy === 'owned' && (
        <p className="item-policy-hint item-policy-hint--owned">
          <strong>Owned = you have one.</strong> Set <em>Reorder when below</em> to 1 and leave the
          other two blank, then record 1 on hand in its container. It stays off the Restock List
          while it's aboard and appears only if it's lost or broken (on hand 0). Until it has
          stock recorded it shows there as "not yet located".
        </p>
      )}
    </div>
  )
}

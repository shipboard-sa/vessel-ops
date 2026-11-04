/**
 * Purpose: Edit which systems/devices an item serves (a part OF them, or a spare
 *   unit that can replace them) - chips for the current links plus a grouped
 *   pick list to add one. Saves immediately, like the stock lots below it.
 * Version: v4 (2026-09-24)
 *   - v4: the add pick is a button that opens SystemCascade - the System › Device tap columns
 *     with search on top, same view as the container picker; already-linked rows show "linked".
 *     New devices are made inside it ("＋ New device in <system>…"), so NewDeviceBox is gone.
 *   - v3: the add pick is a SearchPick over every offerable system/device (hint = its parent) with
 *     "＋ New device…" FIRST - name + parent system inline, created via useCreateSystem and linked
 *     straight away (tracker #76). Also used by UnlinkedPartsReview.
 *   - v2: each chip's name opens that system/device; ✕ stays a separate unlink (tracker #74).
 * Scope: PRODUCTION - mx-inv frontend, warehouse feature.
 * Architecture: Mounted by ItemDetailPanel. Reads GET /api/items/{id}/systems
 *   and the systems list (management/useTasks); writes PUT /api/items/{id}/systems
 *   (replace-set, FK-validated server-side). Choices are a pick list only - a
 *   system is never typed (the owner, 2026-09-19). The item's TYPE says how it relates
 *   to the device (Part = part of it, Spare unit = complete replacement), so
 *   there is no role field here.
 */
import { useState } from 'react'
import { useItemSystems } from './useWarehouse'
import { useSetItemSystems } from './mutations'
import { useSystems } from '../management/useTasks'
import { offerableSystems } from '../management/housekeeping'
import { SystemCascade } from '../management/SystemCascade'
import { ApiError } from '../../api/client'
import { RecordLink } from '../../components/RecordLink'

const HEADING: Record<string, string> = {
  part: 'Part of these devices',
  spare_unit: 'Can replace these devices',
}

export function ServesEditor({ itemId, itemType }: { itemId: number; itemType: string }) {
  const { data: linked } = useItemSystems(itemId)
  const { data: systems } = useSystems()
  const setSystems = useSetItemSystems()
  const [picking, setPicking] = useState(false)

  if (!linked || !systems) return null
  const linkedSet = new Set(linked)
  const save = (next: string[]) => setSystems.mutate({ itemId, systems: next })
  const add = (name: string) => { if (!linkedSet.has(name)) save([...linked, name]) }
  const needsDevice = (itemType === 'part' || itemType === 'spare_unit') && linked.length === 0

  return (
    <div className="serves-editor">
      <h4>{HEADING[itemType] ?? 'Serves these systems / devices'}</h4>
      {needsDevice && (
        <p className="mgmt-status">Not linked to any device yet — pick the device(s) this serves.</p>
      )}
      <ul className="serves-chips">
        {linked.map((n) => (
          <li key={n}>
            <RecordLink to={{ kind: 'system', name: n }}>{n}</RecordLink>
            <button type="button" title="Unlink" onClick={() => save(linked.filter((x) => x !== n))}>✕</button>
          </li>
        ))}
      </ul>
      <button type="button" className="serves-add" disabled={setSystems.isPending} onClick={() => setPicking(true)}>
        ＋ Link a device / system…
      </button>
      {picking && (
        <SystemCascade
          title="Which device or system does it serve?"
          systems={offerableSystems(systems)}
          offWhy={(s) => (linkedSet.has(s.name) ? 'linked' : null)}
          onClose={() => setPicking(false)}
          onPick={(name) => { setPicking(false); if (name !== null) add(name) }}
        />
      )}
      {setSystems.error && (
        <p className="mgmt-status mgmt-status--error">
          {setSystems.error instanceof ApiError
            ? ((setSystems.error.detail as { message?: string } | undefined)?.message ?? setSystems.error.message)
            : (setSystems.error as Error).message}
        </p>
      )}
    </div>
  )
}

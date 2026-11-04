/**
 * Purpose: The one way to walk the storage tree - Compartment › Location › Container as tap
 *   columns, "＋ New …" first in each. Shared by the container picker, the Edit Storage Structure
 *   screen and every "Move to…" in it, so the interface is the same everywhere.
 * Version: v3 (2026-09-24) - v3: compartments A-Z like every other level (they were in stored boat order). v2: rows, "＋ New" row and styles come from the shared components/TapColumns kit (also used by the System › Device picker). v1 same day.
 * Scope: PRODUCTION - mx-inv frontend, warehouse feature.
 * Architecture: Pure UI over useCompartments / useLocations / useContainers; creates via
 *   useAddCompartment / useAddLocation / useAddContainer, stars via useUpdateContainer. The CALLER
 *   owns the selection ({compId, locId, containerId}) and decides what a tap means (pick and
 *   close, open the edit panel, or move something there) in onSelect. `depth` 1/2/3 shows only
 *   the first N columns (a move destination is a compartment or a location). Under 760px only
 *   the deepest open column shows, with ← Back in its header. Used by ContainerCascade.tsx
 *   (picker overlay) and StorageStructureTab.tsx (maintenance). the owner 2026-09-24.
 */
import { useState } from 'react'
import { CONTAINER_TYPES, type Container, type ContainerType } from '../../api/types'
import { useCompartments, useContainers, useLocations } from './useWarehouse'
import { useAddCompartment, useAddContainer, useAddLocation, useUpdateContainer } from './mutations'
import { TapNewRow, TapRow, type Done } from '../../components/TapColumns'

const GALLEY = 'Galley'
const isLoose = (name: string) => name.trim().toLowerCase() === 'loose'

export interface StorageSel {
  compId: number | null
  locId: number | null
  containerId: number | null
}
export const EMPTY_SEL: StorageSel = { compId: null, locId: null, containerId: null }

export function StorageColumns({
  sel, onSelect, depth = 3, itemType, starToggle = false, here,
}: {
  sel: StorageSel
  /** Every tap and every create lands here; `label` is the full path of a picked container. */
  onSelect: (next: StorageSel, label?: string) => void
  depth?: 1 | 2 | 3
  /** Food lists the Galley compartment first. */
  itemType?: string | null
  /** A ⭐ toggle on each container row. */
  starToggle?: boolean
  /** Where the thing being moved is now - that row is shown but cannot be picked. */
  here?: { compId?: number; locId?: number }
}) {
  const { data: compartments } = useCompartments()
  const { data: locations } = useLocations()
  const { data: containers } = useContainers()
  const addComp = useAddCompartment()
  const addLoc = useAddLocation()
  const addCont = useAddContainer()
  const update = useUpdateContainer()
  const [newKind, setNewKind] = useState<ContainerType>('dry')
  const conts = containers ?? []
  const { compId, locId } = sel
  const step = compId === null || depth === 1 ? 1 : locId === null || depth === 2 ? 2 : 3

  // A-Z at every level (the owner 2026-09-24); food puts Galley first.
  const comps = (compartments ?? []).slice().sort((a, b) =>
    (itemType === 'food' ? Number(b.compartment_name === GALLEY) - Number(a.compartment_name === GALLEY) : 0)
    || a.compartment_name.localeCompare(b.compartment_name))
  const locs = (locations ?? []).filter((l) => l.compartment_id === compId)
    .sort((a, b) => a.location_name.localeCompare(b.location_name))
  const boxes = conts.filter((c) => c.location_id === locId)
    .sort((a, b) => Number(isLoose(b.container_name)) - Number(isLoose(a.container_name))
      || a.container_name.localeCompare(b.container_name))
  const containerCount = (locationId: number) => conts.filter((c) => c.location_id === locationId).length
  const comp = comps.find((c) => c.compartment_id === compId)
  const loc = (locations ?? []).find((l) => l.location_id === locId)

  const fail = (done: Done) => (err: unknown) => done(null, (err as Error).message)
  const addCompartment = (name: string, done: Done) => addComp.mutate(name, {
    onSuccess: (res) => done((res as { compartment_id: number }).compartment_id), onError: fail(done),
  })
  const addLocation = (name: string, done: Done) => addLoc.mutate({ compartment_id: compId!, name }, {
    onSuccess: (res) => done((res as { location_id: number }).location_id), onError: fail(done),
  })
  const addContainer = (name: string, done: Done) =>
    addCont.mutate({ location_id: locId!, name, container_type: newKind }, {
      onSuccess: (res) => done((res as { container_id: number }).container_id), onError: fail(done),
    })

  const pickComp = (id: number | null) => onSelect({ compId: id, locId: null, containerId: null })
  const pickLoc = (id: number | null) => onSelect({ compId, locId: id, containerId: null })
  const pickBox = (c: Container) =>
    onSelect({ compId, locId, containerId: c.container_id }, `${c.compartment_name} › ${c.location_name} › ${c.container_name}`)

  return (
    <div className={`cc-cols cc-cols--depth${depth} cc-cols--step${step}`}>
      <section className="cc-col cc-col--1">
        <h3>Compartment</h3>
        <TapNewRow label="＋ New compartment…" onCreate={addCompartment} onCreated={(id) => pickComp(id)} />
        {comps.map((c) => (
          <TapRow
            key={c.compartment_id}
            on={c.compartment_id === compId}
            off={here?.compId === c.compartment_id}
            label={c.compartment_name}
            count={depth > 1 ? c.location_count : undefined}
            onClick={() => pickComp(c.compartment_id)}
          />
        ))}
      </section>

      {depth >= 2 && (
        <section className="cc-col cc-col--2">
          <h3>
            <button type="button" className="cc-back" onClick={() => pickComp(null)}>← </button>
            {comp ? comp.compartment_name : 'Location'}
          </h3>
          {compId === null ? <p className="cc-dim cc-hint">Pick a compartment first.</p> : (
            <>
              <TapNewRow key={`loc-${compId}`} label="＋ New location…" onCreate={addLocation} onCreated={(id) => pickLoc(id)} />
              {locs.map((l) => (
                <TapRow
                  key={l.location_id}
                  on={l.location_id === locId}
                  off={here?.locId === l.location_id}
                  label={l.location_name}
                  count={depth > 2 ? containerCount(l.location_id) : undefined}
                  onClick={() => pickLoc(l.location_id)}
                />
              ))}
              {locs.length === 0 && <p className="cc-dim cc-hint">No locations here yet - add one above.</p>}
            </>
          )}
        </section>
      )}

      {depth === 3 && (
        <section className="cc-col cc-col--3">
          <h3>
            <button type="button" className="cc-back" onClick={() => pickLoc(null)}>← </button>
            {loc ? loc.location_name : 'Container'}
          </h3>
          {locId === null ? <p className="cc-dim cc-hint">Pick a location first.</p> : (
            <>
              <TapNewRow
                key={`cont-${locId}`}
                label="＋ New container…"
                extra={(
                  <select value={newKind} onChange={(e) => setNewKind(e.target.value as ContainerType)}>
                    {CONTAINER_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                  </select>
                )}
                onCreate={addContainer}
                onCreated={(id, name) => onSelect(
                  { compId, locId, containerId: id },
                  `${comp?.compartment_name} › ${loc?.location_name} › ${name}`,
                )}
              />
              {boxes.map((c) => (
                <TapRow
                  key={c.container_id}
                  on={c.container_id === sel.containerId}
                  label={c.container_name}
                  tag={c.container_type === 'dry' ? null : c.container_type.replace('_', ' ')}
                  star={starToggle ? {
                    on: !!c.favorite,
                    toggle: () => update.mutate({ containerId: c.container_id, fields: { favorite: c.favorite ? 0 : 1 } }),
                  } : (c.favorite ? { on: true } : undefined)}
                  onClick={() => pickBox(c)}
                />
              ))}
              {boxes.length === 0 && <p className="cc-dim cc-hint">No containers here yet - add one above (e.g. “Loose”).</p>}
            </>
          )}
        </section>
      )}
    </div>
  )
}

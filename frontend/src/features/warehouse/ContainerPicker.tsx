/**
 * Purpose: The one container picker used wherever stock is put somewhere (Add New Stuff, the
 *   item's stock editor, Receive, the multi-item assign bar, Work a Container).
 * Version: v4 (2026-09-24) - v4: a button showing the full path that opens ContainerCascade, a
 *   full-screen Compartment › Location › Container tap cascade with "＋ New …" first in each
 *   column (the owner 2026-09-24: the v3 type-to-search list was too long, too narrow and clunky to
 *   type into). v3 2026-09-23 type-to-search; v2 2026-09-19.
 * Scope: PRODUCTION - mx-inv frontend, warehouse feature.
 * Architecture: Trigger + ContainerCascade (the overlay; ordering, favorites and create-on-the-fly
 *   live there). Same props as v2/v3, so callers did not change. NewContainerForm stays exported
 *   for the Audit tab's inline "new container".
 */
import { useState } from 'react'
import { CONTAINER_TYPES, type Compartment, type Container, type ContainerType, type Location } from '../../api/types'
import { SearchPick } from '../../components/SearchPick'
import { ContainerCascade } from './ContainerCascade'
import { TapTrigger } from '../../components/TapColumns'
import { useCompartments, useContainers, useLocations } from './useWarehouse'
import { useAddContainer, useAddLocation } from './mutations'

// Full Compartment › Location › Container path - a bare location name ("Port") is ambiguous.
export function containerLabel(c: Container) {
  return `${c.compartment_name} › ${c.location_name} › ${c.container_name}`
    + (c.container_type === 'dry' ? '' : `  [${c.container_type}]`)
}

const GALLEY = 'Galley'

export function ContainerPicker({
  value, onChange, allowUnassigned = true, itemType,
}: {
  value: number | null
  onChange: (containerId: number | null) => void
  allowUnassigned?: boolean
  /** The item's type, when known: food puts the Galley compartment first. */
  itemType?: string | null
}) {
  const { data: containers } = useContainers()
  const [open, setOpen] = useState(false)
  // A just-created container is not in `containers` until the query refetches.
  const [madeLabel, setMadeLabel] = useState<{ id: number; label: string } | null>(null)
  const current = (containers ?? []).find((c) => c.container_id === value)
  const label = current ? containerLabel(current)
    : madeLabel && madeLabel.id === value ? madeLabel.label : null

  return (
    <>
      <TapTrigger icon="📦" label={label} empty={allowUnassigned ? '— unassigned —' : 'Pick a container…'} onOpen={() => setOpen(true)} />
      {open && (
        <ContainerCascade
          value={value}
          itemType={itemType}
          allowUnassigned={allowUnassigned}
          onClose={() => setOpen(false)}
          onPick={(id, lbl) => {
            if (id !== null) setMadeLabel({ id, label: lbl })
            onChange(id)
            setOpen(false)
          }}
        />
      )}
    </>
  )
}

/** Minimal inline "new container": which location, its name, what kind. */
export function NewContainerForm({
  initialName, itemType, onDone, onCancel,
}: {
  initialName: string
  itemType?: string | null
  onDone: (containerId: number, label: string) => void
  onCancel: () => void
}) {
  const { data: locations } = useLocations()
  const add = useAddContainer()
  const [locationId, setLocationId] = useState<number | null>(null)
  const [name, setName] = useState(initialName)
  const [type, setType] = useState<ContainerType>('dry')
  const [error, setError] = useState<string | null>(null)
  const locs = (locations ?? []).slice().sort((a, b) =>
    a.compartment_name.localeCompare(b.compartment_name) || a.location_name.localeCompare(b.location_name))
  // Food defaults to the Galley compartment's locations first.
  const orderedLocs = itemType === 'food'
    ? [...locs.filter((l) => l.compartment_name === GALLEY), ...locs.filter((l) => l.compartment_name !== GALLEY)]
    : locs
  const loc = locs.find((l) => l.location_id === locationId)

  const create = () => {
    if (locationId === null || !name.trim()) return
    setError(null)
    add.mutate({ location_id: locationId, name: name.trim(), container_type: type }, {
      onSuccess: (res) => {
        const id = (res as { container_id: number }).container_id
        onDone(id, `${loc?.compartment_name} › ${loc?.location_name} › ${name.trim()}`)
      },
      onError: (err) => setError(`Could not add the container: ${(err as Error).message}`),
    })
  }

  return (
    <div className="recipe-review-new">
      <strong>New container</strong>
      <div className="search-pick-field">
        <span>In</span>
        <SearchPick<Location>
          options={orderedLocs}
          keyOf={(l) => l.location_id}
          labelOf={(l) => `${l.compartment_name} › ${l.location_name}`}
          value={locationId}
          onPick={(k) => setLocationId(k === null ? null : Number(k))}
          placeholder="Type to find the location…"
          newLabel={(t) => (t ? `＋ New location “${t}”…` : '＋ New location…')}
          renderNew={(typed, done, cancel) => <NewLocationForm initialName={typed} onDone={done} onCancel={cancel} />}
        />
      </div>
      <label>
        Name
        <input
          value={name} autoFocus onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); create() }
            if (e.key === 'Escape') { e.preventDefault(); onCancel() }
          }}
        />
      </label>
      <label>
        Kind
        <select value={type} onChange={(e) => setType(e.target.value as ContainerType)}>
          {CONTAINER_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
        </select>
      </label>
      <button type="button" disabled={locationId === null || !name.trim() || add.isPending} onClick={create}>
        ✓ Add and use
      </button>
      <button type="button" onClick={onCancel}>✕</button>
      {error && <span className="mgmt-status mgmt-status--error">{error}</span>}
    </div>
  )
}

/** Minimal inline "new location" inside an existing compartment (a new compartment - a whole
 *  new area of the boat - is rare enough to stay in Edit Storage Structure). */
function NewLocationForm({
  initialName, onDone, onCancel,
}: { initialName: string; onDone: (locationId: number, label: string) => void; onCancel: () => void }) {
  const { data: compartments } = useCompartments()
  const add = useAddLocation()
  const [compartmentId, setCompartmentId] = useState<number | null>(null)
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const comps: Compartment[] = (compartments ?? []).slice().sort((a, b) => a.compartment_name.localeCompare(b.compartment_name))
  const create = () => {
    if (compartmentId === null || !name.trim()) return
    setError(null)
    add.mutate({ compartment_id: compartmentId, name: name.trim() }, {
      onSuccess: (res) => {
        const comp = comps.find((c) => c.compartment_id === compartmentId)
        onDone((res as { location_id: number }).location_id, `${comp?.compartment_name} › ${name.trim()}`)
      },
      onError: (err) => setError(`Could not add the location: ${(err as Error).message}`),
    })
  }
  return (
    <div className="recipe-review-new">
      <strong>New location</strong>
      <label>
        Compartment
        <select value={compartmentId ?? ''} onChange={(e) => setCompartmentId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">— pick —</option>
          {comps.map((c) => <option key={c.compartment_id} value={c.compartment_id}>{c.compartment_name}</option>)}
        </select>
      </label>
      <label>
        Name
        <input
          value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); create() }
            if (e.key === 'Escape') { e.preventDefault(); onCancel() }
          }}
        />
      </label>
      <button type="button" disabled={compartmentId === null || !name.trim() || add.isPending} onClick={create}>✓ Add</button>
      <button type="button" onClick={onCancel}>✕</button>
      {error && <span className="mgmt-status mgmt-status--error">{error}</span>}
    </div>
  )
}

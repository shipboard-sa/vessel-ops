/**
 * Purpose: The two full-screen storage overlays - ContainerCascade (pick a container) and
 *   StorageMoveDialog (pick where a location or container moves to) - both over StorageColumns.
 * Version: v3 (2026-09-24) - v3: the overlay is the shared components/TapColumns TapOverlay. v2: the columns moved out to StorageColumns.tsx (shared with Edit
 *   Storage Structure); ⭐ toggles on container rows; StorageMoveDialog added. v1 same day.
 * Scope: PRODUCTION - mx-inv frontend, warehouse feature.
 * Architecture: ContainerCascade is opened by ContainerPicker (every place stock is put
 *   somewhere); StorageMoveDialog by StorageStructureTab's "Move to…". Fixed overlays, not
 *   FocusScreens, because they open inside forms / edit panels whose state must survive; portalled
 *   to <body> so host descendant rules (e.g. `.add-item-form button`) cannot restyle them.
 */
import { useState } from 'react'
import { TapOverlay } from '../../components/TapColumns'
import { useContainers } from './useWarehouse'
import { EMPTY_SEL, StorageColumns, type StorageSel } from './StorageColumns'

export function ContainerCascade({
  value, itemType, allowUnassigned, onPick, onClose,
}: {
  value: number | null
  itemType?: string | null
  allowUnassigned: boolean
  onPick: (containerId: number | null, label: string) => void
  onClose: () => void
}) {
  const { data: containers } = useContainers()
  const conts = containers ?? []
  const current = conts.find((c) => c.container_id === value) ?? null
  // Open on the current value's path, so "change it" starts where it already is.
  const [sel, setSel] = useState<StorageSel>(current
    ? { compId: current.compartment_id, locId: current.location_id, containerId: current.container_id }
    : EMPTY_SEL)
  const favorites = conts.filter((c) => c.favorite)
    .sort((a, b) => a.compartment_name.localeCompare(b.compartment_name)
      || a.location_name.localeCompare(b.location_name) || a.container_name.localeCompare(b.container_name))
  const selComp = conts.find((c) => c.compartment_id === sel.compId)?.compartment_name
  const selLoc = conts.find((c) => c.location_id === sel.locId)?.location_name

  return (
    <TapOverlay
      title="Where does it go?"
      path={<>{selComp ?? 'Pick a compartment'}{selLoc && <> › {selLoc}</>}</>}
      onClose={onClose}
    >
      {(favorites.length > 0 || allowUnassigned) && (
        <div className="cc-favs">
          {favorites.map((c) => (
            <button
              key={c.container_id} type="button"
              className={`cc-chip${c.container_id === value ? ' cc-chip--on' : ''}`}
              onClick={() => onPick(c.container_id, `${c.compartment_name} › ${c.location_name} › ${c.container_name}`)}
            >
              ⭐ {c.location_name} › {c.container_name}
              <span className="cc-dim"> · {c.compartment_name}</span>
            </button>
          ))}
          {allowUnassigned && (
            <button type="button" className="cc-chip cc-chip--none" onClick={() => onPick(null, '')}>
              — unassigned —
            </button>
          )}
        </div>
      )}
      <StorageColumns
        sel={sel}
        itemType={itemType}
        starToggle
        onSelect={(next, label) => {
          if (next.containerId !== null) onPick(next.containerId, label ?? '')
          else setSel(next)
        }}
      />
    </TapOverlay>
  )
}

/** Pick where something moves: a compartment (depth 1, for a location) or a location (depth 2,
 *  for a container). "＋ New …" works here too - move it into a place made on the spot. */
export function StorageMoveDialog({
  what, depth, here, onMove, onClose,
}: {
  what: string
  depth: 1 | 2
  here: { compId?: number; locId?: number }
  /** targetId = the compartment (depth 1) or location (depth 2); compId = its compartment. */
  onMove: (targetId: number, compId: number) => void
  onClose: () => void
}) {
  const [sel, setSel] = useState<StorageSel>(EMPTY_SEL)
  return (
    <TapOverlay title={`Move “${what}” to…`} path={depth === 1 ? 'Pick the compartment' : 'Pick the compartment, then the location'} onClose={onClose}>
      <StorageColumns
        sel={sel}
        depth={depth}
        here={here}
        onSelect={(next) => {
          if (depth === 1 && next.compId !== null) onMove(next.compId, next.compId)
          else if (depth === 2 && next.locId !== null && next.compId !== null) onMove(next.locId, next.compId)
          else setSel(next)
        }}
      />
    </TapOverlay>
  )
}

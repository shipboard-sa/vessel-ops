/**
 * Purpose: The Inventory Audit's "parts linked to no device" review - lists every part and
 *   spare unit that serves no system/device, and opens each on its own screen to link it.
 * Version: v2 (2026-09-23)
 *   - v2: the opened part's name opens its item record (tracker #74).
 * Scope: PRODUCTION - mx-inv frontend, warehouse feature.
 * Architecture: Rendered by AuditTab (its "Parts with no device" mode). Reads
 *   GET /api/items/unlinked-parts (data.list_unlinked_parts); a row opens a FocusScreen with
 *   the item's free-text hints and the shared ServesEditor (pick list, saves immediately via
 *   PUT /api/items/{id}/systems). Linking invalidates the list and the Restock Serves column, so
 *   the row drops off. Tracker #17 step 3 (the owner 2026-09-19: "no longer needed" and "linked to no
 *   device" belong in the Inventory Audit review); every part can link to a whole top-level
 *   system, so there is deliberately no "no device needed" flag.
 */
import { useState } from 'react'
import { useItemTypes, useUnlinkedParts } from './useWarehouse'
import { typeLabel } from './catalogDisplay'
import { ServesEditor } from './ServesEditor'
import { FocusScreen, useFocusTrail } from '../../components/FocusScreen'
import type { UnlinkedPart } from '../../api/types'
import { RecordLink } from '../../components/RecordLink'

const HINT_CHARS = 90

/** The one line the list shows: what it "fits" if known, else the start of its notes. */
function hintOf(p: UnlinkedPart): string {
  const text = (p.fits_system || p.notes || '').trim()
  return text.length > HINT_CHARS ? `${text.slice(0, HINT_CHARS)}…` : text
}

export function UnlinkedPartsReview() {
  const { data: parts, isLoading, isError, error } = useUnlinkedParts()
  const { data: itemTypes } = useItemTypes()
  const focus = useFocusTrail<number>()
  // The opened row is kept here: once its first link is saved it leaves the list, but the
  // screen must stay put so more devices can be added.
  const [opened, setOpened] = useState<UnlinkedPart | null>(null)

  if (isLoading) return <p className="mgmt-status">Loading…</p>
  if (isError) return <p className="mgmt-status mgmt-status--error">{(error as Error).message}</p>
  if (!parts) return null

  const stillUnlinked = opened ? parts.some((p) => p.item_id === opened.item_id) : false

  return (
    <div className="unlinked-review">
      {focus.current !== null && opened && (
        <FocusScreen focus={focus} listLabel="Parts with no device" labelOf={() => opened.item_name}>
          <h3><RecordLink to={{ kind: 'item', id: opened.item_id }}>{opened.item_name}</RecordLink></h3>
          <p className="mgmt-status">
            {typeLabel(itemTypes, opened.item_type)} · on hand {opened.quantity_onhand} {opened.unit}
            {opened.manufacturer ? ` · ${opened.manufacturer}` : ''}
            {opened.part_number ? ` · ${opened.part_number}` : ''}
          </p>
          {opened.fits_system && <p><strong>Fits:</strong> {opened.fits_system}</p>}
          {opened.notes && <p className="unlinked-notes"><strong>Notes:</strong> {opened.notes}</p>}
          <ServesEditor itemId={opened.item_id} itemType={opened.item_type} />
          {!stillUnlinked && (
            <p className="mgmt-status">
              ✅ Linked — it has left the "no device" list. Add more devices above, or go Back.
            </p>
          )}
          <p className="mgmt-status">
            No fitting device? Link it to the nearest whole system (each is offered as "(whole system)").
          </p>
        </FocusScreen>
      )}

      <div hidden={focus.current !== null}>
        <p className="mgmt-status">
          Parts and spare units that are not linked to any system or device. Open one and pick where it
          belongs; it drops off this list once linked. (Tools, supplies and food are not linked by design.)
        </p>
        {parts.length === 0 ? (
          <p className="mgmt-status">✅ Every part and spare unit is linked to a device or system.</p>
        ) : (
          <table className="warehouse-table">
            <thead>
              <tr><th>Type</th><th>Item</th><th>On hand</th><th>Hint</th></tr>
            </thead>
            <tbody>
              {parts.map((p) => (
                <tr key={p.item_id}>
                  <td>{typeLabel(itemTypes, p.item_type)}</td>
                  <td>
                    <button
                      type="button" className="link-button"
                      onClick={() => { setOpened(p); focus.open(p.item_id) }}
                    >
                      {p.item_name}
                    </button>
                  </td>
                  <td>{p.quantity_onhand} {p.unit}</td>
                  <td className="unlinked-hint">{hintOf(p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

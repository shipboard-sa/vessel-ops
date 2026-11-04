/**
 * Purpose: The Inventory Audit's "tool accessories with no parent tool" review - lists every
 *   tool_accessory linked to no tool, and opens each on its own screen to link it. The natural
 *   finishing pass for the tool-accessory data load once "Work a Container" has placed the
 *   physical stock.
 * Version: v2 (2026-09-23)
 *   - v2: the opened accessory's name opens its item record (tracker #74).
 * Scope: PRODUCTION - mx-inv frontend, warehouse feature.
 * Architecture: Rendered by AuditTab (a new "Accessories with no tool" mode, sibling to "Parts
 *   with no device"). Reads GET /api/items/unlinked-tool-accessories (data.list_unlinked_
 *   tool_accessories); a row opens a FocusScreen with the item's spec hint and the shared
 *   ToolLinksEditor (v29 many-to-many, PUT /api/items/{id}/tool-links). Linking invalidates the
 *   list, so the row drops off. the owner, 2026-09-22: "accessories w/o parents are good to work on -
 *   that would be my natural starting point to finish doing the initial data load."
 */
import { useState } from 'react'
import { useUnlinkedToolAccessories } from './useWarehouse'
import { ToolLinksEditor } from './ToolLinksEditor'
import { FocusScreen, useFocusTrail } from '../../components/FocusScreen'
import type { UnlinkedToolAccessory } from '../../api/types'
import { RecordLink } from '../../components/RecordLink'

export function UnlinkedToolAccessoriesReview() {
  const { data: rows, isLoading, isError, error } = useUnlinkedToolAccessories()
  const focus = useFocusTrail<number>()
  // The opened row is kept here: once its first link is saved it leaves the list, but the
  // screen must stay put so more tools can be added (same pattern as UnlinkedPartsReview).
  const [opened, setOpened] = useState<UnlinkedToolAccessory | null>(null)

  if (isLoading) return <p className="mgmt-status">Loading…</p>
  if (isError) return <p className="mgmt-status mgmt-status--error">{(error as Error).message}</p>
  if (!rows) return null

  const stillUnlinked = opened ? rows.some((r) => r.item_id === opened.item_id) : false

  return (
    <div className="unlinked-review">
      {focus.current !== null && opened && (
        <FocusScreen focus={focus} listLabel="Accessories with no tool" labelOf={() => opened.item_name}>
          <h3><RecordLink to={{ kind: 'item', id: opened.item_id }}>{opened.item_name}</RecordLink></h3>
          <p className="mgmt-status">
            on hand {opened.quantity_onhand} {opened.unit}
            {opened.spec ? ` · ${opened.spec}` : ''}
          </p>
          {opened.notes && <p className="unlinked-notes"><strong>Notes:</strong> {opened.notes}</p>}
          <ToolLinksEditor itemId={opened.item_id} />
          {!stillUnlinked && (
            <p className="mgmt-status">
              ✅ Linked — it has left the "no tool" list. Add more tools above, or go Back.
            </p>
          )}
        </FocusScreen>
      )}

      <div hidden={focus.current !== null}>
        <p className="mgmt-status">
          Tool accessories (bits, blades, attachments) not linked to any tool. Open one and pick
          which tool(s) it fits - an accessory can belong to more than one (same-size sanding
          discs across two sanders, for example). It drops off this list once linked.
        </p>
        {rows.length === 0 ? (
          <p className="mgmt-status">✅ Every tool accessory is linked to a tool.</p>
        ) : (
          <table className="warehouse-table">
            <thead>
              <tr><th>Item</th><th>On hand</th><th>Spec</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.item_id}>
                  <td>
                    <button
                      type="button" className="link-button"
                      onClick={() => { setOpened(r); focus.open(r.item_id) }}
                    >
                      {r.item_name}
                    </button>
                  </td>
                  <td>{r.quantity_onhand} {r.unit}</td>
                  <td className="unlinked-hint">{r.spec ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

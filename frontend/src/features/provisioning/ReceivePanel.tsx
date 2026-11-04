/**
 * Purpose: The Galley "Received something?" box - record stock that came aboard
 *   for ANY food item, including one that is not in the catalog yet (a foreign
 *   market always has surprises): pick an item, or add a brand-new one on the spot,
 *   then say how much, where it went and its expiry.
 * Version: v3 (2026-09-23)
 *   - v3: one type-to-search FoodPick with "＋ Add '<typed>' as a new food item" as the FIRST row
 *     (created inline, then straight into receiving it) - no separate new-item button (tracker #76).
 *   - v2: the picked item's name and the "✅ Received" note's name open the item (tracker #74).
 * Scope: PRODUCTION - mx-inv frontend, provisioning feature.
 * Architecture: Rendered by ProvisioningView beside the cart. Reuses the cart rows'
 *   warehouse/ReceiveAction (a stock lot with reason 'restock', which also clears a
 *   "we need more" request) and the shared warehouse/NewFoodItemForm for a new item.
 */
import { useState } from 'react'
import { FoodPick } from '../warehouse/ItemPick'
import { ReceiveAction } from '../warehouse/ReceiveAction'
import { RecordLink } from '../../components/RecordLink'

interface Target { itemId: number; name: string; unit: string }

export function ReceivePanel() {
  const [target, setTarget] = useState<Target | null>(null)
  // The last item received - shown as "✅ Received <name>" with the name opening the item.
  const [note, setNote] = useState<Target | null>(null)

  return (
    <div className="prov-receive-panel">
      <strong>🧺 Received something?</strong>
      {!target && (
        <>
          <FoodPick
            value={null}
            placeholder="Type what came aboard…"
            onPick={(p) => { if (p) { setNote(null); setTarget({ itemId: p.itemId, name: p.itemName, unit: p.unit ?? 'ea' }) } }}
          />
          {note && (
            <span className="mgmt-status">
              ✅ Received <RecordLink to={{ kind: 'item', id: note.itemId }}>{note.name}</RecordLink>.
            </span>
          )}
        </>
      )}
      {target && (
        <span className="prov-receive-target">
          <em><RecordLink to={{ kind: 'item', id: target.itemId }}>{target.name}</RecordLink></em>
          <ReceiveAction
            key={target.itemId}
            itemId={target.itemId} itemName={target.name} unit={target.unit} startOpen itemType="food"
            onReceived={() => {
              setNote(target)
              setTimeout(() => setTarget(null), 1500)
            }}
          />
          <button type="button" className="link-button" onClick={() => setTarget(null)}>cancel</button>
        </span>
      )}
    </div>
  )
}

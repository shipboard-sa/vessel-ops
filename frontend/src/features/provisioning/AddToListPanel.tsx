/**
 * Purpose: The Galley cart's "need something?" box - put any existing food item on
 *   the shopping list, or add a brand-new item and put it on the list in one step.
 * Version: v2 (2026-09-23) - v2: one type-to-search FoodPick; tapping an item puts it on the list
 *   at once, and "＋ Add '<typed>' as a new food item" is the FIRST row (created inline, "Put it on
 *   the shopping list" pre-ticked) - no separate new-item button (tracker #76). v1 (2026-09-19)
 * Scope: PRODUCTION - mx-inv frontend, provisioning feature.
 * Architecture: Rendered by ProvisioningView above the shopping list. Uses
 *   warehouse/onList.useSetOnList (items.on_list_since, schema v25) and the shared
 *   warehouse/NewFoodItemForm. A requested item shows on the cart with at least one
 *   unit to buy and stays until it is received (data.add_stock clears it).
 */
import { useState } from 'react'
import { FoodPick } from '../warehouse/ItemPick'
import { useSetOnList } from '../warehouse/onList'

export function AddToListPanel() {
  const setOnList = useSetOnList()
  const [message, setMessage] = useState<string | null>(null)

  return (
    <div className="prov-add-to-list">
      <strong>➕ Need something?</strong>
      <FoodPick
        value={null}
        putOnList
        disabled={setOnList.isPending}
        placeholder="Type a food item to put on the list…"
        onPick={(p) => {
          if (!p) return
          if (!p.row) {
            // Just created by the inline form - it already put it on the list if that box was ticked.
            setMessage(`📝 “${p.itemName}” is in the catalog (and on the shopping list if that box was ticked).`)
            return
          }
          setMessage(null)
          setOnList.mutate(
            { itemId: p.itemId, onList: true },
            { onSuccess: () => setMessage(`📝 “${p.itemName}” is on the shopping list.`) },
          )
        }}
      />
      {message && <span className="mgmt-status">{message}</span>}
      {setOnList.isError && <span className="mgmt-status mgmt-status--error">{(setOnList.error as Error).message}</span>}
    </div>
  )
}

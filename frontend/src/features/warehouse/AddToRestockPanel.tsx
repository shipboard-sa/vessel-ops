/**
 * Purpose: The Restock List's "need something?" box - put any existing non-food item
 *   (spare, part, supply, tool, gear) on the shopping list, or add a brand-new item and
 *   put it on the list in one step. The "stuff cart" twin of the Galley's food add box.
 * Version: v2 (2026-09-23) - v2: one StuffPick (type to find, "＋ Add '<typed>' as a new item"
 *   FIRST, shared NewStuffItemForm) - picking or creating puts it straight on the list; the private
 *   new-item form is gone (tracker #76). v1 2026-09-19.
 * Scope: PRODUCTION - mx-inv frontend, warehouse feature.
 * Architecture: Rendered at the top of RestockTab. Uses the same items.on_list_since
 *   request as the Galley cart (warehouse/onList.useSetOnList, schema v25); the server's
 *   data.items_below_minimum lists a requested non-food item with at least one unit to
 *   buy, and receiving stock clears the request (data.add_stock). A brand-new item is
 *   created with just a name, type and unit - details are finished later in the Locker.
 *   Tracker #23 (the owner 2026-09-19: "where do I enter items I just want to buy").
 */
import { useState } from 'react'
import { useSetOnList } from './onList'
import { StuffPick } from './ItemPick'

export function AddToRestockPanel() {
  const setOnList = useSetOnList()
  const [message, setMessage] = useState<string | null>(null)
  // Bumped after each add so the picker resets to empty for the next thing.
  const [round, setRound] = useState(0)

  return (
    <div className="restock-add">
      <strong>➕ Need something?</strong>
      <StuffPick
        key={round}
        value={null}
        placeholder="🔍 Type an item to put on the list…"
        defaultType="supply"
        createLabel="✓ Create and put on the list"
        disabled={setOnList.isPending}
        onPick={(picked) => {
          if (!picked) return
          setMessage(null)
          setOnList.mutate(
            { itemId: picked.itemId, onList: true },
            {
              onSuccess: () => {
                setMessage(picked.row
                  ? `📝 “${picked.itemName}” is on the shopping list.`
                  : `📝 “${picked.itemName}” is in the catalog and on the shopping list. Finish its details from the Locker whenever you like.`)
                setRound((r) => r + 1)
              },
            },
          )
        }}
      />
      {message && <span className="mgmt-status">{message}</span>}
      {setOnList.isError && <span className="mgmt-status mgmt-status--error">{(setOnList.error as Error).message}</span>}
    </div>
  )
}

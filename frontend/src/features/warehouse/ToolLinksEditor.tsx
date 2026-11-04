/**
 * Purpose: Edit which tools a tool_accessory belongs to - chips for the current links plus
 *   a pick list to add one. Saves immediately, same pattern as ServesEditor (part <-> device).
 * Version: v4 (2026-09-23) - v4: the tool pick is StuffPick (type to search, "＋ Add '<typed>' as a
 *   new tool" first, type locked to tool) instead of a plain <select> (tracker #76). v3: each tool chip's name opens that tool (tracker #74; ✕ stays
 *   a separate unlink button). v2 (tracker #75/#76): "＋ New tool…" first in the pick list creates
 *   the tool inline (NewStuffItemForm, type locked to tool) and links it. v1 was 2026-09-22.
 * Scope: PRODUCTION - mx-inv frontend, warehouse feature.
 * Architecture: Mounted by ItemDetailPanel for tool_accessory items. Reads
 *   GET /api/items/{id}/tool-links and the tool catalog (useItems('tool')); writes
 *   PUT /api/items/{id}/tool-links (replace-set, FK + type-checked server-side, mirrors
 *   set_item_systems). Many-to-many (v29 tool_accessory_tools) - an accessory can belong to
 *   more than one tool (the owner, 2026-09-22: same-size sanding discs across two sanders), unlike
 *   the old single parent_tool_item_id it replaced.
 */
import { useState } from 'react'
import { useAccessoryTools, useItems } from './useWarehouse'
import { useSetAccessoryTools } from './mutations'
import { ApiError } from '../../api/client'
import { StuffPick } from './ItemPick'
import { RecordLink } from '../../components/RecordLink'

export function ToolLinksEditor({ itemId }: { itemId: number }) {
  const { data: linked } = useAccessoryTools(itemId)
  const { data: tools } = useItems('tool')
  const setLinks = useSetAccessoryTools()
  // Bumped after each link so the picker resets to empty for the next one.
  const [round, setRound] = useState(0)

  if (!linked || !tools) return null
  const linkedSet = new Set(linked)
  const nameOf = (id: number) => tools.find((t) => t.item_id === id)?.item_name ?? `#${id}`

  const save = (next: number[]) => setLinks.mutate({ itemId, toolItemIds: next })

  return (
    <div className="serves-editor">
      <h4>Belongs to these tools</h4>
      {linked.length === 0 && (
        <p className="mgmt-status">Not linked to any tool yet — pick the tool(s) this fits.</p>
      )}
      <ul className="serves-chips">
        {linked.map((id) => (
          <li key={id}>
            <RecordLink to={{ kind: 'item', id }}>{nameOf(id)}</RecordLink>
            <button type="button" title="Unlink" onClick={() => save(linked.filter((x) => x !== id))}>✕</button>
          </li>
        ))}
      </ul>
      <StuffPick
        key={round}
        value={null}
        placeholder="+ add a tool - type to find it…"
        defaultType="tool" lockType createLabel="✓ Create the tool and link it"
        excludeIds={linkedSet}
        disabled={setLinks.isPending}
        onPick={(p) => {
          if (!p) return
          if (!linkedSet.has(p.itemId)) save([...linked, p.itemId])
          setRound((r) => r + 1)
        }}
      />
      {setLinks.error && (
        <p className="mgmt-status mgmt-status--error">
          {setLinks.error instanceof ApiError
            ? ((setLinks.error.detail as { message?: string } | undefined)?.message ?? setLinks.error.message)
            : (setLinks.error as Error).message}
        </p>
      )}
    </div>
  )
}

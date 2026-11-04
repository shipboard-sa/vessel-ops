/**
 * Purpose: Full-record editor for one warehouse item - edit form, stock lots
 *   (edit / add / delete), delete item.
 * Version: v9 (2026-09-23) - v9: a TOOL's record lists its accessories ("Accessories for this
 *   tool", ToolAccessoriesEditor - each opens; "＋ Add accessory" is a StuffPick locked to
 *   tool_accessory that links through the accessory's own /tool-links; GET /items/{id}/accessories)
 *   (tracker #76). v8: a stock lot's place opens that container in the Locker; linked
 *   tools and served devices open via ToolLinksEditor / ServesEditor (tracker #74). v7 adds ToolLinksEditor (which tool(s) a tool_accessory belongs
 *   to - many-to-many, v29 tool_accessory_tools) beside ServesEditor. v6, same day: the
 *   ToolAccessoryDetailsFields block (spec) for tool_accessory items - the schema/backend
 *   write path already existed but no screen ever exposed it (Owner: working through the tool
 *   accessory linking backlog, needs the GUI for it); v6's single "belongs to tool" picker
 *   moved into ToolLinksEditor same-day once the owner flagged a shared accessory (same-size
 *   sanding discs across two sanders) needs more than one link. v5 was 2026-09-21
 *   (shopping-list toggle).
 * Scope: PRODUCTION - mx-inv frontend, warehouse feature.
 * Architecture: Rendered by LockerTab inside a <FocusScreen>, which supplies the
 *   "Back to locker" button; onClose is that same Back and is also called after
 *   the item is deleted. Uses ./useWarehouse queries and ./mutations. Unit is
 *   edited with the shared governed components/UnitPicker (v3; was free text).
 *   v4: food items show the FoodDetailsFields block (category, stowage, shelf
 *   life, provisioning decision) and save it with the item.
 */
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useItem, useItemStock, useItemTypes, useStockingPolicies, useToolAccessories } from './useWarehouse'
import {
  useAddStock,
  useDeleteItem,
  useDeleteStock,
  useSetAccessoryTools,
  useUpdateItem,
  useUpdateStock,
  type ItemEditFields,
} from './mutations'
import { ContainerPicker } from './ContainerPicker'
import { policyDescription, typeLabel } from './catalogDisplay'
import { UnitPicker } from '../../components/UnitPicker'
import { ThresholdFields } from './ThresholdFields'
import {
  FoodDetailsFields, foodDetailsPayload, foodValuesFrom, foodValuesProblem,
  type FoodDetailValues,
} from './FoodDetailsFields'
import {
  ToolAccessoryDetailsFields, toolAccessoryDetailsPayload, toolAccessoryValuesFrom,
  type ToolAccessoryDetailValues,
} from './ToolAccessoryDetailsFields'
import { ToolLinksEditor } from './ToolLinksEditor'
import { StuffPick } from './ItemPick'
import { ServesEditor } from './ServesEditor'
import { ApiError, apiGet } from '../../api/client'
import { useConfirm } from '../../components/ConfirmDialog'
import { useSetOnList } from './onList'
import { RecordLink } from '../../components/RecordLink'

export function ItemDetailPanel({ itemId, onClose }: { itemId: number; onClose: () => void }) {
  const { data: item } = useItem(itemId)
  const { data: policies } = useStockingPolicies()
  const { data: itemTypes } = useItemTypes()
  const updateItem = useUpdateItem()
  const deleteItem = useDeleteItem()
  const setOnList = useSetOnList()
  const confirm = useConfirm()
  const [fields, setFields] = useState<ItemEditFields>({})
  const [food, setFood] = useState<FoodDetailValues>(() => foodValuesFrom(undefined))
  const [toolAcc, setToolAcc] = useState<ToolAccessoryDetailValues>(() => toolAccessoryValuesFrom(undefined))

  useEffect(() => {
    if (item) {
      setFields({
        item_name: item.item_name,
        item_type: item.item_type,
        unit: item.unit,
        min_quantity: item.min_quantity,
        target_quantity: item.target_quantity,
        min_hold: item.min_hold,
        annual_usage: item.annual_usage,
        stocking_policy: item.stocking_policy,
        notes: item.notes ?? '',
      })
      setFood(foodValuesFrom(item.details))
      setToolAcc(toolAccessoryValuesFrom(item.details))
    }
  }, [item?.item_id])

  if (!item) return null

  const set = <K extends keyof ItemEditFields>(key: K, value: ItemEditFields[K]) =>
    setFields((f) => ({ ...f, [key]: value }))

  // Changing type deletes the old type's detail row (part number / food fields /
  // accessory spec), so say what will be lost before doing it.
  const confirmTypeChange = async (): Promise<boolean> => {
    if (!fields.item_type || fields.item_type === item.item_type) return true
    const lost = Object.entries(item.details ?? {}).filter(([, v]) => v !== null && v !== '' && v !== undefined)
    const from = typeLabel(itemTypes, item.item_type)
    const to = typeLabel(itemTypes, fields.item_type)
    return confirm({
      title: `Change "${item.item_name}" from ${from} to ${to}?`,
      message: [
        lost.length ? `This discards its ${from} details: ${lost.map(([k, v]) => `${k} = ${String(v)}`).join(', ')}.` : '',
        item.item_type === 'food' ? 'Recipes and the galley lists only see Food items, so it will drop out of those pickers.' : '',
      ].filter(Boolean).join('\n\n') || undefined,
      confirmLabel: 'Change type',
      cancelLabel: "Don't change",
    })
  }

  return (
    <div className="item-detail">
      <div className="item-detail-header">
        <h2>{item.item_name}</h2>
      </div>
      <p className="mgmt-status">On hand: {item.quantity_onhand} {item.unit}</p>
      <p className="item-on-list">
        {item.on_list_since ? (
          <>
            📝 On the shopping list since {item.on_list_since}{' '}
            <button type="button" disabled={setOnList.isPending}
              onClick={() => setOnList.mutate({ itemId: item.item_id, onList: false })}>
              Take it off the list
            </button>
          </>
        ) : (
          <button type="button" disabled={setOnList.isPending}
            onClick={() => setOnList.mutate({ itemId: item.item_id, onList: true })}>
            📝 Put on the shopping list
          </button>
        )}
      </p>

      <div className="item-detail-row">
        <label>
          Name
          <input
            type="text" value={fields.item_name ?? ''}
            onChange={(e) => set('item_name', e.target.value)}
          />
        </label>
        <label>
          Type
          <select value={fields.item_type ?? item.item_type} onChange={(e) => set('item_type', e.target.value)}>
            {itemTypes?.map((t) => (
              <option key={t.type_key} value={t.type_key} title={t.description}>{typeLabel(itemTypes, t.type_key)}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="item-detail-row">
        <label>
          Unit
          <UnitPicker value={fields.unit ?? null} onChange={(u) => set('unit', u ?? undefined)} />
        </label>
        <label>
          Stocking policy
          <select
            value={fields.stocking_policy}
            onChange={(e) => set('stocking_policy', e.target.value)}
          >
            {policies?.map((p) => (
              <option key={p.policy_key} value={p.policy_key} title={p.description}>{p.label}</option>
            ))}
          </select>
        </label>
      </div>
      {fields.stocking_policy && (
        <p className="item-policy-hint">{policyDescription(policies, fields.stocking_policy)}</p>
      )}
      <ThresholdFields
        policy={fields.stocking_policy}
        values={{
          min_quantity: fields.min_quantity ?? 0,
          target_quantity: fields.target_quantity ?? null,
          min_hold: fields.min_hold ?? null,
        }}
        onChange={(next) => setFields((f) => ({ ...f, ...next }))}
      />
      {(fields.item_type ?? item.item_type) === 'food' && (
        <FoodDetailsFields
          value={food}
          unit={fields.unit ?? item.unit}
          onChange={(next) => setFood((f) => ({ ...f, ...next }))}
        />
      )}
      {(fields.item_type ?? item.item_type) === 'tool_accessory' && (
        <ToolAccessoryDetailsFields
          value={toolAcc}
          onChange={(next) => setToolAcc((t) => ({ ...t, ...next }))}
        />
      )}
      <label>
        Notes
        <textarea rows={2} value={fields.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
      </label>

      <div className="item-detail-actions">
        <button
          type="button"
          onClick={async () => {
            if (!(await confirmTypeChange())) return
            const type = fields.item_type ?? item.item_type
            const details = type === 'food' ? foodDetailsPayload(food)
              : type === 'tool_accessory' ? toolAccessoryDetailsPayload(toolAcc)
                : undefined
            updateItem.mutate(
              { itemId: item.item_id, fields: details ? { ...fields, details } : fields },
              { onSuccess: onClose }, // Save returns to the locker list (the owner 2026-09-19)
            )
          }}
          disabled={
            updateItem.isPending || !(fields.item_name ?? '').trim()
            || ((fields.item_type ?? item.item_type) === 'food' && foodValuesProblem(food) !== null)
          }
        >
          💾 Save item
        </button>
        <button
          type="button"
          className="danger"
          onClick={async () => {
            if (await confirm({
              title: `Delete "${item.item_name}"?`,
              message: `Its stock (${item.quantity_onhand} ${item.unit} on hand) is deleted with it.`,
              confirmLabel: 'Delete item',
            })) {
              deleteItem.mutate(item.item_id, { onSuccess: onClose })
            }
          }}
        >
          🗑 Delete
        </button>
      </div>

      {updateItem.error && (
        <p className="mgmt-status mgmt-status--error">
          {updateItem.error instanceof ApiError && updateItem.error.status === 409
            ? `An item named "${(updateItem.error.detail as { item_name?: string })?.item_name ?? fields.item_name}" already exists in this type.`
            : updateItem.error instanceof ApiError && (updateItem.error.detail as { message?: string } | undefined)?.message
              ? (updateItem.error.detail as { message: string }).message
              : (updateItem.error as Error).message}
        </p>
      )}

      <ServesEditor itemId={item.item_id} itemType={item.item_type} />
      {item.item_type === 'tool_accessory' && <ToolLinksEditor itemId={item.item_id} />}
      {item.item_type === 'tool' && <ToolAccessoriesEditor toolId={item.item_id} />}

      <StockEditor itemId={item.item_id} itemType={item.item_type} />
    </div>
  )
}

function StockEditor({ itemId, itemType }: { itemId: number; itemType: string }) {
  const { data: lots } = useItemStock(itemId)
  const updateStock = useUpdateStock()
  const deleteStock = useDeleteStock()
  const addStock = useAddStock()
  const confirm = useConfirm()
  const [newQty, setNewQty] = useState(1)
  const [newContainer, setNewContainer] = useState<number | null>(null)

  return (
    <div className="stock-editor">
      <h4>Stock — where it is and how much</h4>
      {!lots || lots.length === 0 ? (
        <p className="mgmt-status">No stock recorded yet.</p>
      ) : (
        <ul className="stock-lots">
          {lots.map((lot) => (
            <li key={lot.stock_id}>
              <input
                type="number" min={0} step={0.5} defaultValue={lot.quantity}
                onBlur={(e) => {
                  const quantity = Number(e.target.value)
                  if (quantity !== lot.quantity) {
                    updateStock.mutate({ stockId: lot.stock_id, fields: { quantity } })
                  }
                }}
              />
              <ContainerPicker
                value={lot.container_id} itemType={itemType}
                onChange={(container_id) => updateStock.mutate({ stockId: lot.stock_id, fields: { container_id } })}
              />
              <RecordLink
                className="stock-lot-loc" title="Open this container in the Locker"
                to={lot.container_id ? { kind: 'container', id: lot.container_id } : null}
              >
                {lot.compartment_name ? `${lot.compartment_name} › ${lot.location_name}` : '—'}
              </RecordLink>
              <button
                type="button" title="Delete lot"
                onClick={async () => {
                  const where = lot.container_name ? ` in ${lot.location_name} › ${lot.container_name}` : ''
                  if (await confirm({
                    title: `Delete this stock row${where}?`,
                    message: `${lot.quantity} on hand is removed from the count. To keep the location as this item's home, set the quantity to 0 instead.`,
                    confirmLabel: 'Delete row',
                  })) deleteStock.mutate(lot.stock_id)
                }}
              >✕</button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="mgmt-inline-form"
        onSubmit={(e) => {
          e.preventDefault()
          addStock.mutate(
            { itemId, container_id: newContainer, quantity: newQty },
            { onSuccess: () => { setNewQty(1); setNewContainer(null) } },
          )
        }}
      >
        <input
          type="number" min={0} step={0.5} value={newQty}
          onChange={(e) => setNewQty(Number(e.target.value))}
        />
        <ContainerPicker value={newContainer} onChange={setNewContainer} itemType={itemType} />
        <button type="submit" disabled={addStock.isPending}>+ Add lot</button>
      </form>
    </div>
  )
}

// A tool's accessories (reverse of ToolLinksEditor). The link lives on the accessory
// (tool_accessory_tools via PUT /items/{acc}/tool-links, a replace-set), so adding/removing
// here reads that accessory's current tools and writes them back plus/minus this tool.
function ToolAccessoriesEditor({ toolId }: { toolId: number }) {
  const { data: accessories } = useToolAccessories(toolId)
  const setLinks = useSetAccessoryTools()
  const queryClient = useQueryClient()
  // Bumped after each link so the picker resets to empty for the next one.
  const [round, setRound] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const relink = async (accId: number, add: boolean) => {
    setError(null)
    try {
      const current = await queryClient.fetchQuery({
        queryKey: ['accessory-tools', accId],
        queryFn: () => apiGet<number[]>(`/items/${accId}/tool-links`),
      })
      const next = add ? Array.from(new Set([...current, toolId])) : current.filter((id) => id !== toolId)
      await setLinks.mutateAsync({ itemId: accId, toolItemIds: next })
      queryClient.invalidateQueries({ queryKey: ['tool-accessories', toolId] })
    } catch (err) {
      setError(err instanceof ApiError
        ? ((err.detail as { message?: string } | undefined)?.message ?? err.message)
        : (err as Error).message)
    }
  }

  if (!accessories) return null
  return (
    <div className="serves-editor">
      <h4>Accessories for this tool</h4>
      {accessories.length === 0 && <p className="mgmt-status">No accessories linked to this tool yet.</p>}
      <ul className="serves-chips">
        {accessories.map((a) => (
          <li key={a.item_id}>
            <RecordLink to={{ kind: 'item', id: a.item_id }}>{a.item_name}</RecordLink>
            <button type="button" title="Unlink" disabled={setLinks.isPending} onClick={() => relink(a.item_id, false)}>✕</button>
          </li>
        ))}
      </ul>
      <StuffPick
        key={round}
        value={null}
        placeholder="＋ Add accessory - type to find it…"
        defaultType="tool_accessory" lockType createLabel="✓ Create the accessory and link it"
        excludeIds={new Set(accessories.map((a) => a.item_id))}
        disabled={setLinks.isPending}
        onPick={(p) => {
          if (!p) return
          setRound((r) => r + 1)
          void relink(p.itemId, true)
        }}
      />
      {error && <p className="mgmt-status mgmt-status--error">{error}</p>}
    </div>
  )
}

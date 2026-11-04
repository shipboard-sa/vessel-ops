/**
 * Purpose: "Add a new item to the catalog" form (name, type, unit, stocking
 *   policy, thresholds, optional initial stock).
 * Version: v4 (2026-09-23)
 *   - v4: the success / duplicate messages name the item as a link that opens it (tracker #74).
 * Scope: PRODUCTION - mx-inv frontend, warehouse feature.
 * Architecture: A tab of WarehouseView. Creates via useCreateItem then applies
 *   policy/targets via useUpdateItem and optional initial stock via
 *   useAddStock (./mutations). Unit is chosen with the shared governed
 *   components/UnitPicker (was free text). v3: a Food item also asks for its
 *   food details (category, stowage, shelf life, provisioning decision).
 */
import { useState, type FormEvent, type ReactNode } from 'react'
import { ApiError } from '../../api/client'
import { useItemTypes, useStockingPolicies } from './useWarehouse'
import { useAddStock, useCreateItem, useUpdateItem } from './mutations'
import { ContainerPicker } from './ContainerPicker'
import type { ItemType, StockingPolicy } from '../../api/types'
import { policyDescription, typeLabel } from './catalogDisplay'
import { UnitPicker } from '../../components/UnitPicker'
import { ThresholdFields } from './ThresholdFields'
import { RecordLink } from '../../components/RecordLink'
import {
  EMPTY_FOOD, FoodDetailsFields, foodDetailsPayload, foodValuesProblem,
  type FoodDetailValues,
} from './FoodDetailsFields'

interface NewLot { qty: number; container: number | null }

export function AddItemTab() {
  const { data: itemTypes } = useItemTypes()
  const { data: policies } = useStockingPolicies()
  const createItem = useCreateItem()
  const updateItem = useUpdateItem()
  const addStock = useAddStock()

  const [name, setName] = useState('')
  const [itemType, setItemType] = useState<ItemType>('part')
  const [unit, setUnit] = useState('ea')
  const [policy, setPolicy] = useState<StockingPolicy>('consumable')
  const [minQ, setMinQ] = useState(0)
  const [target, setTarget] = useState<number | null>(null)
  const [hold, setHold] = useState<number | null>(null)
  // One row per place the item is stowed (the owner 2026-09-19: an item often lives in
  // several containers at once). Rows with quantity 0 are ignored.
  const [lots, setLots] = useState<NewLot[]>([{ qty: 0, container: null }])
  const [notes, setNotes] = useState('')
  const [food, setFood] = useState<FoodDetailValues>(EMPTY_FOOD)
  const [message, setMessage] = useState<ReactNode>(null)

  const busy = createItem.isPending || updateItem.isPending || addStock.isPending

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setMessage(null)
    createItem.mutate(
      {
        item_name: name.trim(), item_type: itemType, unit, min_quantity: minQ, notes: notes || undefined,
        ...(itemType === 'food' ? { details: foodDetailsPayload(food) } : {}),
      },
      {
        onSuccess: async (res) => {
          const itemId = (res as { item_id: number }).item_id
          const added = name.trim()
          const link = <RecordLink to={{ kind: 'item', id: itemId }}>{added}</RecordLink>
          await updateItem.mutateAsync({
            itemId,
            fields: {
              stocking_policy: policy,
              target_quantity: target || null,
              min_hold: hold || null,
            },
          })
          // A row with a container but quantity 0 is kept: it marks where the item will live
          // once it is received (tracker #47); only an empty row (no quantity, no container) is skipped.
          const toStow = lots.filter((l) => l.qty > 0 || l.container !== null)
          try {
            for (const lot of toStow) {
              await addStock.mutateAsync({ itemId, container_id: lot.container, quantity: lot.qty })
            }
          } catch (err) {
            // The catalog item already exists at this point - say so rather than
            // inviting a retry that would hit the duplicate-name check.
            setMessage(<>⚠️ Added "{link}" to the catalog, but stowing it failed: {(err as Error).message}.
              {' '}Open it to add the stock.</>)
            return
          }
          const placed = toStow.length
          const homesOnly = toStow.filter((l) => l.qty === 0).length
          setMessage(<>Added "{link}" to the catalog{placed ? ` with ${placed} place${placed > 1 ? 's' : ''} recorded` : ''}
            {homesOnly ? ` (${homesOnly} at 0 - where it will live once received)` : ''}.</>)
          setName(''); setUnit('ea'); setMinQ(0); setTarget(null); setHold(null)
          setLots([{ qty: 0, container: null }]); setNotes(''); setFood(EMPTY_FOOD)
        },
        onError: (err) => {
          // Same name (case/whitespace aside) already exists for this type - point at the
          // existing item via the Locker search rather than silently creating a duplicate.
          if (err instanceof ApiError && err.status === 409 && err.detail) {
            const { item_id, item_name } = err.detail as { item_id: number; item_name: string }
            setMessage(<>⚠️ "<RecordLink to={{ kind: 'item', id: item_id }}>{item_name}</RecordLink>" already exists in the catalog - open it instead of adding it again.</>)
          } else {
            setMessage(`⚠️ Could not add the item: ${err.message}`)
          }
        },
      },
    )
  }

  return (
    <div className="add-item-tab">
      <h2>➕ Add a New Item to the Catalog</h2>
      {message && <p className="add-item-success">{message}</p>}
      <form className="add-item-form" onSubmit={submit}>
        <div className="item-detail-row">
          <label>
            Item name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Racor 2010 filter element" />
          </label>
          <label>
            Type
            <select value={itemType} onChange={(e) => setItemType(e.target.value)}>
              {itemTypes?.map((t) => (
                <option key={t.type_key} value={t.type_key}>{typeLabel(itemTypes, t.type_key)}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="item-detail-row">
          <label>
            Unit
            <UnitPicker value={unit} onChange={(u) => setUnit(u ?? 'ea')} />
          </label>
          <label>
            Stocking policy
            <select value={policy} onChange={(e) => setPolicy(e.target.value)}>
              {policies?.map((p) => (
                <option key={p.policy_key} value={p.policy_key} title={p.description}>{p.label}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="item-policy-hint">{policyDescription(policies, policy)}</p>
        <ThresholdFields
          policy={policy}
          values={{ min_quantity: minQ, target_quantity: target, min_hold: hold }}
          onChange={(next) => {
            if (next.min_quantity !== undefined) setMinQ(next.min_quantity)
            if ('target_quantity' in next) setTarget(next.target_quantity ?? null)
            if ('min_hold' in next) setHold(next.min_hold ?? null)
          }}
        />
        {itemType === 'food' && (
          <FoodDetailsFields value={food} unit={unit} onChange={(next) => setFood((f) => ({ ...f, ...next }))} />
        )}
        <div className="add-item-lots">
          <strong>Initial stock — where it is and how much (optional)</strong>
          <p className="mgmt-status">
            Don't have any yet? Leave the quantity at 0 and pick the container it should live in - it is
            offered first when you receive it.
          </p>
          {lots.map((lot, i) => (
            <div key={i} className="item-detail-row add-item-lot-row">
              <label>
                Quantity on hand
                <input
                  type="number" min={0} step={1} value={lot.qty}
                  onChange={(e) => setLots((ls) => ls.map((l, j) => (j === i ? { ...l, qty: Number(e.target.value) } : l)))}
                />
              </label>
              <label>
                Container
                <ContainerPicker
                  value={lot.container} allowUnassigned itemType={itemType}
                  onChange={(container) => setLots((ls) => ls.map((l, j) => (j === i ? { ...l, container } : l)))}
                />
              </label>
              {lots.length > 1 && (
                <button
                  type="button" title="Remove this row"
                  onClick={() => setLots((ls) => ls.filter((_, j) => j !== i))}
                >✕</button>
              )}
            </div>
          ))}
          <button type="button" onClick={() => setLots((ls) => [...ls, { qty: 0, container: null }])}>
            + Add another location
          </button>
        </div>
        <label>
          Notes
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" />
        </label>
        <button
          type="submit"
          disabled={busy || !name.trim() || (itemType === 'food' && foodValuesProblem(food) !== null)}
        >
          {busy ? 'Adding…' : 'Add to catalog'}
        </button>
      </form>
    </div>
  )
}

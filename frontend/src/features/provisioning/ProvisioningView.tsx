/**
 * Purpose: The Galley Provisioning Plan - the food shopping cart (baseline heuristic vs the Meal
 *   Plan's needs), undecided-food triage, ask-for / receive panels, aisle order, expiring food.
 * Version: v2 (2026-09-23)
 *   - v2: each shopping-list item name opens its item record in the Warehouse (tracker #74).
 * Scope: PRODUCTION - mx-inv frontend, provisioning feature (Galley tab).
 * Architecture: Reads the food cart / prefs / aisle order (./useProvisioning), writes prefs and
 *   aisle order (./mutations); reuses warehouse ReceiveAction and ExpiringStockTable.
 */
import { useEffect, useState } from 'react'
import {
  useAisleOrder, useFoodCart, useProvisioningPrefs,
} from './useProvisioning'
import { useSetAisleOrder, useSetProvisioningPrefs } from './mutations'
import { ReceiveAction } from '../warehouse/ReceiveAction'
import { ExpiringStockTable } from '../warehouse/ExpiringStockTable'
import { UndecidedFoodTable } from './UndecidedFoodTable'
import { AddToListPanel } from './AddToListPanel'
import { ReceivePanel } from './ReceivePanel'
import { useSetOnList } from '../warehouse/onList'
import { RecordLink } from '../../components/RecordLink'
import './ProvisioningView.css'

const ORDER_OPTIONS: { label: string; value: string }[] = [
  { label: 'Aisle order', value: 'aisle' },
  { label: 'Category (A–Z)', value: 'category' },
  { label: 'Most to buy first', value: 'buy' },
]

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function ProvisioningView() {
  const { data: prefs } = useProvisioningPrefs()
  const setPrefs = useSetProvisioningPrefs()
  const [crew, setCrew] = useState(2)
  const [weeks, setWeeks] = useState(2)
  const [order, setOrder] = useState('aisle')
  const [onlyShort, setOnlyShort] = useState(true)

  useEffect(() => {
    if (prefs) { setCrew(prefs.crew); setWeeks(prefs.weeks) }
  }, [prefs?.crew, prefs?.weeks])

  const { data: plan } = useFoodCart(crew, weeks, order)
  const { data: aisleOrder } = useAisleOrder()
  const setAisleOrder = useSetAisleOrder()
  const setOnList = useSetOnList()
  const [aisleText, setAisleText] = useState('')

  useEffect(() => {
    if (aisleOrder) setAisleText(aisleOrder.join('\n'))
  }, [aisleOrder])

  const commitPrefs = (nextCrew: number, nextWeeks: number) => {
    setCrew(nextCrew); setWeeks(nextWeeks)
    setPrefs.mutate({ crew: nextCrew, weeks: nextWeeks })
  }

  const undecided = (plan ?? []).filter((r) => r.provision_mode === 'undecided')
  const shop = (plan ?? []).filter((r) => r.buy_qty > 0)
  const shown = onlyShort ? shop : (plan ?? []).filter((r) => r.provision_mode !== 'undecided' || r.buy_qty > 0)
  const knownCategories = Array.from(
    new Set((plan ?? []).map((r) => r.category).filter((c): c is string => !!c)),
  ).sort()

  return (
    <div className="provisioning-view">
      <h2>🍽️ Galley Provisioning Plan</h2>
      <p className="mgmt-status">
        The food shopping cart: each item's target is whichever is bigger, the baseline
        heuristic (scaled from crew size and cycle length below) or what the current Meal Plan
        actually needs — the recipe picker refines the baseline, it doesn't add to it. A bulk
        item (flour, spices, condiments) is never driven by a recipe's cup or spoon measure: if a
        planned recipe needs it and none is on hand, the list just says "need some". Rows
        with a ⚠️ have stock expiring soon, worth checking before buying more.
      </p>

      <div className="mgmt-toolbar">
        <label className="prov-field">
          Crew aboard
          <input
            type="number" min={1} max={12} value={crew}
            onChange={(e) => commitPrefs(Number(e.target.value), weeks)}
          />
        </label>
        <label className="prov-field">
          Passage length (weeks)
          <input
            type="number" min={0.5} max={12} step={0.5} value={weeks}
            onChange={(e) => commitPrefs(crew, Number(e.target.value))}
          />
        </label>
        <label className="prov-field">
          Order shopping list by
          <select value={order} onChange={(e) => setOrder(e.target.value)}>
            {ORDER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={onlyShort} onChange={(e) => setOnlyShort(e.target.checked)} />
          Show only items to buy
        </label>
      </div>

      <UndecidedFoodTable rows={undecided} />
      <AddToListPanel />
      <ReceivePanel />

      <details className="aisle-order-section">
        <summary>⚙️ Set aisle order (store walk sequence)</summary>
        <p className="mgmt-status">
          One category per line, in the order you walk the store. Categories not listed fall to
          the end.
        </p>
        <p className="mgmt-status">Categories in use: {knownCategories.join(', ') || '(none)'}</p>
        <textarea rows={8} value={aisleText} onChange={(e) => setAisleText(e.target.value)} />
        <button
          type="button"
          onClick={() => setAisleOrder.mutate(aisleText.split('\n'))}
          disabled={setAisleOrder.isPending}
        >
          Save aisle order
        </button>
      </details>

      <h3>
        🛒 Shopping list — {shop.length} items, {shop.reduce((s, r) => s + r.buy_qty, 0)} units total
      </h3>
      <table className="warehouse-table">
        <thead>
          <tr>
            <th>Aisle</th><th>Item</th><th>Unit</th><th>On hand</th><th>Target</th>
            <th title="Non-zero when the Meal Plan needs more of this than the baseline heuristic">From plan</th>
            <th>Buy</th><th>Stow</th><th>Expiring</th><th></th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.item_id} className={r.expiring_soon ? 'short' : undefined}>
              <td>{r.category ?? '(uncategorised)'}</td>
              <td>
                <RecordLink to={{ kind: 'item', id: r.item_id }}>{r.item_name}</RecordLink>
                {r.on_list && (
                  <span
                    className="prov-requested"
                    title={`Someone asked for this${r.on_list_since ? ` on ${r.on_list_since}` : ''}; it stays until it is received`}
                  >
                    {' '}📝 requested{' '}
                    <button
                      type="button" className="link-button" title="Take it off the list"
                      disabled={setOnList.isPending}
                      onClick={() => setOnList.mutate({ itemId: r.item_id, onList: false })}
                    >
                      ✕
                    </button>
                  </span>
                )}
              </td>
              <td>{r.unit}</td>
              <td>{r.quantity_onhand}</td>
              <td>{r.have_only ? '—' : r.target_qty}</td>
              <td title="Bulk items and recipe/item unit mismatches are only checked as: do we have any?">
                {r.have_only ? 'need some' : r.meal_plan_qty > 0 ? r.meal_plan_qty : '—'}
              </td>
              <td>{r.have_only ? `${r.buy_qty} (none on hand)` : r.buy_qty}</td>
              <td>{r.stowage_state ?? '—'}</td>
              <td>{r.expiring_soon ? `⚠️ ${r.expiring_soon}` : (r.earliest_expiry ?? '—')}</td>
              <td>
                <ReceiveAction itemId={r.item_id} itemName={r.item_name} unit={r.unit} suggestedQty={r.buy_qty} itemType="food" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onClick={() => downloadCsv(
          `provisioning_crew${crew}_${weeks}wk.csv`,
          [['aisle', 'item', 'buy_qty', 'unit'], ...shop.map((r) => [r.category ?? '', r.item_name, r.buy_qty, r.unit])],
        )}
      >
        ⬇️ Download shopping list (CSV)
      </button>

      <ExpiringStockTable itemType="food" expiredOnlyLabel="Only already expired (galley tidy-up)" />
    </div>
  )
}

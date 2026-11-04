/**
 * Purpose: Shared expiring-stock table + expiry clean-out (remove a lot as expired).
 * Version: v2 (2026-09-23)
 *   - v2: the item name opens the item's record (tracker #74). Container/location stay plain
 *     text - the expiring rows carry no container_id to open.
 * Scope: PRODUCTION - mx-inv frontend, warehouse feature (also used by Galley Provisioning).
 * Architecture: Reads GET /api/items/stock-expiring (useStockExpiring), writes
 *   DELETE stock with reason='expire' (useDeleteStock). Rendered by WarehouseView's
 *   Expiring sub-tab and the Galley's food-expiring view.
 */
import { useState } from 'react'
import { useDeleteStock } from './mutations'
import { useStockExpiring } from './useWarehouse'
import { useConfirm } from '../../components/ConfirmDialog'
import { RecordLink } from '../../components/RecordLink'

// Shared table+clean-out UI behind both the food-expiring view (Galley
// Provisioning) and the spares/parts one (Warehouse) - same mechanism
// (stock.expiry_date, stock_movements reason='expire'), but kept as two
// separate screens rather than one merged list: the owner, 2026-09-17, "that's 2
// different types of lists - likely 2 very different workflows" (routine
// galley tidy vs. safety-critical inspection tracking).
export function ExpiringStockTable({
  itemType, excludeItemType, defaultHorizon = 30, expiredOnlyLabel = 'Only already expired (clean-out)',
}: {
  itemType?: string
  excludeItemType?: string
  defaultHorizon?: number
  expiredOnlyLabel?: string
}) {
  const [horizon, setHorizon] = useState(defaultHorizon)
  const [expiredOnly, setExpiredOnly] = useState(false)
  const { data: raw } = useStockExpiring(horizon, itemType, excludeItemType)
  const deleteStock = useDeleteStock()
  const confirm = useConfirm()
  const rows = (raw ?? []).filter((r) => !expiredOnly || r.days_left <= 0)

  return (
    <div className="expiring-stock-table">
      <h3>⏳ Expiring — {rows.length} lot(s)</h3>
      <div className="mgmt-toolbar">
        <label className="prov-field">
          Horizon (days)
          <input
            type="range" min={7} max={365} step={7} value={horizon}
            onChange={(e) => setHorizon(Number(e.target.value))}
            disabled={expiredOnly}
          />
          {horizon}
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={expiredOnly} onChange={(e) => setExpiredOnly(e.target.checked)} />
          {expiredOnlyLabel}
        </label>
      </div>
      {rows.length === 0 ? (
        <p className="mgmt-status">
          {expiredOnly ? '✅ Nothing expired - clean-out not needed right now.' : '✅ Nothing expiring in that window.'}
        </p>
      ) : (
        <table className="warehouse-table">
          <thead>
            <tr>
              <th>Item</th>{!itemType && <th>Type</th>}<th>Qty</th><th>Unit</th>
              <th>Expiry</th><th>Days left</th><th>Compartment</th><th>Location</th><th>Container</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.stock_id} className={r.days_left <= 0 ? 'short' : undefined}>
                <td><RecordLink to={{ kind: 'item', id: r.item_id }}>{r.item_name}</RecordLink></td>
                {!itemType && <td>{r.item_type ?? '—'}</td>}
                <td>{r.quantity}</td>
                <td>{r.unit}</td>
                <td>{r.expiry_date}</td>
                <td>{r.days_left <= 0 ? `expired ${-r.days_left}d ago` : r.days_left}</td>
                <td>{r.compartment_name ?? '—'}</td>
                <td>{r.location_name ?? '—'}</td>
                <td>{r.container_name ?? '—'}</td>
                <td>
                  <button
                    type="button"
                    className="danger"
                    disabled={deleteStock.isPending}
                    onClick={async () => {
                      if (await confirm({
                        title: `Remove ${r.quantity} ${r.unit} of "${r.item_name}" as expired?`,
                        message: 'It is logged as an expiry clean-out.',
                        confirmLabel: 'Remove as expired',
                        cancelLabel: 'Not now',
                      })) {
                        deleteStock.mutate({ stockId: r.stock_id, reason: 'expire', note: 'expired clean-out' })
                      }
                    }}
                  >
                    🗑 Expired
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/**
 * Purpose: The "🧺 Receive" action on every shopping-list row (Restock List, Galley cart,
 *   Meal Plan shortfall, the Galley "Received something?" box): record a purchase coming
 *   aboard and say where it went and how many.
 * Version: v3 (2026-09-20) - places by the item's own containers (tracker #47); v3 adds an
 *   estimated expiry (today + shelf life) and the "date the older undated stock" prompt.
 * Scope: PRODUCTION - mx-inv frontend, warehouse feature.
 * Architecture: Reads GET /api/items/{id}/receive-info (targets + suggested expiry + undated
 *   stock aboard) - targets = every container the item already
 *   has a row in, zero-quantity "home" rows first (a 0 in a container = "this is where it
 *   lives", set by the owner when adding the item or left behind when the last one is used up) -
 *   and posts POST /api/items/{id}/receive (one all-or-nothing call; a plain line merges into
 *   the container's existing row). One known place: it is pre-filled with the quantity, one
 *   tap to add. Several: each is listed with its own quantity to split the purchase. None:
 *   the old container pick. "+ somewhere else" is always there. Also clears a "we need more"
 *   request (server side). Used by RestockTab, ProvisioningView and provisioning/ReceivePanel.
 */
import { useState } from 'react'
import { todayLocal } from '../../api/date'
import { useReceiveStock } from './mutations'
import { useReceiveInfo } from './useWarehouse'
import { ContainerPicker } from './ContainerPicker'

export function ReceiveAction({
  itemId, itemName, unit, suggestedQty, startOpen, onReceived, itemType,
}: {
  itemId: number; itemName: string; unit: string; suggestedQty?: number
  /** The item's type, so the container list can put the Galley first for food. */
  itemType?: string
  /** Open the quantity fields straight away (used when the item was just picked or created). */
  startOpen?: boolean
  onReceived?: () => void
}) {
  const [open, setOpen] = useState(!!startOpen)
  const [done, setDone] = useState(false)

  if (done) return <span className="mgmt-status">✅ Received</span>

  if (!open) {
    return (
      <button type="button" className="link-button" title={`Receive ${itemName}`} onClick={() => setOpen(true)}>
        🧺 Receive
      </button>
    )
  }

  return (
    <ReceiveForm
      itemId={itemId} itemName={itemName} unit={unit} suggestedQty={suggestedQty} itemType={itemType}
      onClose={() => setOpen(false)}
      onReceived={() => { setDone(true); onReceived?.() }}
    />
  )
}

function ReceiveForm({
  itemId, itemName, unit, suggestedQty, itemType, onClose, onReceived,
}: {
  itemId: number; itemName: string; unit: string; suggestedQty?: number; itemType?: string
  onClose: () => void; onReceived: () => void
}) {
  const startQty = suggestedQty && suggestedQty > 0 ? suggestedQty : 1
  const { data: info } = useReceiveInfo(itemId)
  const receive = useReceiveStock()
  const [amounts, setAmounts] = useState<Record<number, number>>({})
  const [extraContainer, setExtraContainer] = useState<number | null>(null)
  const [extraQty, setExtraQty] = useState<number | null>(null)
  // undefined = untouched, so the suggested date (today + shelf life) applies; '' = the user cleared it.
  const [expiryPick, setExpiryPick] = useState<string | undefined>(undefined)
  const [olderExpiry, setOlderExpiry] = useState('')

  if (!info) return <span className="mgmt-status">Looking for where {itemName} lives…</span>

  // The first known place (a home if there is one) gets the whole suggested quantity;
  // the rest start at 0 for the user to split. With no known place, the pick below is the only line.
  const targets = info.targets
  const expiry = expiryPick ?? info.suggested_expiry ?? ''
  // A dated batch arriving beside older stock that has no date: offer to date the older stock.
  const offerOlder = expiry !== '' && info.undated_quantity > 0
  const firstId = targets[0]?.container_id
  const amountFor = (id: number) => amounts[id] ?? (id === firstId ? startQty : 0)
  const extra = extraQty ?? (targets.length === 0 ? startQty : 0)

  const lines = targets
    .map((t) => ({ container_id: t.container_id as number | null, quantity: amountFor(t.container_id) }))
    .filter((l) => l.quantity > 0)
  if (extra > 0) lines.push({ container_id: extraContainer, quantity: extra })
  const total = lines.reduce((sum, l) => sum + l.quantity, 0)

  return (
    <span className="receive-action receive-targets">
      {targets.length > 0 && (
        <span className="receive-targets-head">
          {targets.length === 1 ? 'Goes to:' : 'Where does it go, and how many?'}
        </span>
      )}
      {targets.map((t) => (
        <label key={t.container_id} className="receive-target-row">
          <input
            type="number" min={0} step="any" value={amountFor(t.container_id)}
            onChange={(e) => setAmounts((a) => ({ ...a, [t.container_id]: Number(e.target.value) }))}
            title={`How many ${unit} go here`}
          />
          <span className="unit">{unit}</span>
          <span className="receive-target-place">
            {t.compartment_name} › {t.location_name} › {t.container_name}
          </span>
          {t.is_home ? <em className="receive-target-tag" title="A 0 here marks where it lives">home</em>
            : <em className="receive-target-tag">have {t.quantity}</em>}
        </label>
      ))}
      <span className="receive-target-row">
        <input
          type="number" min={0} step="any" value={extra}
          onChange={(e) => setExtraQty(Number(e.target.value))}
          title={`How many ${unit}`}
        />
        <span className="unit">{unit}</span>
        <ContainerPicker
          value={extraContainer} onChange={setExtraContainer}
          itemType={itemType} allowUnassigned={targets.length === 0}
        />
        {targets.length > 0 && <em className="receive-target-tag">somewhere else</em>}
      </span>
      <span className="receive-target-row">
        <label className="receive-expiry">
          Expires
          <input
            type="date" value={expiry} onChange={(e) => setExpiryPick(e.target.value)}
            title="Expiry date for what you are receiving now (applies to every place above); clear it for none"
          />
        </label>
        {expiryPick === undefined && info.suggested_expiry && (
          <em className="receive-target-tag">estimated from its {info.shelf_life_days}-day shelf life - change or clear it</em>
        )}
      </span>
      {offerOlder && (
        <span className="receive-target-row receive-older">
          <span>
            You still have {info.undated_quantity} {unit} with no date
            {info.undated_places.length > 0 ? ` (${info.undated_places.join(', ')})` : ''}. Its date:
          </span>
          <input
            type="date" value={olderExpiry} onChange={(e) => setOlderExpiry(e.target.value)}
            title="Optional. Leave blank to keep it undated - undated stock is used first."
          />
          <em className="receive-target-tag">blank = stays undated, used first</em>
        </span>
      )}
      <span className="receive-target-row">
        <button
          type="button"
          title={`Add ${total} ${unit} of ${itemName} to stock`}
          disabled={receive.isPending || total <= 0}
          onClick={() => receive.mutate(
            {
              itemId, acquired_on: todayLocal(),
              lines: lines.map((l) => ({ ...l, expiry_date: expiry || null })),
              older_expiry: offerOlder && olderExpiry ? olderExpiry : null,
            },
            { onSuccess: onReceived },
          )}
        >
          {receive.isPending ? 'Adding…' : `✓ Add ${total} ${unit}`}
        </button>
        <button type="button" className="link-button" onClick={onClose}>✕</button>
      </span>
      {receive.isError && (
        <span className="mgmt-status mgmt-status--error">
          {(receive.error as { detail?: { message?: string } }).detail?.message ?? (receive.error as Error).message}
        </span>
      )}
    </span>
  )
}

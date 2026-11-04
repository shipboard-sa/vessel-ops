/**
 * Purpose: The Inventory Audit's "Spares fit check" - sweeps every part / spare unit that serves a
 *   device, shows the device's make/model beside the part's own numbers with computed flags, and
 *   records the nameplate check (fits / wrong model / doesn't apply). A wrong-model part stays in
 *   stock (it is physically aboard, to be removed) but never counts as a spare or reorders, and can
 *   be staged into "To remove from boat > Trade or scrap".
 * Version: v2 (2026-09-23) - v2 (tracker #74): the opened part's name opens its item record and
 *   every device name (focus screen and list) opens that device. v1.2 (tracker #61): the list only organized rows by device/system,
 *   with no indication where a part physically is - adds a "Where" column (from the stock each row
 *   already carries, `r.stock[].place`) and a sort toggle so the list can be walked container by
 *   container instead of only by check status, for the case where the owner is physically walking lockers
 *   rather than working device by device. v1.1 was 2026-09-21 (no-model gate, inline device model entry).
 * Scope: PRODUCTION - mx-inv frontend, warehouse feature.
 * Architecture: Rendered by AuditTab (its third mode). Reads GET /api/items/fit-review
 *   (data.list_fit_review); a row opens a FocusScreen. Saves via PUT /api/items/{id}/fit and
 *   POST /api/items/{id}/stage-for-removal, which invalidate this list and Restock. the owner, 2026-09-21:
 *   spares bought in error should be flagged automatically; wrong-model stock is kept but not
 *   counted, and must be physically removed (schema v28, item_fit_checks). Gate (the owner, 2026-09-21):
 *   recording Fits / Wrong model against a device with no make/model recorded asks "are you sure?" -
 *   the check means little until the nameplate is entered, and the device's model can be entered on
 *   this screen (PATCH /api/tasks/systems/{name}, the same call as the Systems screen).
 */
import { useState } from 'react'
import { useFitReview } from './useWarehouse'
import { useSetDeviceModel, useSetItemFit, useStageForRemoval } from './mutations'
import { FocusScreen, useFocusTrail } from '../../components/FocusScreen'
import { useConfirm } from '../../components/ConfirmDialog'
import type { FitFlag, FitReviewRow, FitStatus } from '../../api/types'
import { RecordLink } from '../../components/RecordLink'

type Filter = 'todo' | 'wrong' | 'settled' | 'all'

const FLAG_TEXT: Record<FitFlag, string> = {
  part_number_to_confirm: 'Part number to confirm',
  model_not_on_device: 'Model not found on the device',
  device_model_unknown: 'Device model not recorded',
}

const FLAG_HELP: Record<FitFlag, string> = {
  part_number_to_confirm: 'The part number is still marked CONFIRM - read it off the part or the manual.',
  model_not_on_device: 'The part names a model that appears nowhere in the linked device\'s name, make/model or notes. Check the nameplate.',
  device_model_unknown: 'The linked device has no make/model recorded, so nothing could be compared. Enter the nameplate on the device (Systems) and this check gets sharper.',
}

const STATUS_TEXT: Record<FitStatus, string> = {
  fits: '✅ Fits',
  wrong_model: '⚠️ Wrong model',
  not_applicable: '➖ Doesn\'t apply',
}

function isTodo(r: FitReviewRow): boolean {
  return r.fit_status === null
}

// Each device is its own target (tracker #74) - the name opens the device, comma separated.
function DevicesLinks({ r }: { r: FitReviewRow }) {
  return (
    <>
      {r.devices.map((d, i) => (
        <span key={d.name}>
          {i > 0 && ', '}
          <RecordLink to={{ kind: 'system', name: d.name }}>{d.name}</RecordLink>
          {d.make_model ? ` (${d.make_model})` : ''}
        </span>
      ))}
    </>
  )
}

// A part is routinely spread across several containers (primary / backup / deep
// storage), same as the Locker table - show every place it's stocked, not just one.
function whereText(r: FitReviewRow): string {
  return r.stock.length > 0 ? r.stock.map((s) => s.place).join(' · ') : 'not stocked yet'
}

type SortMode = 'status' | 'container'

export function FitReview() {
  const { data: rows, isLoading, isError, error } = useFitReview()
  const setFit = useSetItemFit()
  const stage = useStageForRemoval()
  const setModel = useSetDeviceModel()
  const confirm = useConfirm()
  const [modelDraft, setModelDraft] = useState<Record<string, string>>({})
  const focus = useFocusTrail<number>()
  const [filter, setFilter] = useState<Filter>('todo')
  const [sortMode, setSortMode] = useState<SortMode>('status')
  const [note, setNote] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  if (isLoading) return <p className="mgmt-status">Loading…</p>
  if (isError) return <p className="mgmt-status mgmt-status--error">{(error as Error).message}</p>
  if (!rows) return null

  const opened = focus.current !== null ? rows.find((r) => r.item_id === focus.current) ?? null : null
  const wrong = rows.filter((r) => r.fit_status === 'wrong_model')
  const todo = rows.filter(isTodo)
  const flagged = todo.filter((r) => r.flags.some((f) => f !== 'device_model_unknown'))
  const filtered = rows.filter((r) =>
    filter === 'all' ? true
      : filter === 'todo' ? isTodo(r)
        : filter === 'wrong' ? r.fit_status === 'wrong_model'
          : r.fit_status !== null && r.fit_status !== 'wrong_model')
  // Backend order is by check status (wrong-model first, then flagged, ...) - useful when
  // working device by device. Walking lockers instead calls for container order, unstocked
  // items last so they don't scatter a physical walk (tracker #61).
  const shown = sortMode === 'status' ? filtered : filtered.slice().sort((a, b) => {
    const pa = a.stock[0]?.place ?? '￿'
    const pb = b.stock[0]?.place ?? '￿'
    return pa.localeCompare(pb) || a.item_name.localeCompare(b.item_name)
  })

  function openRow(r: FitReviewRow) {
    setNote(r.fit_note ?? '')
    setMessage(null)
    focus.open(r.item_id)
  }

  async function save(r: FitReviewRow, status: FitStatus | null) {
    setMessage(null)
    const unmodelled = r.devices.filter((d) => !d.make_model)
    if ((status === 'fits' || status === 'wrong_model') && unmodelled.length > 0) {
      const ok = await confirm({
        title: 'No model number on the device',
        message: `${unmodelled.map((d) => d.name).join(', ')} ${unmodelled.length > 1 ? 'have' : 'has'} no make/model recorded, ` +
          `so this check can't really be verified. Enter the model below first, or save anyway.`,
        confirmLabel: 'Save without the model',
        cancelLabel: 'Go back',
      })
      if (!ok) return
    }
    setFit.mutate(
      { itemId: r.item_id, fit_status: status, note },
      { onError: (e) => setMessage((e as Error).message) },
    )
  }

  function saveModel(deviceName: string) {
    const value = (modelDraft[deviceName] ?? '').trim()
    if (!value) return
    setMessage(null)
    setModel.mutate(
      { name: deviceName, make_model: value },
      {
        onSuccess: () => setModelDraft((d) => ({ ...d, [deviceName]: '' })),
        onError: (e) => setMessage((e as Error).message),
      },
    )
  }

  function stageForRemoval(r: FitReviewRow) {
    setMessage(null)
    stage.mutate(r.item_id, {
      onSuccess: (res) => setMessage(res.moved ? `Moved ${res.moved} lot(s) to To remove from boat › Trade or scrap.` : 'Nothing to move - no stock lots outside the removal place.'),
      onError: (e) => setMessage((e as Error).message),
    })
  }

  return (
    <div className="fit-review">
      {focus.current !== null && opened && (
        <FocusScreen focus={focus} listLabel="Spares fit check" labelOf={() => opened.item_name}>
          <h3><RecordLink to={{ kind: 'item', id: opened.item_id }}>{opened.item_name}</RecordLink></h3>
          <p className="mgmt-status">
            {opened.quantity_onhand} {opened.unit} aboard
            {opened.manufacturer ? ` · ${opened.manufacturer}` : ''}
            {opened.part_number ? ` · ${opened.part_number}` : ' · no part number recorded'}
          </p>
          {opened.fits_system && <p><strong>Fits (as bought):</strong> {opened.fits_system}</p>}
          {opened.notes && <p className="unlinked-notes"><strong>Notes:</strong> {opened.notes}</p>}

          <p><strong>Serves:</strong></p>
          <ul>
            {opened.devices.map((d) => (
              <li key={d.name}>
                <RecordLink to={{ kind: 'system', name: d.name }}>{d.name}</RecordLink> — {d.make_model || <em>make/model not recorded on the device</em>}
                {!d.make_model && (
                  <span className="fit-model-entry">
                    <input
                      type="text" value={modelDraft[d.name] ?? ''} placeholder="Enter make / model from the nameplate"
                      onChange={(e) => setModelDraft((m) => ({ ...m, [d.name]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveModel(d.name) }}
                    />
                    <button type="button" disabled={setModel.isPending || !(modelDraft[d.name] ?? '').trim()}
                      onClick={() => saveModel(d.name)}>Save model</button>
                  </span>
                )}
              </li>
            ))}
          </ul>

          {opened.flags.length > 0 && (
            <ul className="fit-flags">
              {opened.flags.map((f) => <li key={f}><strong>{FLAG_TEXT[f]}.</strong> {FLAG_HELP[f]}</li>)}
            </ul>
          )}

          <p className="mgmt-status">
            Check the nameplate on the device and the number on this part, then record the result.
            {opened.fit_status && <> Currently: <strong>{STATUS_TEXT[opened.fit_status]}</strong>{opened.checked_on ? ` (checked ${opened.checked_on})` : ''}.</>}
          </p>
          <textarea
            className="fit-note" rows={2} value={note} placeholder="Note (what the nameplate says, what to do…)"
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="fit-buttons">
            <button type="button" disabled={setFit.isPending} onClick={() => save(opened, 'fits')}>✅ Fits</button>
            <button type="button" disabled={setFit.isPending} onClick={() => save(opened, 'wrong_model')}>⚠️ Wrong model</button>
            <button type="button" disabled={setFit.isPending} onClick={() => save(opened, 'not_applicable')}>➖ Doesn't apply</button>
            {opened.fit_status && (
              <button type="button" disabled={setFit.isPending} onClick={() => save(opened, null)}>↺ Back to unchecked</button>
            )}
          </div>

          {opened.fit_status === 'wrong_model' && (
            <div className="fit-remove">
              <p>
                <strong>Wrong model.</strong> It stays in stock (it is physically aboard) but does not count as a spare
                and will not be reordered. Remove it from the boat.
              </p>
              {opened.stock.length === 0 ? (
                <p className="mgmt-status">No stock recorded for it.</p>
              ) : (
                <ul>
                  {opened.stock.map((s, i) => <li key={i}>{s.quantity} {opened.unit} — {s.place}</li>)}
                </ul>
              )}
              {opened.stock.length > 0 && (opened.stock.every((s) => s.place.startsWith('To remove from boat'))
                ? <p className="mgmt-status">✅ Already staged in "To remove from boat" - take it off the boat.</p>
                : (
                  <button type="button" disabled={stage.isPending} onClick={() => stageForRemoval(opened)}>
                    📦 Stage for removal (move to "To remove from boat")
                  </button>
                ))}
            </div>
          )}
          {message && <p className="mgmt-status">{message}</p>}
        </FocusScreen>
      )}

      <div hidden={focus.current !== null}>
        <p className="mgmt-status">
          Every part and spare unit that serves a device, with the device's make/model beside it. Flags are
          hints from the sweep, not verdicts: open a row, check the nameplate, and record the result. A
          <strong> wrong-model</strong> part stays in stock until you remove it, but never counts as a spare
          and never reorders. {flagged.length > 0 && <>{flagged.length} unchecked part(s) carry a real flag.</>}
        </p>
        <div className="mgmt-mode-tabs" role="tablist">
          {([
            ['todo', `To check (${todo.length})`],
            ['wrong', `⚠️ Wrong model — to remove (${wrong.length})`],
            ['settled', 'Settled'],
            ['all', `All (${rows.length})`],
          ] as [Filter, string][]).map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={filter === key}
              className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>
              {label}
            </button>
          ))}
        </div>
        <div className="mgmt-toolbar">
          <label>
            Sort{' '}
            <select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}>
              <option value="status">By check status (device by device)</option>
              <option value="container">By container (walking lockers)</option>
            </select>
          </label>
        </div>
        {shown.length === 0 ? (
          <p className="mgmt-status">Nothing in this view.</p>
        ) : (
          <table className="warehouse-table">
            <thead>
              <tr><th>Part</th><th>Where</th><th>Serves (make/model)</th><th>Part no.</th><th>Aboard</th><th>Flags</th><th>Check</th></tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.item_id}>
                  <td>
                    <button type="button" className="link-button" onClick={() => openRow(r)}>{r.item_name}</button>
                  </td>
                  <td className="unlinked-hint">{whereText(r)}</td>
                  <td className="unlinked-hint"><DevicesLinks r={r} /></td>
                  <td>{r.part_number ?? ''}</td>
                  <td>{r.quantity_onhand} {r.unit}</td>
                  <td className="unlinked-hint">
                    {r.flags.filter((f) => f !== 'device_model_unknown').map((f) => FLAG_TEXT[f]).join('; ')}
                    {r.flags.includes('device_model_unknown') && r.flags.length === 1 ? 'device model not recorded' : ''}
                  </td>
                  <td>{r.fit_status ? STATUS_TEXT[r.fit_status] : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

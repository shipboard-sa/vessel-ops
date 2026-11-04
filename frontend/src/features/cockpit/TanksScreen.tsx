/**
 * Purpose: Cockpit "Tanks" screen - the four tanks (fuel port / stbd, water port / stbd) with their level and fill
 *   session, a 'Filling' / 'Stop' tap per tank, and a tank's own focus screen. A fill is STARTED by the crew, not
 *   guessed from the level senders (they slosh 5-6 points while the boat rocks - Ship's Automation D-129, the owner
 *   2026-10-09); while a session is open the rules engine gives the ETA and the 90 % / 95 % (= full) chirps.
 *   From the helm mostly for a fuel fill at the start or end of a passage; the anchor box has the same tap.
 * Version: v2 (2026-10-09) - v2: a tank the WATERMAKER is filling has no Stop / Filling - its button reads
 *   'watermaker' and is disabled (the session carries the 95 % HP-pump cut, D-130; the owner 10-09: the watermaker must
 *   never overflow a tank while the crew is busy elsewhere - same rule as the anchor box). v1 (2026-10-09)
 * Scope: PRODUCTION - mx-inv frontend, cockpit feature.
 * Architecture: Reads useFill (GET /api/cockpit/fill every 10 s) and writes through useFillTap (POST
 *   /api/cockpit/fill); the mx-inv server forwards to the rules engine (GET / POST /fill, engine api.py v9) with the
 *   engine token (backend/boat_link.py) - the tablet never holds it. A tank row opens its focus screen (tap the row);
 *   the button on the row is the one-tap path. Sessions also end by themselves in the engine (20 min with no rise,
 *   4 h, watermaker stopped) - the poll shows that.
 * Invocation: rendered by CockpitApp.tsx for screen 'tanks' (tile shown when /capabilities says `fill`).
 */
import { useState } from 'react'
import { ApiError } from '../../api/client'
import { friendlyError } from './CockpitBits'
import { type FillTank, type FillTankKey, type FillView, useFill, useFillTap } from './useCockpit'

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** "api:cockpit" -> "cockpit"; empty for the watermaker's own sessions. */
const who = (by: string) => by.replace(/^api:/, '')

const errText = (e: unknown) => (e instanceof ApiError && typeof e.detail === 'string' ? e.detail : friendlyError(e))

/** One line saying what the engine is doing with this tank. */
export function sessionText(t: FillTank): string {
  const s = t.session
  if (!s) return 'Not filling'
  if (s.source === 'watermaker') {
    return s.active
      ? `Watermaker filling since ${hhmm(s.since)}`
      : 'Watermaker running - waiting to see this tank rise (the valve may be on the other tank)'
  }
  return `Filling since ${hhmm(s.since)}${s.by ? ` (${who(s.by)})` : ''}`
}

/** Fill sessions open right now, for the home tile ("Filling: Fuel port"). */
export function fillingLabels(view: FillView | undefined): string[] {
  return (view?.tanks ?? []).filter((t) => t.session?.active).map((t) => t.label)
}

function LevelBar({ tank, big }: { tank: FillTank; big?: boolean }) {
  const pct = tank.level
  const kind = tank.tank.startsWith('fuel') ? 'fuel' : 'water'
  return (
    <div className={`cockpit-tank-level${big ? ' cockpit-tank-level--big' : ''}`}>
      <div className="cockpit-tank-bar" aria-hidden="true">
        <div className={`cockpit-tank-bar-fill cockpit-tank-bar-fill--${kind}`}
          style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%` }} />
      </div>
      <span className="cockpit-tank-pct">{pct == null ? 'level not known' : `${Math.round(pct)} %`}</span>
    </div>
  )
}

function TapButton({ tank, canWrite, tap }: {
  tank: FillTank; canWrite: boolean; tap: ReturnType<typeof useFillTap>
}) {
  if (!canWrite) return null
  if (tank.session?.source === 'watermaker') {
    return <button type="button" className="cockpit-fill-tap cockpit-fill-tap--wm" disabled
      onClick={(e) => e.stopPropagation()}>💧 watermaker</button>
  }
  const on = !tank.session
  const busy = tap.isPending && tap.variables?.tank === tank.tank
  return (
    <button type="button" className={`cockpit-fill-tap${on ? '' : ' cockpit-fill-tap--stop'}`}
      disabled={tap.isPending}
      onClick={(e) => { e.stopPropagation(); tap.mutate({ tank: tank.tank, on }) }}>
      {busy ? '…' : on ? '⛽ Filling' : '■ Stop'}
    </button>
  )
}

export function TanksScreen({ onBack }: { onBack: () => void }) {
  const fill = useFill(true, 10_000)
  const tap = useFillTap()
  const [focused, setFocused] = useState<FillTankKey | null>(null)
  // Down = the newest answer was a failure; never show remembered levels as live then.
  const down = fill.errorUpdatedAt > fill.dataUpdatedAt
  const view = down ? undefined : fill.data
  const canWrite = !!view?.can_write
  const tank = focused ? view?.tanks.find((t) => t.tank === focused) : undefined

  const header = (title: string, back: () => void) => (
    <div className="cockpit-panel-header">
      <button type="button" className="cockpit-back" onClick={back}>← Back</button>
      <h2>{title}</h2>
    </div>
  )
  const status = (
    <>
      {tap.isError && <p className="cockpit-status cockpit-status--error">Not changed - {errText(tap.error)}</p>}
      {view && !canWrite && (
        <p className="cockpit-status">Filling taps are off on this server (no engine token) - levels only.</p>
      )}
    </>
  )

  if (!view) {
    return (
      <div className="cockpit-tanks">
        {header('⛽ Tanks', onBack)}
        {fill.isLoading ? <p className="cockpit-status">Loading…</p> : (
          <p className="cockpit-status cockpit-status--error">
            Tanks are not shown - {errText(fill.error ?? fill.failureReason)}
          </p>
        )}
      </div>
    )
  }

  if (tank) {
    return (
      <div className="cockpit-tanks">
        {header(`⛽ ${tank.label}`, () => setFocused(null))}
        <LevelBar tank={tank} big />
        <p className="cockpit-status cockpit-tank-state">{sessionText(tank)}</p>
        {tank.session?.source === 'tap' && (
          <p className="cockpit-status">
            The boat calls out the ETA and chirps at 90 % and at 95 % (full). It stops by itself after 20 min with
            no rise, or after 4 h.
          </p>
        )}
        {tank.session?.source === 'watermaker' && (
          <p className="cockpit-status">
            The watermaker stops itself when this tank reaches 95 %. It cannot be stopped from here - stop the
            watermaker to end it.
          </p>
        )}
        {!tank.session && canWrite && (
          <p className="cockpit-status">Tap Filling as you start - the boat then calls out the ETA and chirps at 90 %
            and at 95 % (full).</p>
        )}
        <div className="cockpit-fill-focus-tap"><TapButton tank={tank} canWrite={canWrite} tap={tap} /></div>
        {status}
      </div>
    )
  }

  return (
    <div className="cockpit-tanks">
      {header('⛽ Tanks', onBack)}
      <p className="cockpit-status cockpit-tank-wm">
        Watermaker {view.watermaker.running
          ? <strong>running{view.watermaker.watts != null && ` (${Math.round(view.watermaker.watts)} W)`}</strong>
          : 'off'}
      </p>
      <ul className="cockpit-tap-list">
        {view.tanks.map((t) => (
          <li key={t.tank}>
            <div className={`cockpit-tap-item cockpit-tank-row${t.session?.active ? ' cockpit-tank-row--filling' : ''}`}
              role="button" tabIndex={0} onClick={() => setFocused(t.tank)}
              onKeyDown={(e) => { if (e.key === 'Enter') setFocused(t.tank) }}>
              <div className="cockpit-tank-row-top">
                <span className="cockpit-tank-name">{t.label}</span>
                <TapButton tank={t} canWrite={canWrite} tap={tap} />
              </div>
              <LevelBar tank={t} />
              <span className="cockpit-tap-item-meta">{sessionText(t)}</span>
            </div>
          </li>
        ))}
      </ul>
      {status}
    </div>
  )
}

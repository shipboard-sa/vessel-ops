/**
 * Purpose: The cockpit's view of the boat automation - the alarm banner (on every screen, with
 *   one Ack for all, like the panel button) and the boat-mode card (DOCK / ANCHOR / AWAY / MOTOR /
 *   SAIL tap, D-092 / SO-9) on the home screen.
 * Version: v1 (2026-10-05)
 * Scope: PRODUCTION - mx-inv frontend, cockpit feature.
 * Architecture: Reads useBoatStatus (GET /api/cockpit/boat every 5 s) and writes through
 *   useBoatMode / useBoatAck; the mx-inv server forwards to the rules engine with the engine
 *   token (backend/boat_link.py) - the tablet never holds it; its own lock PIN is the guard
 *   (the owner 10-04). Only rendered when /capabilities says `boat`. Mode wording matches the
 *   landing page's System page (Ship's Automation stacks/home/site/system.html).
 */
import { useConfirm } from '../../components/ConfirmDialog'
import { friendlyError } from './CockpitBits'
import { type BoatMode, type BoatStatus, useBoatAck, useBoatMode } from './useCockpit'

const MODES: BoatMode[] = ['DOCK', 'ANCHOR', 'AWAY', 'MOTOR', 'SAIL']

// What each tap arms - same words as the System page's mode card.
const ARMS: Record<BoatMode, string> = {
  DOCK: 'the slip fence and the heel / shallow-water watch',
  ANCHOR: 'the anchor watch and the wind / heel / shallow-water / barometer watch',
  AWAY: 'the away watch (shore power lost while nobody is aboard)',
  MOTOR: 'the underway watches (GPS lost) - and DISARMS dock / anchor / away',
  SAIL: 'the underway watches (GPS lost) - and DISARMS dock / anchor / away',
}

const SEV_ORDER: Record<string, number> = { P1: 0, P2: 1, NUDGE: 2 }

export function AlarmBanner({ status, canWrite }: { status: BoatStatus; canWrite: boolean }) {
  const ack = useBoatAck()
  const alarms = [...status.alarms].sort((a, b) =>
    Number(a.acked) - Number(b.acked) || (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9))
  if (alarms.length === 0) return null
  const unacked = alarms.filter((a) => !a.acked).length
  const worst = alarms.some((a) => !a.acked && a.severity === 'P1') ? 'p1' : unacked ? 'p2' : 'acked'

  return (
    <section className={`cockpit-alarms cockpit-alarms--${worst}`} role="alert" aria-live="assertive">
      <ul>
        {alarms.map((a) => (
          <li key={a.rule} className={a.acked ? 'acked' : undefined}>
            <span className={`cockpit-sev cockpit-sev--${a.severity.toLowerCase()}`}>{a.severity}</span>
            {a.simulated && <span className="cockpit-sev cockpit-sev--test">TEST</span>}
            <span className="cockpit-alarm-text">{a.message}</span>
            {a.acked && <span className="cockpit-alarm-acked">acked</span>}
          </li>
        ))}
      </ul>
      {unacked > 0 && canWrite && (
        <button type="button" className="cockpit-alarm-ack" disabled={ack.isPending} onClick={() => ack.mutate()}>
          {ack.isPending ? 'Acking...' : `✓ Ack ${unacked === 1 ? 'alarm' : `all ${unacked}`}`}
        </button>
      )}
      {ack.isError && <p className="cockpit-status cockpit-status--error">Ack failed - {friendlyError(ack.error)}</p>}
    </section>
  )
}

export function ModeCard({ status, canWrite }: { status: BoatStatus; canWrite: boolean }) {
  const confirm = useConfirm()
  const setMode = useBoatMode()
  const tapped = status.mode_manual

  const tap = async (mode: BoatMode) => {
    const ok = await confirm({
      title: `Set boat mode to ${mode}?`,
      message: `This arms ${ARMS[mode]}.` +
        (mode === 'DOCK' || mode === 'ANCHOR' || mode === 'AWAY'
          ? '\nOnly another tap disarms it - tap MOTOR or SAIL before casting off.' : ''),
      confirmLabel: `Set ${mode}`,
      cancelLabel: 'Leave it',
    })
    if (ok) setMode.mutate(mode)
  }

  return (
    <section className="cockpit-mode-card">
      <div className="cockpit-mode-now">
        Boat mode <strong>{status.mode ?? 'unknown'}</strong>
        {!tapped && <span className="cockpit-mode-hint"> - not tapped yet</span>}
        {status.test_active && <span className="cockpit-sev cockpit-sev--test">TEST RUNNING</span>}
      </div>
      {canWrite ? (
        <div className="cockpit-mode-buttons" role="group" aria-label="Set boat mode">
          {MODES.map((m) => (
            <button
              key={m} type="button" aria-pressed={tapped === m}
              className={tapped === m ? 'active' : undefined}
              disabled={setMode.isPending}
              onClick={() => tap(m)}
            >
              {m}
            </button>
          ))}
        </div>
      ) : (
        <p className="cockpit-status">Mode taps are off on this server (no engine token).</p>
      )}
      {setMode.isError && (
        <p className="cockpit-status cockpit-status--error">Mode not set - {friendlyError(setMode.error)}</p>
      )}
    </section>
  )
}

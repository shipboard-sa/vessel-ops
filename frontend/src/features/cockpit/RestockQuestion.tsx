/**
 * Purpose: The cold boxes' EXPECTED? question on the cockpit (Ship's Automation WF-502 / D-128): when a fridge /
 *   freezer has been over its limit 10 min and mx-inv never saw food go in, the boat asks - YES (warm food went in on
 *   purpose: its alarm waits 2 h while it cools down) or NO (not expected: the alarm now).
 * Version: v1 (2026-10-18)
 * Scope: PRODUCTION - mx-inv frontend, cockpit feature.
 * Architecture: Shown on every screen under the alarm banner (CockpitApp.tsx) while /capabilities says `restock`.
 *   Reads useRestock (GET /api/cockpit/restock every 10 s), answers through useRestockAnswer; the mx-inv server
 *   forwards to the rules engine's POST /restock with the engine token (backend/boat_link.py). No answer = nothing
 *   changes: the alarm comes at 30 min as before. The phones get the same question as a NUDGE.
 * Invocation: rendered by CockpitApp.tsx.
 */
import { friendlyError } from './CockpitBits'
import { useRestock, useRestockAnswer } from './useCockpit'

export function RestockQuestion() {
  const q = useRestock(true)
  const answer = useRestockAnswer()
  const down = q.errorUpdatedAt > q.dataUpdatedAt
  const asking = down ? [] : (q.data?.boxes ?? []).filter((b) => b.asking)
  if (asking.length === 0) return null
  const hours = q.data?.hold_h ?? 2

  return (
    <section className="cockpit-restock" role="alert" aria-live="assertive">
      {asking.map((b) => (
        <div key={b.box} className="cockpit-restock-box">
          <p className="cockpit-restock-q">
            <strong>{b.label}</strong> has been warm for 10 min - did warm food just go in?
          </p>
          {q.data?.can_write ? (
            <div className="cockpit-restock-buttons" role="group" aria-label={`${b.label}: expected?`}>
              <button type="button" className="yes" disabled={answer.isPending}
                onClick={() => answer.mutate({ box: b.box, answer: 'yes' })}>
                YES, expected
                <small>give it {hours} h to cool down</small>
              </button>
              <button type="button" className="no" disabled={answer.isPending}
                onClick={() => answer.mutate({ box: b.box, answer: 'no' })}>
                NO, not expected
                <small>alarm now</small>
              </button>
            </div>
          ) : (
            <p className="cockpit-status">Answers are off on this server (no engine token) - the alarm comes at 30 min.</p>
          )}
        </div>
      ))}
      {answer.isError && (
        <p className="cockpit-status cockpit-status--error">Not answered - {friendlyError(answer.error)}</p>
      )}
    </section>
  )
}

/**
 * Purpose: Cockpit shift-change screen - the weather summary from routing's newest passage
 *   briefing above the "Watch Handover Checklist" run panel.
 * Version: v4 (2026-10-05) - v4: 'This watch' (logbook events + entries since the last watch entry) and the
 *   'Log this watch' button (ThisWatch.tsx). v3 (2026-10-05) - v3: the pre-filled 'Boat now' card (HandoverCard.tsx) above the weather when the
 *   server has SignalK configured. v2 (2026-10-04) - v2 (cockpit production pass): the weather card shows the briefing's
 *   tropical line, wind / seas / pressure and its age ("OLD" past 24 h) instead of a TODO
 *   placeholder; the checklist is found in the light GET /tasks/checklists list; a network
 *   failure says "could not load" with Retry instead of the misleading "no Watch Handover
 *   Checklist found". v1 (2026-09-17).
 * Scope: PRODUCTION - mx-inv /cockpit UI.
 * Architecture: useWatchHandoverWx (GET /api/cockpit/watch-handover/wx - reads the last-computed
 *   briefing, never a live re-run) + useCockpitChecklists; the checklist is the first top-level
 *   checklist whose name contains "watch handover" (renaming it on the desktop breaks this).
 */
import { useCockpitCapabilities, useCockpitChecklists, useWatchHandoverWx } from './useCockpit'
import { ChecklistRunPanel } from './CockpitChecklists'
import { LoadError } from './CockpitBits'
import { HandoverCardView } from './HandoverCard'
import { ThisWatch } from './ThisWatch'
import type { WatchHandoverWx } from '../../api/types'

export function WatchHandover({ onBack }: { onBack: () => void }) {
  const lists = useCockpitChecklists()
  const { data: caps } = useCockpitCapabilities()
  const wx = useWatchHandoverWx(!!caps?.weather)

  const checklist = (lists.data ?? []).find((t) => t.task_name.toLowerCase().includes('watch handover'))

  return (
    <div className="cockpit-watch-handover">
      {caps?.handover_live && <HandoverCardView />}
      <ThisWatch />
      {caps?.weather && <WxSummary wx={wx.data} isLoading={wx.isLoading} isError={wx.isError && !wx.data} />}
      {lists.isLoading && <p className="cockpit-status">Loading…</p>}
      {lists.isError && !lists.data && (
        <>
          <button type="button" className="cockpit-back" onClick={onBack}>← Back</button>
          <LoadError what="the Watch Handover Checklist" error={lists.error} onRetry={() => lists.refetch()} />
        </>
      )}
      {lists.data && !checklist && (
        <>
          <button type="button" className="cockpit-back" onClick={onBack}>← Back</button>
          <p className="cockpit-status cockpit-status--error">
            No checklist with "Watch Handover" in its name - add or rename one in Management on the desktop app.
          </p>
        </>
      )}
      {checklist && <ChecklistRunPanel checklist={checklist} onBack={onBack} />}
    </div>
  )
}

function ageText(h: number | undefined): string {
  if (h === undefined) return ''
  if (h < 1) return 'under an hour ago'
  if (h < 48) return `${Math.round(h)} h ago`
  return `${Math.round(h / 24)} days ago`
}

function WxSummary({ wx, isLoading, isError }: { wx?: WatchHandoverWx; isLoading: boolean; isError: boolean }) {
  const b = wx?.briefing
  return (
    <div className={`cockpit-wx-summary${b?.old ? ' cockpit-wx-summary--old' : ''}`}>
      <h3>🌦 Weather - last passage briefing</h3>
      {isLoading && <p className="cockpit-status">Checking the last briefing…</p>}
      {isError && <p className="cockpit-status cockpit-status--error">Could not read the routing briefing.</p>}
      {wx && b && (
        <p className="cockpit-wx-meta">
          <strong>{b.title || b.stem}</strong> · {b.generated_text || new Date(b.generated_at).toLocaleString()}
          {' '}({ageText(b.age_hours)}){b.old && <span className="cockpit-wx-old"> OLD - check Windy / NWS for now</span>}
        </p>
      )}
      {wx?.status === 'ok' && b && (
        <dl className="cockpit-wx-fields">
          {b.tropical && <><dt>Tropical</dt><dd>{b.tropical}</dd></>}
          {b.wind && <><dt>Wind</dt><dd>{b.wind}</dd></>}
          {b.seas && <><dt>Seas</dt><dd>{b.seas}</dd></>}
          {b.pressure && <><dt>Pressure</dt><dd>{b.pressure}</dd></>}
        </dl>
      )}
      {wx?.status === 'PENDING' && <p className="cockpit-status">{wx.reason}</p>}
    </div>
  )
}

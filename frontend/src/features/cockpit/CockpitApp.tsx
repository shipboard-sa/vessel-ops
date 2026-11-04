/**
 * Purpose: Entry point for the /cockpit route - the helm phone / companionway tablet UI: a home
 *   screen of big tap tiles (Watch Handover, Run a Checklist, Depart / Arrive, Sail Plan, Break / Incident, Tanks).
 * Version: v7 (2026-10-18) - v7: the cold boxes' EXPECTED? question (RestockQuestion.tsx, Ship's Automation WF-502 /
 *   D-128) under the alarm banner on every screen. v6 (2026-10-09) - v6: a Tanks tile (TanksScreen.tsx - levels + the crew 'Filling' / 'Stop' tap into the
 *   rules engine's fill sessions, Ship's Automation D-129); it reads 'Filling: <tank>' while a session is open.
 *   v5 (2026-10-05) - v5: a Depart / Arrive tile (PassageForm.tsx, schema v38 passages) - it reads
 *   'Under way: X → Y' while a leg is open. v4 (2026-10-05) - v4: wired to the boat automation stack - the alarm banner (with Ack)
 *   shows on every screen, the boat-mode card on the home screen (BoatStrip.tsx), and a plain line
 *   when the rules engine is not answering. v3 (2026-10-04) - v3 (cockpit production pass): a top bar on every screen with the
 *   Day / Sun / Night screen-mode switch and the "no contact with the boat server" banner;
 *   capabilities that fail to load say so (they used to hide the tiles silently).
 *   v2 (2026-09-24, release package): Sail Plan and Break / Incident tiles only show when their
 *   outside logbook is configured (GET /api/cockpit/capabilities). v1 (2026-09-17).
 * Scope: PRODUCTION - mx-inv frontend, cockpit feature, served by backend/main.py.
 * Architecture: A separate rendering from the desktop <App/>, picked in main.tsx by path. One
 *   responsive layout for phone and tablet via CockpitApp.css media queries; local useState
 *   screen switch, no router. Checklist running reuses management/ChecklistSteps; the other
 *   features call backend/routers/cockpit.py and backend/routers/logbook.py.
 * Invocation: rendered by main.tsx when the path starts with /cockpit.
 */
import { useState } from 'react'
import { ApiError } from '../../api/client'
import { WatchHandover } from './WatchHandover'
import { CockpitChecklists } from './CockpitChecklists'
import { SailPlanForm } from './SailPlanForm'
import { IncidentForm } from './IncidentForm'
import { PassageForm } from './PassageForm'
import { TanksScreen, fillingLabels } from './TanksScreen'
import { useCurrentPassage } from '../logbook/useLogbook'
import { useBoatStatus, useCockpitCapabilities, useFill, type BoatStatus, type CockpitCapabilities } from './useCockpit'
import { ConnectionBanner, ThemeSwitch, friendlyError, useCockpitTheme } from './CockpitBits'
import { AlarmBanner, ModeCard } from './BoatStrip'
import { RestockQuestion } from './RestockQuestion'
import './CockpitApp.css'

type Screen = 'home' | 'watch-handover' | 'checklists' | 'sail-plan' | 'incident' | 'passage' | 'tanks'

export function CockpitApp() {
  const [screen, setScreen] = useState<Screen>('home')
  const [theme, setTheme] = useCockpitTheme()
  const capsQuery = useCockpitCapabilities()
  const caps = capsQuery.data
  const boat = useBoatStatus(!!caps?.boat)
  // Down = the newest answer was a failure (isError alone flickers false while each 5 s poll is in
  // flight). Never show a remembered mode / alarm list then - stale reads as live.
  const boatDown = boat.errorUpdatedAt > boat.dataUpdatedAt
  const boatErr = boat.error ?? boat.failureReason
  const boatNow = boatDown ? undefined : boat.data
  const canWrite = !!caps?.boat_write

  return (
    <div className="cockpit-app">
      {/* Night mode's colour map (CockpitApp.css: html[data-cockpit-theme="night"]): brightness
          becomes red only, green and blue go to zero - keeps night vision. Must stay in the page
          whenever the cockpit is shown, or a url() filter with no target hides the page. */}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
        <filter id="cockpit-night" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="0.2 0.36 0.07 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />
        </filter>
      </svg>
      <div className="cockpit-topbar">
        <button type="button" className="cockpit-topbar-home" onClick={() => setScreen('home')} title="Home">
          ⚓ Cockpit
        </button>
        <ThemeSwitch theme={theme} onChange={setTheme} />
      </div>
      <ConnectionBanner />
      {boatNow && <AlarmBanner status={boatNow} canWrite={canWrite} />}
      {caps?.restock && <RestockQuestion />}
      {caps?.boat && boatDown && (
        <p className="cockpit-status cockpit-status--error cockpit-boat-down">
          ⚠ Alarms and boat mode are not shown -{' '}
          {boatErr instanceof ApiError && typeof boatErr.detail === 'string'
            ? boatErr.detail : friendlyError(boatErr)}
        </p>
      )}
      <main className="cockpit-main">
        {screen === 'home' && (
          <CockpitHome onPick={setScreen} capsQuery={capsQuery} boat={boatNow} canWrite={canWrite} />
        )}
        {screen === 'watch-handover' && <WatchHandover onBack={() => setScreen('home')} />}
        {screen === 'checklists' && <CockpitChecklists onHome={() => setScreen('home')} />}
        {screen === 'sail-plan' && <SailPlanForm onBack={() => setScreen('home')} />}
        {screen === 'incident' && <IncidentForm onBack={() => setScreen('home')} />}
        {screen === 'passage' && <PassageForm onBack={() => setScreen('home')} />}
        {screen === 'tanks' && <TanksScreen onBack={() => setScreen('home')} />}
      </main>
    </div>
  )
}

function CockpitHome({ onPick, capsQuery, boat, canWrite }: {
  onPick: (screen: Screen) => void
  capsQuery: ReturnType<typeof useCockpitCapabilities>
  boat: BoatStatus | undefined
  canWrite: boolean
}) {
  const { data: caps, isError, error } = capsQuery as { data?: CockpitCapabilities; isError: boolean; error: unknown }
  const { data: leg } = useCurrentPassage()
  const fill = useFill(!!caps?.fill, 30_000)
  const filling = fill.errorUpdatedAt > fill.dataUpdatedAt ? [] : fillingLabels(fill.data)
  return (
    <div className="cockpit-home">
      {boat && <ModeCard status={boat} canWrite={canWrite} />}
      <div className="cockpit-home-grid">
        <button type="button" className="cockpit-home-tile" onClick={() => onPick('watch-handover')}>
          <span className="cockpit-home-tile-icon">🕐</span>
          <span>Watch Handover</span>
        </button>
        <button type="button" className="cockpit-home-tile" onClick={() => onPick('checklists')}>
          <span className="cockpit-home-tile-icon">☑️</span>
          <span>Run a Checklist</span>
        </button>
        <button type="button" className="cockpit-home-tile" onClick={() => onPick('passage')}>
          <span className="cockpit-home-tile-icon">{leg ? '🏁' : '⚓'}</span>
          <span>{leg ? `Under way → ${leg.bound_for}` : 'Depart'}</span>
          {leg && <small>tap to log the arrival</small>}
        </button>
        {caps?.sail_plan && (
          <button type="button" className="cockpit-home-tile" onClick={() => onPick('sail-plan')}>
            <span className="cockpit-home-tile-icon">⛵</span>
            <span>Sail Plan</span>
          </button>
        )}
        {caps?.fill && (
          <button type="button" className="cockpit-home-tile" onClick={() => onPick('tanks')}>
            <span className="cockpit-home-tile-icon">⛽</span>
            <span>{filling.length ? `Filling: ${filling.join(', ')}` : 'Tanks'}</span>
            {filling.length > 0 && <small>tap to see the level or stop</small>}
          </button>
        )}
        {caps?.incident && (
          <button type="button" className="cockpit-home-tile" onClick={() => onPick('incident')}>
            <span className="cockpit-home-tile-icon">⚠️</span>
            <span>Break / Incident</span>
          </button>
        )}
      </div>
      {isError && !caps && (
        <p className="cockpit-status cockpit-status--error">
          Could not ask the server which other tiles are switched on - {friendlyError(error)}
        </p>
      )}
    </div>
  )
}

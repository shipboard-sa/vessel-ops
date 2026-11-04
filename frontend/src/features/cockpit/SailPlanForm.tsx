/**
 * Purpose: Cockpit Sail Plan tile - shows the sail set now and logs a change: main (down / full / reef 1-3), ONE
 *   headsail (genoa or staysail, full / reef 1-3, or none), wing-on-wing, and "when" (logged once the boat is
 *   settled - the change happened N minutes ago).
 * Version: v3 (2026-10-05) - v3 (the owner's review): every change goes into the SHIP'S LOG, signed (AuthorPick), and
 *   SignalK is updated when it can be (the answer says which) - the tile works with no boat stack; ENGINE ON / OFF
 *   buttons log motoring (the polar must leave it out). Always shown. v2 (2026-10-05) - v2: rebuilt to the owner's sail options (Ship's Automation HB-09, 2026-09-29) and wired to our
 *   SignalK (`sails.activeSet`, back-dated to "when"); the history DB keeps every change. Replaces the free
 *   checklist that posted to the previous developer's never-built sail-config webhook. v1 (2026-09-17).
 * Scope: PRODUCTION - mx-inv frontend, cockpit feature.
 * Architecture: GET / POST /api/cockpit/sail-plan (backend/routers/cockpit.py -> backend/sail_plan.py ->
 *   boat_link.signalk_publish). Rules live in the backend; this screen only disables what the backend would refuse
 *   (wing-on-wing without main + genoa). Always shown (v3); /capabilities.sail_plan_signalk says whether SignalK is updated too.
 */
import { useState } from 'react'
import type { Headsail, HeadsailState, MainState } from '../../api/types'
import { friendlyError, LoadError } from './CockpitBits'
import { useSailPlanNow, useSailPlanSet } from './useCockpit'
import { AuthorPick, rememberAuthor, useAuthor } from '../logbook/AuthorPick'
import { useLogEngine, usePropulsion } from '../logbook/useLogbook'
import { ApiError } from '../../api/client'

const MAIN: [MainState, string][] = [['down', 'Down'], ['full', 'Full'], ['reef1', 'Reef 1'], ['reef2', 'Reef 2'], ['reef3', 'Reef 3']]
const HEADSAIL: [Headsail, string][] = [['none', 'None'], ['genoa', 'Genoa'], ['staysail', 'Staysail']]
const HS_STATE: [HeadsailState, string][] = [['full', 'Full'], ['reef1', 'Reef 1'], ['reef2', 'Reef 2'], ['reef3', 'Reef 3']]
const WHEN: [number, string][] = [[0, 'Just now'], [5, '5 min ago'], [10, '10 min ago'], [15, '15 min ago'], [30, '30 min ago']]
const YES_NO: [number, string][] = [[1, 'Yes'], [0, 'No']]

function Pick<T extends string | number>({ label, options, value, onChange, disabled }: {
  label: string; options: [T, string][]; value: T | null; onChange: (v: T) => void; disabled?: boolean
}) {
  return (
    <div className="cockpit-pick">
      <div className="cockpit-pick-label">{label}</div>
      <div className="cockpit-mode-buttons" role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={String(v)} type="button" disabled={disabled} aria-pressed={value === v}
                  className={value === v ? 'active' : undefined} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}

const hhmm = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''

export function SailPlanForm({ onBack }: { onBack: () => void }) {
  const now = useSailPlanNow()
  const set = useSailPlanSet()
  const [main, setMain] = useState<MainState | null>(null)
  const [headsail, setHeadsail] = useState<Headsail>('none')
  const [hsState, setHsState] = useState<HeadsailState>('full')
  const [wow, setWow] = useState(false)
  const [when, setWhen] = useState(0)
  const [saved, setSaved] = useState<string | null>(null)
  const [author, setAuthor, crew, onWatch] = useAuthor()
  const prop = usePropulsion()
  const engine = useLogEngine()
  const [engineMsg, setEngineMsg] = useState<string | null>(null)
  const [meter, setMeter] = useState('')          // the hour meter as read (prefilled with mx-inv's estimate)
  const meterShown = meter !== '' ? meter : prop.data?.engine_hours_now != null ? String(prop.data.engine_hours_now) : ''
  const meterNum = meterShown.trim() === '' ? null : Number(meterShown)
  const meterBad = meterNum !== null && (Number.isNaN(meterNum) || meterNum < 0)

  const wowAllowed = main !== null && main !== 'down' && headsail === 'genoa'

  const save = () => {
    if (!main || !author) return
    set.mutate(
      { main, headsail, headsail_state: headsail === 'none' ? null : hsState, wing_on_wing: wowAllowed && wow,
        minutes_ago: when, author },
      { onSuccess: (d) => {
        rememberAuthor(author)
        setSaved(`${d.entry_ref ?? ''} ${d.current?.label ?? ''}`.trim()
          + (d.signalk && d.signalk !== 'updated' ? ` - SignalK ${d.signalk}, logged only` : ''))
      } },
    )
  }

  const cur = now.data?.current
  return (
    <div className="cockpit-sail-plan">
      <div className="cockpit-panel-header">
        <button type="button" className="cockpit-back" onClick={onBack}>← Back</button>
        <h2>⛵ Sail Plan</h2>
      </div>

      {now.isError && !now.data && <LoadError what="the sail plan" error={now.error} onRetry={() => now.refetch()} />}
      {now.data && (
        <p className="cockpit-sail-now">
          Now: <strong>{cur ? cur.label : 'not logged yet'}</strong>
          {cur && now.data.since && <> · since {hhmm(now.data.since)}</>}
        </p>
      )}

      <div className="cockpit-pick">
        <div className="cockpit-pick-label">
          Engine{prop.data && <span className="cockpit-wx-meta"> - logged {prop.data.engine_on ? 'ON' : 'off'}
            {prop.data.engine_since && ` since ${hhmm(prop.data.engine_since)}`}</span>}
        </div>
        <div className="cockpit-mode-buttons" role="group" aria-label="Engine">
          {([[true, '⚙️ Engine on'], [false, 'Engine off']] as [boolean, string][]).map(([on, text]) => (
            <button key={String(on)} type="button" aria-pressed={prop.data?.engine_on === on}
              className={prop.data?.engine_on === on ? 'active' : undefined}
              disabled={engine.isPending || !author || prop.data?.engine_on === on || meterBad}
              onClick={() => engine.mutate({ on, author, source: 'cockpit', minutes_ago: when, hours: meterNum },
                { onSuccess: (e) => {
                  rememberAuthor(author); setMeter('')
                  setEngineMsg(`✅ ${e.entry_ref} ${e.title}${meterNum !== null ? ` · ${meterNum} h` : ''}`); prop.refetch()
                } })}>
              {text}
            </button>
          ))}
        </div>
        <label className="cockpit-notes-label" style={{ marginTop: '0.6rem' }}>
          Hour meter (check the gauge - also updates the maintenance meter)
          <input type="number" inputMode="decimal" step="0.1" value={meterShown} onChange={(e) => setMeter(e.target.value)}
            placeholder="e.g. 1250.4" />
        </label>
        {prop.data?.engine_hours_last != null && (
          <p className="cockpit-wx-meta">Last reading {prop.data.engine_hours_last} h - a lower one is refused.</p>
        )}
        {engineMsg && <p className="cockpit-status cockpit-status--done">{engineMsg}</p>}
        {engine.isError && (
          <p className="cockpit-status cockpit-status--error">Not logged - {engine.error instanceof ApiError
            && typeof engine.error.detail === 'string' ? engine.error.detail : friendlyError(engine.error)}</p>
        )}
      </div>
      <AuthorPick variant="cockpit" value={author} onChange={setAuthor} crew={crew} onWatch={onWatch} />

      {saved ? (
        <>
          <p className="cockpit-status cockpit-status--done">✅ Logged: {saved}</p>
          <button type="button" className="cockpit-big-button" onClick={() => { setSaved(null); setMain(null) }}>
            Log another change
          </button>
        </>
      ) : (
        <>
          <p className="cockpit-status">Secure the boat first - log it once she is settled and say when it happened.</p>
          <Pick label="Main" options={MAIN} value={main} onChange={setMain} />
          <Pick label="Headsail (one)" options={HEADSAIL} value={headsail} onChange={setHeadsail} />
          {headsail !== 'none' && (
            <Pick label={headsail === 'genoa' ? 'Genoa' : 'Staysail'} options={HS_STATE} value={hsState} onChange={setHsState} />
          )}
          <Pick label="Wing-on-wing (main + genoa)" options={YES_NO}
                value={wowAllowed && wow ? 1 : 0} onChange={(v) => setWow(v === 1)} disabled={!wowAllowed} />
          <Pick label="When" options={WHEN} value={when} onChange={setWhen} />
          <button type="button" className="cockpit-primary-action" disabled={!main || !author || set.isPending} onClick={save}>
            {set.isPending ? 'Saving…' : !main ? 'Pick the main first' : !author ? 'Pick who is logging it' : 'Save sail plan'}
          </button>
          {set.isError && <p className="cockpit-status cockpit-status--error">Not saved - {friendlyError(set.error)}</p>}
        </>
      )}
    </div>
  )
}

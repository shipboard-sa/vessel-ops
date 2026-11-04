/**
 * Purpose: The pre-filled watch-handover card (Ship's Automation WF-602 / CAMS N-39) - where the boat is and how she is
 *   going now, plus fuel / water used, distance run and the barometer trend over the watch.
 * Version: v2 (2026-10-05) - v2: outside weather rows (nearest NDBC station, waves, 12-h forecast) with source and age.
 *   v1 (2026-10-05)
 * Scope: PRODUCTION - mx-inv frontend, cockpit feature.
 * Architecture: Shown at the top of WatchHandover.tsx when /capabilities says handover_live. Reads useHandoverCard
 *   (backend/handover_card.py: SignalK now + the history read API). A value the boat does not have is simply not
 *   shown; heading, true wind and battery SoC are deliberately absent (see the backend file's header).
 */
import { friendlyError } from './CockpitBits'
import { type HandoverCard as Card, type TankLine, useHandoverCard } from './useCockpit'

function latLon(v: number, pos: string, neg: string): string {
  const a = Math.abs(v)
  const d = Math.floor(a)
  return `${d}°${((a - d) * 60).toFixed(2).padStart(5, '0')}′${v >= 0 ? pos : neg}`
}

function tank(t: TankLine | null, hours: number): string | null {
  if (!t || t.gal === null) return null
  const now = `${t.gal} gal${t.pct !== null ? ` (${t.pct}%)` : ''}`
  if (t.used_gal === null) return now
  if (t.used_gal < 0) return `${now} · filled ${-t.used_gal} gal in ${hours} h`
  return `${now} · used ${t.used_gal} gal in ${hours} h`
}

function baro(c: Card): string | null {
  if (c.baro_hpa === null) return null
  const d = c.baro_3h_change_hpa
  if (d === null) return `${c.baro_hpa} hPa`
  const arrow = d <= -0.5 ? '↘' : d >= 0.5 ? '↗' : '→'
  const warn = d <= -5 ? ' - FALLING FAST' : d <= -3 ? ' - falling' : ''
  return `${c.baro_hpa} hPa ${arrow} ${d > 0 ? '+' : ''}${d} in 3 h${warn}`
}

export function HandoverCardView() {
  const q = useHandoverCard(true)
  const c = q.data
  const rows: [string, string | null][] = c ? [
    ['Position', c.position ? `${latLon(c.position.lat, 'N', 'S')}  ${latLon(c.position.lon, 'E', 'W')}` : null],
    ['Speed', c.sog_kn === null ? null
      : `${c.sog_kn} kn SOG${c.cog_deg !== null ? ` · COG ${c.cog_deg}°T` : ''}${c.stw_kn !== null ? ` · ${c.stw_kn} kn thru water` : ''}`],
    ['Run this watch', c.distance_this_watch_nm === null ? null : `${c.distance_this_watch_nm} nm in ${c.watch_hours} h`],
    ['Wind (apparent)', c.wind_apparent_kn === null ? null
      : `${c.wind_apparent_kn} kn${c.wind_apparent_deg !== null
        ? ` · ${Math.abs(c.wind_apparent_deg)}° ${c.wind_apparent_deg < 0 ? 'port' : 'stbd'}` : ''}`],
    ['Barometer', baro(c)],
    ['Depth', c.depth_ft === null ? null : `${c.depth_ft} ft under the keel`],
    ['Fuel', tank(c.fuel, c.watch_hours)],
    ['Water', tank(c.water, c.watch_hours)],
    ['House bank', c.house_v === null ? null : `${c.house_v} V${c.house_a !== null ? ` · ${c.house_a > 0 ? '+' : ''}${c.house_a} A` : ''}`],
    ['Outside', c.outside?.obs ? `${c.outside.obs.wind_kn} kn${c.outside.obs.wind_from_deg != null ? ` from ${c.outside.obs.wind_from_deg}°` : ''}`
      + `${c.outside.obs.gust_kn != null ? `, gusts ${c.outside.obs.gust_kn}` : ''}${c.outside.obs.pressure_hpa != null ? ` · ${c.outside.obs.pressure_hpa} hPa` : ''}`
      + ` (${(c.outside.obs.station ?? '').split(' ')[0]}, ${c.outside.obs.nm} nm, ${c.outside.obs.age_min} min ago)` : null],
    ['Seas', c.outside?.waves ? `${c.outside.waves.height_ft} ft${c.outside.waves.period_s != null ? ` @ ${c.outside.waves.period_s} s` : ''}`
      + `${c.outside.waves.from_deg != null ? ` from ${c.outside.waves.from_deg}°` : ''}`
      + ` (${(c.outside.waves.station ?? '').split(' ')[0]}, ${c.outside.waves.nm} nm, ${c.outside.waves.age_min} min ago)` : null],
    ['Next 12 h', c.outside?.forecast ? `wind to ${c.outside.forecast.wind_max_kn ?? c.outside.forecast.wind_kn} kn`
      + `${c.outside.forecast.gust_max_kn != null ? `, gusts ${c.outside.forecast.gust_max_kn}` : ''}`
      + `${c.outside.forecast.wave_max_ft != null ? ` · seas to ${c.outside.forecast.wave_max_ft} ft` : ''} (Open-Meteo)` : null],
    ['Air / sea', c.air_f === null && c.sea_f === null ? null
      : `${c.air_f ?? '-'}°F air · ${c.sea_f ?? '-'}°F sea`],
  ] : []

  return (
    <div className="cockpit-wx-summary cockpit-handover-card">
      <h3>⛵ Boat now - for the handover</h3>
      {q.isLoading && <p className="cockpit-status">Reading the boat…</p>}
      {q.isError && !c && <p className="cockpit-status cockpit-status--error">Could not read the boat - {friendlyError(q.error)}</p>}
      {c && (
        <dl className="cockpit-wx-fields">
          {rows.filter(([, v]) => v !== null).map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      )}
      {c && <p className="cockpit-wx-meta">As of {new Date(c.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>}
    </div>
  )
}

/**
 * Purpose: Small shared pieces of the /cockpit tablet UI - the connection banner (stale-data
 *   warning on flaky Wi-Fi), the Day / Sun / Night theme switch, and a plain-words load-error
 *   box with a big Retry button.
 * Version: v1 (2026-10-04) - cockpit production pass.
 * Scope: PRODUCTION - mx-inv frontend, cockpit feature.
 * Architecture: Used by CockpitApp, CockpitChecklists and WatchHandover. The banner reads
 *   useCockpitPing (GET /api/cockpit/ping every 15 s); the theme is a data-cockpit-theme
 *   attribute on <html> (styles in CockpitApp.css), remembered per tablet in localStorage
 *   (a convenience only - wrapped in try/catch, defaults to Day).
 */
import { useEffect, useState } from 'react'
import { useCockpitPing } from './useCockpit'

// -- errors in plain words ---------------------------------------------------------------

/** "GET /tasks failed: 502 <html>..." -> something a wet crew member can act on. */
export function friendlyError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error ?? '')
  if (error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(msg)) {
    return "Can't reach the boat server - check the tablet is on the boat Wi-Fi."
  }
  const status = Number((/failed: (\d{3})/.exec(msg) ?? [])[1])
  if (status >= 500) return `The boat server had a problem (error ${status}). Try again in a moment.`
  if (status === 404) return 'Not found on the boat server - it may have been removed on the desktop app.'
  if (status) return `The boat server refused that (error ${status}).`
  return msg || 'Something went wrong.'
}

export function LoadError({ error, onRetry, what }: { error: unknown; onRetry: () => void; what: string }) {
  return (
    <div className="cockpit-error-box" role="alert">
      <p>Could not load {what}.</p>
      <p className="cockpit-error-detail">{friendlyError(error)}</p>
      <button type="button" className="cockpit-big-button" onClick={onRetry}>↻ Try again</button>
    </div>
  )
}

// -- connection banner ---------------------------------------------------------------------

const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function ConnectionBanner() {
  const ping = useCockpitPing()
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])

  const lost = !online || ping.isError
  if (!lost) return null
  return (
    <div className="cockpit-offline-banner" role="status">
      <strong>⚠ No contact with the boat server</strong>
      <span>
        {ping.dataUpdatedAt ? ` since ${hhmm(ping.dataUpdatedAt)}` : ''}
        {!online ? ' - the tablet is off Wi-Fi' : ''}. What you see may be out of date; ticks will not save until it is back.
      </span>
      <button type="button" className="cockpit-banner-retry" onClick={() => ping.refetch()}>↻ Retry</button>
    </div>
  )
}

// -- theme -------------------------------------------------------------------------------

export type CockpitTheme = 'day' | 'sun' | 'night'
const THEMES: { id: CockpitTheme; label: string; title: string }[] = [
  { id: 'day', label: '◐ Day', title: 'White on black, high contrast' },
  { id: 'sun', label: '☀ Sun', title: 'Black on white - easiest to read in direct sunlight' },
  { id: 'night', label: '☾ Night', title: 'Dim red - keeps night vision' },
]
const THEME_KEY = 'cockpit-theme'

function readTheme(): CockpitTheme {
  try {
    const v = window.localStorage.getItem(THEME_KEY)
    if (v === 'day' || v === 'sun' || v === 'night') return v
  } catch { /* private window / blocked storage - default */ }
  return 'day'
}

export function useCockpitTheme(): [CockpitTheme, (t: CockpitTheme) => void] {
  const [theme, setTheme] = useState<CockpitTheme>(readTheme)
  useEffect(() => {
    const root = document.documentElement
    root.dataset.cockpitTheme = theme
    try { window.localStorage.setItem(THEME_KEY, theme) } catch { /* not remembered, still applied */ }
    return () => { delete root.dataset.cockpitTheme }
  }, [theme])
  return [theme, setTheme]
}

export function ThemeSwitch({ theme, onChange }: { theme: CockpitTheme; onChange: (t: CockpitTheme) => void }) {
  return (
    <div className="cockpit-theme-switch" role="group" aria-label="Screen mode">
      {THEMES.map((t) => (
        <button
          key={t.id} type="button" title={t.title}
          className={theme === t.id ? 'active' : undefined}
          aria-pressed={theme === t.id}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

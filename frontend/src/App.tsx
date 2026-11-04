/**
 * Purpose: Desktop app shell - tab navigation across the mx-inv feature
 *   views (schedule, projects, warehouse, galley, etc.).
 * Version: v6 (2026-10-05) - v6: 📖 Ship's Log tab (features/logbook, schema v37 logbook). v5 (2026-09-24) - v5: header shows the boat name from Settings (blank = "Vessel Ops Panel")
 *   and a ⚙ Settings button (SettingsDialog); release package. v4 (2026-09-23) - v4: AppNav v3 - openRecord opens any record kind on the tab that
 *   owns it (tracker #74); a tab, once visited, stays MOUNTED (just hidden) when you switch away,
 *   so a trip to another tab and Back never loses unsaved ticks, counts or half-filled forms; v3 (2026-09-22) added the return trip (tracker #58); v2 2026-09-21,
 *   v1 2026-09-17
 * Scope: PRODUCTION - mx-inv frontend desktop UI, rendered by main.tsx for
 *   any path other than /cockpit.
 * Architecture: mx-inv frontend. Each tab renders one feature component
 *   from features/*; feature components own their own data fetching via
 *   react-query against backend/routers/*.
 * Invocation: imported by main.tsx; built with `npm run build`.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { ScheduleBoard } from './features/schedule/ScheduleBoard'
import { ManagementView } from './features/management/ManagementView'
import { ProjectsView } from './features/projects/ProjectsView'
import { WarehouseView } from './features/warehouse/WarehouseView'
import { GalleyView } from './features/galley/GalleyView'
import { RunChecklistView } from './features/run-checklist/RunChecklistView'
import { LayupReturnTool } from './features/layup-return/LayupReturnTool'
import { LogbookView } from './features/logbook/LogbookView'
import { TelemetryWidget } from './features/telemetry/TelemetryWidget'
import { SettingsDialog } from './components/SettingsDialog'
import { useSettings } from './api/settings'
import { AppNavProvider, ROUTE, type AppNav, type PendingOpen, type ReturnTarget, type TabId } from './components/AppNav'
import './App.css'
import './components/RecordLink.css'
import './components/SearchPick.css'

type Tab = TabId

function App() {
  const [tab, setTabState] = useState<Tab>('schedule')
  // Tabs you have opened stay mounted (hidden) so their state survives a cross-tab trip.
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set<Tab>(['schedule']))
  const setTab = (t: Tab) => { setTabState(t); setVisited((v) => (v.has(t) ? v : new Set(v).add(t))) }
  const pane = (t: Tab, node: ReactNode) =>
    visited.has(t) ? <div key={t} hidden={tab !== t}>{node}</div> : null
  const [pendingOpen, setPendingOpen] = useState<PendingOpen | null>(null)
  const [pendingReturn, setPendingReturn] = useState<ReturnTarget | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { data: settings } = useSettings()
  const boatName = settings?.vessel_name ?? ''
  useEffect(() => { document.title = boatName || 'Vessel Ops Panel' }, [boatName])
  const nav: AppNav = {
    openRecord: (ref, returnTo) => { setPendingOpen({ ref, returnTo: returnTo ?? null }); setTab(ROUTE[ref.kind]) },
    openItem: (itemId, returnTo) => { setPendingOpen({ ref: { kind: 'item', id: itemId }, returnTo: returnTo ?? null }); setTab('warehouse') },
    pendingOpen,
    clearPendingOpen: () => setPendingOpen(null),
    returnToOrigin: (returnTo) => { setPendingReturn(returnTo); setTab(returnTo.tab) },
    pendingReturn,
    clearPendingReturn: () => setPendingReturn(null),
  }

  return (
    <AppNavProvider value={nav}>
    <div className="app">
      <header className="app-header">
        <div className="app-title">
          <h1>⚓ {boatName || 'Vessel Ops Panel'}</h1>
          <button type="button" className={settings && !boatName ? 'settings-btn setup' : 'settings-btn'}
            onClick={() => setSettingsOpen(true)}>
            {settings && !boatName ? '⚙ Set up your boat' : '⚙ Settings'}
          </button>
        </div>
        <nav className="app-tabs">
          <button
            type="button"
            className={tab === 'schedule' ? 'active' : undefined}
            onClick={() => setTab('schedule')}
          >
            📋 Active Schedules
          </button>
          <button
            type="button"
            className={tab === 'run-checklist' ? 'active' : undefined}
            onClick={() => setTab('run-checklist')}
          >
            ▶ Run a Checklist
          </button>
          <button
            type="button"
            className={tab === 'projects' ? 'active' : undefined}
            onClick={() => setTab('projects')}
          >
            🗂️ Projects
          </button>
          <button
            type="button"
            className={tab === 'management' ? 'active' : undefined}
            onClick={() => setTab('management')}
          >
            🛠️ Management
          </button>
          <button
            type="button"
            className={tab === 'logbook' ? 'active' : undefined}
            onClick={() => setTab('logbook')}
          >
            📖 Ship's Log
          </button>
          <button
            type="button"
            className={tab === 'warehouse' ? 'active' : undefined}
            onClick={() => setTab('warehouse')}
          >
            📦 Warehouse
          </button>
          <button
            type="button"
            className={tab === 'galley' ? 'active' : undefined}
            onClick={() => setTab('galley')}
          >
            🍽️ Galley
          </button>
          <button
            type="button"
            className={tab === 'layup-return' ? 'active' : undefined}
            onClick={() => setTab('layup-return')}
          >
            ↩ Layup Return
          </button>
        </nav>
        <TelemetryWidget />
      </header>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      <main>
        {pane('schedule', <ScheduleBoard />)}
        {pane('run-checklist', <RunChecklistView />)}
        {pane('projects', <ProjectsView />)}
        {pane('management', <ManagementView />)}
        {pane('logbook', <LogbookView />)}
        {pane('warehouse', <WarehouseView />)}
        {pane('galley', <GalleyView />)}
        {pane('layup-return', <LayupReturnTool />)}
      </main>
    </div>
    </AppNavProvider>
  )
}

export default App

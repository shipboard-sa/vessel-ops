/**
 * Purpose: React entry point - mounts either the desktop app (App.tsx) or
 *   the /cockpit tablet UI (CockpitApp.tsx) depending on URL path.
 * Version: v3 (2026-10-04) - v3 (cockpit production pass): /cockpit gets its own QueryClient
 *   defaults for flaky boat Wi-Fi - reads retry with backoff (up to 15 s apart), refresh when the
 *   tablet wakes / reconnects, and an open checklist re-reads its ticks every 20 s so the phone
 *   and tablet agree. Writes are never retried automatically (a complete is not idempotent).
 *   v2 (2026-09-20) - adds ConfirmProvider (tracker #45)
 * Scope: PRODUCTION - mx-inv frontend, built to frontend/dist and served
 *   by backend/main.py's static mount / SPA fallback.
 * Architecture: mx-inv frontend root. Wraps everything in a single
 *   react-query QueryClientProvider shared by both UIs.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { CockpitApp } from './features/cockpit/CockpitApp.tsx'
import { ConfirmProvider } from './components/ConfirmDialog.tsx'

const isCockpit = window.location.pathname.startsWith('/cockpit')

const queryClient = new QueryClient({
  defaultOptions: {
    queries: isCockpit
      ? {
          staleTime: 30_000,
          refetchOnWindowFocus: true, // tablet woken from sleep -> fresh data
          refetchOnReconnect: true,
          retry: 4,
          retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),
        }
      : { staleTime: 30_000, refetchOnWindowFocus: false },
    // 'always' on the cockpit: a tick made while off Wi-Fi fails visibly now, instead of
    // being parked and replayed later behind the crew's back.
    mutations: isCockpit ? { retry: 0, networkMode: 'always' } : { retry: 0 },
  },
})
if (isCockpit) {
  queryClient.setQueryDefaults(['checklist-items'], { refetchInterval: 20_000 })
}

// No router dependency for one URL split - /cockpit gets the separate
// helm/companionway-tablet UI (see CockpitApp.tsx), everything else stays
// the existing desktop app. Both are served from the same built bundle;
// backend/main.py's SPA fallback already sends any non-/api path to this
// same index.html, so a page load or reload at /cockpit lands here with
// the right pathname.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConfirmProvider>
        {isCockpit ? <CockpitApp /> : <App />}
      </ConfirmProvider>
    </QueryClientProvider>
  </StrictMode>,
)

/**
 * Purpose: react-query hooks for the owner settings (boat name, hour-meter labels,
 *   manuals folder).
 * Version: v1 (2026-09-24)
 * Scope: PRODUCTION - mx-inv frontend data layer (added for the release package).
 * Architecture: GET/PUT /api/settings (backend/routers/settings.py). Read by App.tsx's
 *   header, components/SettingsDialog.tsx and the telemetry widget's meter labels.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiSend } from './client'

export interface AppSettings {
  vessel_name: string
  engine_label: string
  genset_label: string
  manuals_root: string
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => apiGet<AppSettings>('/settings'),
    staleTime: Infinity, // only changes through useUpdateSettings, which invalidates
  })
}

export function useUpdateSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (changes: Partial<AppSettings>) => apiSend<AppSettings>('PUT', '/settings', changes),
    onSuccess: (saved) => {
      queryClient.setQueryData(['settings'], saved)
      // The research button's availability depends on the manuals folder.
      queryClient.invalidateQueries({ queryKey: ['device-research'] })
    },
  })
}

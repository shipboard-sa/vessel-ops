/**
 * Purpose: The header's ⚙ Settings dialog - boat name, the two hour-meter labels, and
 *   the manuals folder used by the optional "Research with Claude" feature.
 * Version: v1 (2026-09-24)
 * Scope: PRODUCTION - mx-inv frontend shared component (added for the release package).
 * Architecture: Opened from App.tsx's header. Reads/writes through api/settings.ts
 *   (PUT /api/settings). Portalled to <body> like TapColumns so host-form CSS can't
 *   restyle it; no nested <form> (divs + Enter/Escape handlers, per the project rule).
 */
import { useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useSettings, useUpdateSettings, type AppSettings } from '../api/settings'
import './SettingsDialog.css'

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { data } = useSettings()
  if (!data) return null
  return <SettingsForm initial={data} onClose={onClose} />
}

function SettingsForm({ initial, onClose }: { initial: AppSettings; onClose: () => void }) {
  const [form, setForm] = useState<AppSettings>(initial)
  const save = useUpdateSettings()
  const set = (key: keyof AppSettings) => (value: string) => setForm((f) => ({ ...f, [key]: value }))
  const submit = () => save.mutate(form, { onSuccess: onClose })
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') submit()
  }

  return createPortal(
    <div className="settings-backdrop" onKeyDown={onKey}>
      <div className="settings-dialog" role="dialog" aria-label="Settings">
        <h3>⚙ Settings</h3>
        <Field label="Boat name" hint="shown in the header and on every printout"
          value={form.vessel_name} onChange={set('vessel_name')} placeholder="e.g. SV Example" autoFocus />
        <Field label="Engine hour meter" hint="what the main engine's hours are called"
          value={form.engine_label} onChange={set('engine_label')} placeholder="Main engine" />
        <Field label="Generator hour meter" hint="leave as is if you have no generator"
          value={form.genset_label} onChange={set('genset_label')} placeholder="Generator" />
        <Field label="Manuals folder" hint="optional - only for Research with Claude"
          value={form.manuals_root} onChange={set('manuals_root')} placeholder="e.g. C:\Boat\Manuals" />
        {save.isError && <p className="settings-error">Couldn't save: {(save.error as Error).message}</p>}
        <div className="settings-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" disabled={save.isPending} onClick={submit}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Field({ label, hint, value, onChange, placeholder, autoFocus }: {
  label: string; hint: string; value: string; onChange: (v: string) => void
  placeholder?: string; autoFocus?: boolean
}) {
  return (
    <label className="settings-field">
      <span>{label} <span className="hint">{hint}</span></span>
      <input value={value} placeholder={placeholder} autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

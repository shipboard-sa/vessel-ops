/**
 * Purpose: Full-screen System › Device picker - two tap columns, "＋ New …" first in each, plus a
 *   search box on top (people often know the device name, not its system).
 * Version: v1 (2026-09-24)
 * Scope: PRODUCTION - mx-inv frontend, management feature.
 * Architecture: Built on the shared components/TapColumns kit, the same view as the storage
 *   Compartment › Location › Container picker (the owner 2026-09-24: one interface for every tree).
 *   Two modes: 'any' = a system OR one of its devices (SystemPicker, ServesEditor, delete's
 *   reassign); 'parent' = a top-level system only (SystemScreen's Move…), optionally with a
 *   "make it a top-level system" row. Creates via useCreateSystem - never free text. `offWhy`
 *   greys out rows that cannot be picked and says why ("here now", "linked"...). Checklists is
 *   filtered by the caller via offerableSystems.
 */
import { useState } from 'react'
import type { SystemInfo } from '../../api/types'
import { useCreateSystem } from './mutations'
import { TapNewRow, TapOverlay, TapRow, type Done } from '../../components/TapColumns'

// A-Z, as every system list in the app is (sort_order is only partly filled in).
const byName = (a: SystemInfo, b: SystemInfo) => a.name.localeCompare(b.name)

export function SystemCascade({
  title, systems, value, mode = 'any', topLevelRow, offWhy, onPick, onClose,
}: {
  title: string
  /** Already filtered by the caller (offerableSystems). */
  systems: SystemInfo[]
  /** The current choice, so the columns open where it is. */
  value?: string | null
  mode?: 'any' | 'parent'
  /** 'parent' mode: offer "— make it a top-level system —", which picks null. */
  topLevelRow?: boolean
  /** A reason a row cannot be picked (shown as its tag), or null when it can. */
  offWhy?: (s: SystemInfo) => string | null
  onPick: (name: string | null) => void
  onClose: () => void
}) {
  const create = useCreateSystem()
  const current = systems.find((s) => s.name === value) ?? null
  const [sys, setSys] = useState<string | null>(current ? (current.parent_name ?? current.name) : null)
  const [q, setQ] = useState('')

  const top = systems.filter((s) => s.parent_name === null).sort(byName)
  const devicesOf = (name: string) => systems.filter((s) => s.parent_name === name).sort(byName)
  const devices = sys ? devicesOf(sys) : []
  const step = mode === 'parent' || sys === null ? 1 : 2

  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const results = words.length === 0 ? [] : systems
    .filter((s) => mode === 'any' || s.parent_name === null)
    .filter((s) => {
      const hay = `${s.name} ${s.parent_name ?? ''} ${s.make_model ?? ''}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  const make = (parent: string | null) => (name: string, done: Done<string>) =>
    create.mutate(parent ? { name, parent_name: parent } : { name }, {
      onSuccess: () => done(name), onError: (err) => done(null, (err as Error).message),
    })

  const row = (s: SystemInfo, opts: { label?: string; hint?: string | null; count?: number; on?: boolean; onClick: () => void }) => {
    const why = offWhy?.(s) ?? null
    return (
      <TapRow
        key={s.name}
        label={opts.label ?? s.name}
        hint={opts.hint}
        count={opts.count}
        on={opts.on ?? s.name === value}
        off={!!why}
        offTag={why ?? undefined}
        onClick={opts.onClick}
      />
    )
  }

  return (
    <TapOverlay
      title={title}
      path={sys && mode === 'any' ? sys : mode === 'parent' ? 'Pick the system' : 'Pick a system, then a device (or the system itself)'}
      onClose={onClose}
    >
      <div className="cc-search">
        <input
          placeholder={mode === 'parent' ? 'Or type to find a system…' : 'Or type to find a system or device (e.g. water pump)…'}
          value={q} onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {words.length > 0 ? (
        <div className="cc-results">
          <TapNewRow<string>
            key={`new-${q}`}
            label={`＋ New system “${q.trim()}”…`}
            initialName={q.trim()}
            onCreate={make(null)}
            onCreated={(name) => onPick(name)}
          />
          {results.map((s) => row(s, {
            hint: s.parent_name ? `device · ${s.parent_name}` : 'system',
            onClick: () => onPick(s.name),
          }))}
          {results.length === 0 && <p className="cc-dim cc-hint">No match - add it with the first row, or clear the search and tap through.</p>}
        </div>
      ) : (
        <div className={`cc-cols cc-cols--depth${mode === 'parent' ? 1 : 2} cc-cols--step${step}`}>
          <section className="cc-col cc-col--1">
            <h3>System</h3>
            <TapNewRow<string>
              label="＋ New system…"
              onCreate={make(null)}
              onCreated={(name) => (mode === 'parent' ? onPick(name) : setSys(name))}
            />
            {topLevelRow && (
              <button type="button" className="cc-newrow cc-newrow--plain" onClick={() => onPick(null)}>
                — make it a top-level system —
              </button>
            )}
            {top.map((s) => {
              const n = devicesOf(s.name).length
              return row(s, {
                count: mode === 'any' ? n : undefined,
                on: s.name === value || (mode === 'any' && s.name === sys),
                onClick: () => (mode === 'parent' ? onPick(s.name) : setSys(s.name)),
              })
            })}
          </section>

          {mode === 'any' && (
            <section className="cc-col cc-col--2">
              <h3>
                <button type="button" className="cc-back" onClick={() => setSys(null)}>← </button>
                {sys ?? 'Device'}
              </h3>
              {sys === null ? <p className="cc-dim cc-hint">Pick a system first.</p> : (
                <>
                  <TapNewRow<string>
                    key={`dev-${sys}`}
                    label={`＋ New device in ${sys}…`}
                    onCreate={make(sys)}
                    onCreated={(name) => onPick(name)}
                  />
                  {(() => {
                    const s = systems.find((x) => x.name === sys)
                    return s ? row(s, { label: `✓ Use “${sys}” itself (no device)`, onClick: () => onPick(sys) }) : null
                  })()}
                  {devices.map((d) => row(d, { hint: d.make_model, onClick: () => onPick(d.name) }))}
                  {devices.length === 0 && <p className="cc-dim cc-hint">No devices in {sys} yet.</p>}
                </>
              )}
            </section>
          )}
        </div>
      )}
    </TapOverlay>
  )
}

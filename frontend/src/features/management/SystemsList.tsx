/**
 * Purpose: The Systems tab of Management - a LIGHT, collapsed list of the systems (top level
 *   only until you expand one to see its devices). Clicking a system or device opens its own
 *   full-screen (SystemScreen); nothing is edited in the list itself.
 * Version: v1 (2026-09-19)
 * Scope: PRODUCTION - mx-inv frontend, management feature.
 * Architecture: Rendered by ManagementView in "systems" mode; reads useSystems only and hands
 *   clicks up (onOpen). Replaces the old always-expanded SystemsAdmin panel (tracker #36/#37,
 *   the owner 2026-09-19: "top level should stay compressed; going below it opens a full screen").
 *   The list stays mounted (hidden) while a screen is open so the search and which systems
 *   are expanded survive Back.
 */
import { useMemo, useState } from 'react'
import type { SystemInfo } from '../../api/types'
import { useSystems } from './useTasks'
import { useCreateSystem } from './mutations'
import { offerableSystems } from './housekeeping'
import { ApiError } from '../../api/client'

export function systemErrorMessage(err: unknown): string {
  const detail = err instanceof ApiError ? (err.detail as { message?: string } | undefined) : undefined
  return detail?.message ?? (err as Error).message
}

export function SystemsList({ onOpen }: { onOpen: (name: string) => void }) {
  const { data: systems, isLoading, isError, error } = useSystems()
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showAdd, setShowAdd] = useState(false)

  const topLevel = useMemo(
    () => offerableSystems(systems ?? []).filter((s) => s.parent_name === null)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [systems],
  )
  const childrenOf = (name: string) =>
    (systems ?? []).filter((s) => s.parent_name === name).sort((a, b) => a.name.localeCompare(b.name))

  if (isLoading) return <p className="mgmt-status">Loading systems…</p>
  if (isError) return <p className="mgmt-status mgmt-status--error">{(error as Error).message}</p>
  if (!systems) return null

  const q = search.trim().toLowerCase()
  const matches = (s: SystemInfo) => s.name.toLowerCase().includes(q)
  // While searching, show a system if it or any of its devices match, expanded to the matches.
  const visible = topLevel.filter((s) => !q || matches(s) || childrenOf(s.name).some(matches))
  const toggle = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  return (
    <div className="systems-list">
      <div className="mgmt-toolbar">
        <input
          type="text"
          placeholder="🔍 Search systems and devices"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="button" onClick={() => setShowAdd((v) => !v)}>+ Add system</button>
        <button type="button" onClick={() => setExpanded(new Set(topLevel.filter((s) => childrenOf(s.name).length).map((s) => s.name)))}>
          Expand all
        </button>
        <button type="button" onClick={() => setExpanded(new Set())}>Collapse all</button>
      </div>
      {showAdd && <NewSystemForm systems={systems} onDone={() => setShowAdd(false)} />}

      <ul className="systems-tree">
        {visible.length === 0 && <li className="mgmt-empty">No systems match.</li>}
        {visible.map((s) => {
          const kids = childrenOf(s.name)
          const shownKids = q ? kids.filter((k) => matches(s) || matches(k)) : kids
          const open = q ? shownKids.length > 0 : expanded.has(s.name)
          const taskTotal = s.task_count + kids.reduce((n, k) => n + k.task_count, 0)
          return (
            <li key={s.name} className="systems-tree-item">
              <div className="systems-tree-row">
                {kids.length > 0 ? (
                  <button
                    type="button" className="systems-tree-chevron" onClick={() => toggle(s.name)}
                    aria-expanded={open} title={open ? 'Collapse' : 'Show devices'}
                  >
                    {open ? '▾' : '▸'}
                  </button>
                ) : <span className="systems-tree-chevron systems-tree-chevron--none" />}
                <button type="button" className="link-button systems-tree-name" onClick={() => onOpen(s.name)}>
                  {s.name}
                </button>
                <span className="systems-tree-meta">
                  {kids.length > 0 && `${kids.length} device${kids.length === 1 ? '' : 's'} · `}
                  {taskTotal} task{taskTotal === 1 ? '' : 's'}
                  {kids.length === 0 && ` · ${s.item_count} part${s.item_count === 1 ? '' : 's'}`}
                </span>
              </div>
              {open && shownKids.length > 0 && (
                <ul className="systems-tree-children">
                  {shownKids.map((k) => (
                    <li key={k.name} className="systems-tree-row">
                      <span className="systems-tree-chevron systems-tree-chevron--none" />
                      <button type="button" className="link-button systems-tree-name" onClick={() => onOpen(k.name)}>
                        {k.name}
                      </button>
                      <span className="systems-tree-meta">
                        {k.task_count} task{k.task_count === 1 ? '' : 's'} · {k.item_count} part{k.item_count === 1 ? '' : 's'}
                        {k.installed_qty > 1 && ` · ×${k.installed_qty} installed`}
                      </span>
                      {k.no_spares_needed ? (
                        <span className="systems-tree-badge">no spares needed</span>
                      ) : k.item_count === 0 ? (
                        <span className="systems-tree-badge systems-tree-badge--warn" title="No part is linked to this device yet">
                          no parts linked
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function NewSystemForm({ systems, onDone }: { systems: SystemInfo[]; onDone: () => void }) {
  const createSystem = useCreateSystem()
  const [name, setName] = useState('')
  const [parentName, setParentName] = useState('')
  const topLevel = offerableSystems(systems).filter((s) => s.parent_name === null)
    .sort((a, b) => a.name.localeCompare(b.name))
  const submit = () => {
    if (!name.trim()) return
    createSystem.mutate(
      { name: name.trim(), parent_name: parentName || null },
      { onSuccess: () => { setName(''); setParentName(''); onDone() } },
    )
  }
  return (
    <div className="mgmt-inline-form">
      <input
        placeholder="New system or device name" value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
      />
      <select value={parentName} onChange={(e) => setParentName(e.target.value)}>
        <option value="">— top-level system —</option>
        {topLevel.map((s) => <option key={s.name} value={s.name}>device under {s.name}</option>)}
      </select>
      <button type="button" onClick={submit} disabled={createSystem.isPending || !name.trim()}>Add</button>
      <button type="button" onClick={onDone}>Cancel</button>
      {createSystem.error && (
        <span className="mgmt-status mgmt-status--error">{systemErrorMessage(createSystem.error)}</span>
      )}
    </div>
  )
}

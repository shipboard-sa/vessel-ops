/**
 * Purpose: The one way to show the name of a record that has a detail page - a tappable name that
 *   opens it (in place when the current tab can, else on its own tab with Back returning here),
 *   plus CheckRow (a tick box and a name as two separate targets) and SystemTaskLabel (a system and
 *   a task as two separate targets).
 * Version: v1 (2026-09-23)
 * Scope: PRODUCTION - mx-inv frontend, shared by every feature (tracker #74 "clickable to detail").
 * Architecture: Reads AppNav's useOpenRecord (components/AppNav.tsx), which consults the tab's
 *   NavScope. Where there is no AppNav (the /cockpit UI) or the id is unknown, the name renders as
 *   plain text. The rule these enforce (the owner, 2026-09-23): anything on screen with its own detail
 *   page opens it when tapped; a checkbox ticks, a name opens; never two records in one button.
 */
import type { MouseEvent, ReactNode } from 'react'
import { useOpenRecord, type RecordRef } from './AppNav'
import { CHECKLISTS_SYSTEM } from '../features/management/housekeeping'
import './RecordLink.css'

export function RecordLink({
  to, children, className, title,
}: {
  /** What to open; null/undefined renders plain text (e.g. a free-text part with no catalog id). */
  to: RecordRef | null | undefined
  children: ReactNode
  className?: string
  title?: string
}) {
  const open = useOpenRecord()
  // `Checklists` is a housekeeping system, not equipment - it has no screen to open (tracker #31).
  if (!to || !open || (to.kind === 'system' && to.name === CHECKLISTS_SYSTEM)) return <span className={className}>{children}</span>
  return (
    <button
      type="button"
      className={`record-link${className ? ` ${className}` : ''}`}
      title={title ?? 'Open'}
      onClick={(e: MouseEvent) => { e.stopPropagation(); open(to) }}
    >
      {children}
    </button>
  )
}

/** A tick box and a name as TWO targets: the box ticks, the name opens its record. */
export function CheckRow({
  checked, onToggle, to, name, disabled, className, children,
}: {
  checked: boolean
  onToggle: (checked: boolean) => void
  to: RecordRef | null | undefined
  name: ReactNode
  disabled?: boolean
  className?: string
  /** Anything after the name (quantity, notes, inputs). */
  children?: ReactNode
}) {
  return (
    <div className={`check-row${className ? ` ${className}` : ''}`}>
      <label className="check-row-box" aria-label="tick">
        <input
          type="checkbox" checked={checked} disabled={disabled}
          onChange={(e) => onToggle(e.target.checked)}
        />
      </label>
      <RecordLink to={to} className="check-row-name">{name}</RecordLink>
      {children}
    </div>
  )
}

/** "system — task" as two targets: the system chip opens the device, the name opens the task. */
export function SystemTaskLabel({
  system, taskId, taskName, onOpenTask,
}: {
  system: string | null | undefined
  taskId: number | null | undefined
  taskName: ReactNode
  /** Override for the task half (e.g. a screen that opens its own step/task focus). */
  onOpenTask?: () => void
}) {
  return (
    <span className="system-task-label">
      {system && (
        <>
          <RecordLink to={{ kind: 'system', name: system }} className="system-chip"><code>{system}</code></RecordLink>
          <span className="system-task-sep"> — </span>
        </>
      )}
      {onOpenTask ? (
        <button type="button" className="record-link" onClick={(e) => { e.stopPropagation(); onOpenTask() }}>
          {taskName}
        </button>
      ) : (
        <RecordLink to={taskId ? { kind: 'task', id: taskId } : null}>{taskName}</RecordLink>
      )}
    </span>
  )
}

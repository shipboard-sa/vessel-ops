/**
 * Purpose: One collapsible task row on the Schedule board.
 * Version: v3 (2026-09-24) - v3: a never-done task says "not done yet" instead of an assumed
 *   last-done date (schema v36). v2 (2026-09-18)
 * Scope: PRODUCTION - mx-inv frontend, schedule feature.
 * Architecture: Rendered per row by ScheduleBoard; expands into
 *   TaskCardDetail and forwards onOpenRecord (open the full record focus
 *   screen) up to the board.
 */
import { useState } from 'react'
import type { TaskRow } from '../../api/types'
import { TaskCardDetail } from './TaskCardDetail'
import './TaskCard.css'

// days/hrs default bump, matching gui_components.py's Streamlit defer controls
const DEFAULT_BUMP: Record<string, number> = { days: 7, hrs: 25 }

export function TaskCard({ row, onOpenRecord }: { row: TaskRow; onOpenRecord: (taskId: number) => void }) {
  const [open, setOpen] = useState(false)
  const kind = row.interval_type_clean
  const deferrable = kind === 'days' || kind === 'hrs'
  const bump = DEFAULT_BUMP[kind] ?? 7

  return (
    <li className={row.is_critical ? 'task-critical' : undefined}>
      <button type="button" className="task-card-header" onClick={() => setOpen((v) => !v)}>
        <span className="task-card-glyph">{glyph(row)}</span>
        <span className="task-card-title">
          <span className="task-name">{row.task_name}</span>
          <span className="task-summary">{summarize(row)}</span>
        </span>
        <span className="task-card-caret">{open ? '▾' : '▸'}</span>
      </button>
      {open && <TaskCardDetail row={row} deferrable={deferrable} bump={bump} onOpenRecord={onOpenRecord} />}
    </li>
  )
}

function glyph(row: TaskRow): string {
  const kind = row.interval_type_clean
  if (kind === 'break_fix') return '🔧'
  if (kind === 'hrs') return '⚙️'
  if (row.task_kind === 'checklist') return '✅'
  if (kind === 'use') return '🏁'
  return '🗓️'
}

function summarize(row: TaskRow): string {
  const kind = row.interval_type_clean
  const last = row.never_done ? 'not done yet' : `last done ${row.formatted_last_done || '—'}`
  const rem = row.days_remaining
  const status = rem < 0 ? `OVERDUE by ${Math.abs(rem)}d` : `due in ${rem}d`
  const deferredNote = row.deferred_days > 0 ? `  ·  ⏳ +${row.deferred_days}${kind === 'hrs' ? 'h' : 'd'}` : ''

  if (kind === 'days') {
    return `every ${row.period}d, due ${row.calculated_due_date} (${status}; ${last})${deferredNote}`
  }
  if (kind === 'hrs') {
    return `every ${row.period} h (${row.calculated_due_date})${deferredNote}`
  }
  if (kind === 'break_fix') {
    const p = (row.period || '').toLowerCase()
    const tag = p.includes('immediate') ? 'IMMEDIATE' : p.includes('urgent') ? 'URGENT' : 'ROUTINE'
    return `[${tag} REPAIR]`
  }
  if (row.task_kind === 'checklist') return `checklist, ${last}`
  return `as used, ${last}`
}

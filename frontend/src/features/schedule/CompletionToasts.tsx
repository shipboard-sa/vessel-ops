/**
 * Purpose: Renders the completion toasts (confirmation / error) as a fixed stack in
 *   the corner of the Schedule screen.
 * Version: v1 (2026-09-19)
 * Scope: PRODUCTION - mx-inv frontend, schedule feature.
 * Architecture: Reads schedule/completionToast's store; mounted once by ScheduleBoard.
 */
import { dismissToast, useToasts } from './completionToast'

export function CompletionToasts() {
  const toasts = useToasts()
  if (toasts.length === 0) return null
  return (
    <div className="completion-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`completion-toast completion-toast--${t.kind}`}>
          <span>{t.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>✕</button>
        </div>
      ))}
    </div>
  )
}

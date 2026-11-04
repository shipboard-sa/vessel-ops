/**
 * Purpose: Tap-safe in-app confirmation for every delete / remove / void action.
 *   `const confirm = useConfirm(); if (await confirm({ title, message, confirmLabel })) ...`
 * Version: v1 (2026-09-20)
 * Scope: PRODUCTION - mx-inv frontend, shared component (tracker #45).
 * Architecture: <ConfirmProvider> is mounted once in main.tsx (wraps both the desktop
 *   app and /cockpit). Replaces the browser's confirm(): the native dialog is small,
 *   is auto-dismissed in the browser test pane, and (the owner, 2026-09-20) a stray tablet tap
 *   while someone else is driving deleted things. Here the dialog is large, the SAFE
 *   button ("Keep it") has focus and sits first, the destructive button is a separate
 *   big target with a gap, and tapping the backdrop or pressing Escape cancels.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import './ConfirmDialog.css'

export interface ConfirmOptions {
  title: string
  /** Optional detail: what else goes with it, and whether it can be undone. */
  message?: string
  /** Label on the destructive button, e.g. "Delete location". Default "Delete". */
  confirmLabel?: string
  /** Label on the safe button. Default "Keep it". */
  cancelLabel?: string
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

interface Pending extends ConfirmOptions { resolve: (ok: boolean) => void }

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const safeButton = useRef<HTMLButtonElement>(null)

  const confirm = useCallback<ConfirmFn>(
    (options) => new Promise<boolean>((resolve) => {
      // A second request while one is open cancels the first rather than stacking dialogs.
      setPending((prev) => { prev?.resolve(false); return { ...options, resolve } })
    }),
    [],
  )

  const close = (ok: boolean) => {
    pending?.resolve(ok)
    setPending(null)
  }

  useEffect(() => {
    if (!pending) return
    safeButton.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { pending.resolve(false); setPending(null) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div className="confirm-backdrop" onClick={() => close(false)}>
          <div
            className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="confirm-title">{pending.title}</h3>
            {pending.message && <p className="confirm-message">{pending.message}</p>}
            <div className="confirm-actions">
              <button ref={safeButton} type="button" className="confirm-keep" onClick={() => close(false)}>
                {pending.cancelLabel ?? 'Keep it'}
              </button>
              <button type="button" className="confirm-go" onClick={() => close(true)}>
                {pending.confirmLabel ?? 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext)
  if (!fn) throw new Error('useConfirm must be used inside <ConfirmProvider>')
  return fn
}

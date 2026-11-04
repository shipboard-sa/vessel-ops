/**
 * Purpose: "Convert to imperial" for one recipe's text - fetches a proposal,
 *   shows each before -> after change plus the converted text in an editable
 *   box, and saves it as the recipe body only when the user clicks Apply.
 * Version: v1 (2026-09-18)
 * Scope: PRODUCTION - mx-inv frontend, recipes feature.
 * Architecture: Rendered by RecipeFocus.tsx (view mode, non-reference
 *   recipes). Calls useConvertRecipeText (GET /recipes/{id}/convert-text,
 *   ephemeral) and useUpdateRecipe (PATCH body only, which invalidates the
 *   recipe queries so the focus screen refreshes). The metric original is
 *   discarded on Apply by the owner's decision (2026-09-18) - no backup is kept.
 */
import { useState } from 'react'
import type { RecipeTextConversion } from '../../api/types'
import { useConvertRecipeText, useUpdateRecipe } from './mutations'

export function ConvertToImperial({ recipeId }: { recipeId: number }) {
  const convert = useConvertRecipeText()
  const update = useUpdateRecipe()
  const [proposal, setProposal] = useState<RecipeTextConversion | null>(null)
  const [text, setText] = useState('')

  const close = () => {
    setProposal(null)
    convert.reset()
    update.reset()
  }

  const open = () => {
    update.reset()
    convert.mutate(recipeId, {
      onSuccess: (p) => { setProposal(p); setText(p.converted_body) },
    })
  }

  const apply = () => {
    update.mutate({ recipeId, fields: { body: text } }, { onSuccess: close })
  }

  if (!proposal) {
    return (
      <div className="recipe-convert">
        <button type="button" disabled={convert.isPending} onClick={open}>
          {convert.isPending ? 'Converting…' : '🔄 Convert to imperial'}
        </button>
        {convert.isError && (
          <p className="mgmt-status mgmt-status--error">{(convert.error as Error).message}</p>
        )}
      </div>
    )
  }

  if (proposal.changes.length === 0) {
    return (
      <div className="recipe-convert recipe-convert-panel">
        <p className="mgmt-status">No metric measurements found.</p>
        <div className="recipe-convert-actions">
          <button type="button" onClick={close}>✕ Close</button>
        </div>
      </div>
    )
  }

  return (
    <div className="recipe-convert recipe-convert-panel">
      <p className="mgmt-status">
        {proposal.changes.length} change{proposal.changes.length === 1 ? '' : 's'} proposed -
        nothing is saved until you Apply.
      </p>
      <ul className="recipe-convert-changes">
        {proposal.changes.map((c, i) => (
          <li key={i}>
            <span className="recipe-convert-before">{c.original}</span>
            {' → '}
            <span className="recipe-convert-after">{c.converted}</span>
          </li>
        ))}
      </ul>
      <label className="recipe-convert-text">
        Converted text (edit before applying)
        <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <p className="recipe-warning">
        Apply replaces the recipe text with this version; the original metric text is not kept.
      </p>
      {update.isError && (
        <p className="mgmt-status mgmt-status--error">{(update.error as Error).message}</p>
      )}
      <div className="recipe-convert-actions">
        <button type="button" className="apply" disabled={update.isPending} onClick={apply}>
          {update.isPending ? 'Saving…' : '✅ Apply'}
        </button>
        <button type="button" disabled={update.isPending} onClick={close}>✕ Cancel</button>
      </div>
    </div>
  )
}

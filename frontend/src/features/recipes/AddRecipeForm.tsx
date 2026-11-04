import { useState, type FormEvent } from 'react'
import { useCreateRecipe } from './mutations'
import { RECIPE_METHODS } from '../../api/types'
import { REF_PREFIX, csv } from './shared'

export function AddRecipeForm() {
  const createRecipe = useCreateRecipe()
  const [expanded, setExpanded] = useState(false)
  const [refOnly, setRefOnly] = useState(false)
  const [title, setTitle] = useState('')
  const [servings, setServings] = useState('')
  const [source, setSource] = useState('')
  const [page, setPage] = useState('')
  const [body, setBody] = useState('')
  const [ingredients, setIngredients] = useState('')
  const [methods, setMethods] = useState<string[]>([])
  const [methodOther, setMethodOther] = useState('')
  const [tags, setTags] = useState('')
  const [notes, setNotes] = useState('')
  const [warning, setWarning] = useState<string | null>(null)

  const reset = () => {
    setTitle(''); setServings(''); setSource(''); setPage(''); setBody('')
    setIngredients(''); setMethods([]); setMethodOther(''); setTags(''); setNotes('')
    setRefOnly(false); setWarning(null); setExpanded(false)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) { setWarning('Need a title.'); return }
    let realBody: string
    let realSource: string | undefined
    let realNotes: string | undefined
    if (refOnly) {
      const src = [source.trim(), page.trim()].filter(Boolean).join(' — ') || 'the book'
      realBody = `${REF_PREFIX} — see ${src}.`
      if (notes.trim()) realBody += `\n\n${notes.trim()}`
      realSource = undefined
      realNotes = undefined
    } else {
      if (!body.trim()) { setWarning("Need the recipe text (or tick 'Reference only')."); return }
      realBody = body
      realSource = source.trim() || undefined
      realNotes = notes.trim() || undefined
    }
    createRecipe.mutate(
      {
        title: title.trim(), body: realBody, source: realSource, servings: servings || undefined,
        notes: realNotes, ingredients: csv(ingredients), methods: [...methods, ...csv(methodOther)],
        tags: csv(tags),
      },
      { onSuccess: reset },
    )
  }

  if (!expanded) {
    return (
      <button type="button" className="link-button" onClick={() => setExpanded(true)}>
        + Add a recipe
      </button>
    )
  }

  return (
    <form className="recipe-form" onSubmit={submit}>
      <label className="checkbox-label">
        <input type="checkbox" checked={refOnly} onChange={(e) => setRefOnly(e.target.checked)} />
        📖 Reference only — cook from the book (no full text; just index it)
      </label>

      {warning && <p className="recipe-warning">{warning}</p>}

      <div className="item-detail-row">
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Braised Short Ribs" />
        </label>
        <label>
          Servings
          <input value={servings} onChange={(e) => setServings(e.target.value)} placeholder="4" />
        </label>
        <label>
          Source
          <input
            value={source} onChange={(e) => setSource(e.target.value)}
            placeholder={refOnly ? 'Joy of Cooking (Kindle)' : "book / URL / 'typed'"}
          />
        </label>
      </div>

      {refOnly ? (
        <label>
          Page / Kindle location
          <input value={page} onChange={(e) => setPage(e.target.value)} placeholder="p. 412" />
        </label>
      ) : (
        <label>
          Recipe — paste it here (ingredients + method, as written)
          <textarea
            rows={8} value={body} onChange={(e) => setBody(e.target.value)}
            placeholder={'2 cups rice\n1 lb chicken thighs\n...\n\n1. Brown the chicken...'}
          />
        </label>
      )}

      <label>
        Main ingredients (comma-separated) — what you'd search by
        <input value={ingredients} onChange={(e) => setIngredients(e.target.value)} placeholder="beef, carrot, onion" />
      </label>

      <div className="item-detail-row">
        <label>
          Cooking method(s)
          <select
            multiple value={methods}
            onChange={(e) => setMethods(Array.from(e.target.selectedOptions).map((o) => o.value))}
          >
            {RECIPE_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label>
          …other method
          <input value={methodOther} onChange={(e) => setMethodOther(e.target.value)} />
        </label>
      </div>

      <label>
        Other tags (comma-separated)
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="dinner, one-handed, make-ahead, kid-friendly" />
      </label>
      <label>
        Your notes
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="do it in the Foodi, 35 min high" />
      </label>

      <div className="item-detail-actions">
        <button type="submit" disabled={createRecipe.isPending}>Save recipe</button>
        <button type="button" onClick={() => setExpanded(false)}>Cancel</button>
      </div>
    </form>
  )
}

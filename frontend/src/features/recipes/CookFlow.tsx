/**
 * Purpose: The one shared "cook this" flow - pick which ingredients to draw,
 *   adjust quantities, swap an ingredient for this cook, add ad-hoc extras,
 *   then complete and see the stock-draw / shortfall result.
 * Version: v8 (2026-09-23) - v8: the swap and "Add another ingredient" pickers are FoodPick -
 *   type to search, "＋ Add … as a new food item" first, created inline - instead of long plain
 *   selects; the swap's "(default: …)" choice is FoodPick's none row (tracker #76).
 *   v7: each ingredient line is a CheckRow (the box picks it, the name
 *   opens the item actually in use - the swapped one, else the linked one); shortfall names in
 *   the result open their items (tracker #74).
 *   v6 (2026-09-23) - v6 (tracker #71): changes made here can be SAVED TO THE RECIPE.
 *   A swapped line, a changed amount or an added ingredient gets "📌 Save to recipe", and a
 *   bar under the list says "changes are for this meal only" with one "💾 Save all N
 *   changes to the recipe" button (the crew's first pass through a recipe: fix a wrong match,
 *   add a missing ingredient, and have it stick). Unsaved changes stay one-off, as before.
 *   The meal's own protein pick is left out of "Save all" (a per-meal choice by design).
 *   Needs the caller's recipeId; with none, nothing here changes. Also (tracker #75): "＋ New
 *   item…" moved from the BOTTOM of the swap / extra lists to the top.
 *   v5 (2026-09-22)
 * Scope: PRODUCTION - mx-inv frontend, recipes + meal plan features.
 * Architecture: Presentational + local pick state; owns no endpoint. Callers
 *   pass in what differs: RecipeIngredients.tsx completes via
 *   POST /recipes/{id}/make (useMakeRecipe); mealplan/MealPlanEntryFocus.tsx
 *   completes via POST /meal-plan/{id}/complete (which also drops the plan
 *   entry) and additionally saves the picks as the entry's overrides. Merged
 *   from two hand-copied versions (SavedIngredientsView + MealPlanEntryCard)
 *   on 2026-09-18 when both became focus screens. v2: shows a non-blocking
 *   "recipe unit differs from stock unit" warning per line (draws are NOT
 *   converted - warning only); the number/"have" units show the item's stock unit.
 *   v3: the bulk-reference note flags only bulk lines with no catalog link or
 *   zero on hand (the owner); bulk lines are otherwise never stock-checked or drawn.
 *   v4: the bulk note became the PANTRY CHECK (crew member, 2026-09-19): bulk staples are
 *   assumed available; a tick on "do we need more?" puts the item on the shopping
 *   list. Done at plan time on the meal-plan screen, and still here at cook time.
 *   A line with no catalog item gets a link-or-add control that saves on the recipe.
 *   v5 (tracker #53/#54): the swap select and the "+ Add another ingredient" extras
 *   picked from the catalog only, unlike the parse-review and link-or-add screens which
 *   can create a new catalog item on the spot - now both offer a "+ new item..." option
 *   that opens the shared warehouse/NewFoodItemForm inline, same as everywhere else.
 */
import { useState, type ReactNode } from 'react'
import type { MakeRecipeResult, MealPlanOverridePick, RecipeIngredient } from '../../api/types'
import { useItems } from '../warehouse/useWarehouse'
import { useUnits } from '../../api/units'
import { FoodPick } from '../warehouse/ItemPick'
import { LinkOrAddItem, PantryCheck } from './PantryCheck'
import { useApplyIngredientChanges, type RecipeIngredientChanges } from './mutations'
import { CheckRow, RecordLink } from '../../components/RecordLink'

/** One line of a stock draw: a recipe ingredient (maybe swapped/re-quantified) or an extra. */
export type CookPick = MealPlanOverridePick

interface Extra { key: number; itemId: number | null; quantity: number }

export interface CookFlowProps {
  ingredients: RecipeIngredient[]
  /** The recipe these lines belong to - enables "📌 Save to recipe" (tracker #71). */
  recipeId?: number
  /** Meal plan: this meal's chosen protein. A line swapped to it is a per-meal choice, so
   *  "Save all" leaves it out (its own 📌 button still works). */
  mealProteinItemId?: number | null
  /** Picks previously saved on a meal-plan entry; pre-fills the flow once, at mount. */
  initialPicks?: CookPick[] | null
  /** Complete the cook: the caller picks the endpoint. onDone receives the draw result. */
  onComplete: (consumption: CookPick[], onDone: (res: MakeRecipeResult) => void) => void
  completing: boolean
  completeLabel: string
  completingLabel: string
  /** Start of the result sentence, e.g. "✅ Drew stock for" -> "... for 3 item(s)." */
  resultLead: string
  /** Shown beside a line with no catalog item to draw from. */
  noLinkHint: string
  /** True when completing ends the flow (a plan entry falls off the plan): show
   *  only the result afterwards instead of leaving the form up to re-submit. */
  doneReplacesForm?: boolean
  /** Meal plan only: record the current picks without drawing stock. Shows the
   *  "Save picks" button + explanatory note. */
  onSavePicks?: (picks: CookPick[], onSaved: () => void) => void
  savingPicks?: boolean
  /** Shown instead of a list when the recipe has no structured ingredients. */
  emptyNote?: ReactNode
  /** Extra buttons at the end of the action row (Re-parse, Remove from plan). */
  actions?: ReactNode
}

export function CookFlow({
  ingredients, recipeId, mealProteinItemId, initialPicks, onComplete, completing, completeLabel,
  completingLabel, resultLead, noLinkHint, doneReplacesForm, onSavePicks, savingPicks, emptyNote, actions,
}: CookFlowProps) {
  const { data: allFoodItems } = useItems('food')
  const { data: units } = useUnits()
  // Draws are counted in the ITEM's stock unit and never converted from the
  // recipe line's unit, so a differing recipe unit gets a heads-up (no block).
  const unitWarning = (recipeUnit: string | null, qty: number | null, stockUnit: string | undefined) => {
    if (!recipeUnit || !stockUnit || recipeUnit === stockUnit) return null
    const rd = units?.find((u) => u.unit_key === recipeUnit)?.dimension
    const sd = units?.find((u) => u.unit_key === stockUnit)?.dimension
    const kind = rd && sd
      ? (rd === sd ? 'same kind of measure, not converted' : `${rd} vs ${sd}, not converted`)
      : 'no conversion'
    return `⚠ recipe says ${qty !== null ? `${qty} ` : ''}${recipeUnit} · stock counts ${stockUnit} (${kind})`
  }
  // Seeded once at mount from whatever was saved while planning the menu
  // (the owner, 2026-09-17: needed at both plan and make time). Lazy initialisers, so
  // a later refetch of the plan list can't clobber in-progress edits.
  const [seed] = useState(() => seedFromPicks(initialPicks))
  const [picked, setPicked] = useState<Record<number, boolean>>(seed.picked)
  const [qty, setQty] = useState<Record<number, number>>(seed.qty)
  // Swap-for-this-cook only, never saved back to the recipe - lets a base
  // recipe's variable line (e.g. Chef's Salad/Mac & Cheese's protein) draw
  // a different catalog item per cook instead of needing a duplicate
  // recipe per protein (the owner/crew member, 2026-09-17).
  const [swap, setSwap] = useState<Record<number, number>>(seed.swap)
  // Ad-hoc extra draws for this cook only, never saved back to the recipe -
  // e.g. a second protein, or an item not normally in the recipe at all
  // (crew member, 2026-09-17: "add another ingredient" at the end of the list).
  const [extras, setExtras] = useState<Extra[]>(seed.extras)
  const [result, setResult] = useState<{ consumed: number; shortfalls: MakeRecipeResult['shortfalls'] } | null>(null)
  const [saved, setSaved] = useState(false)

  const direct = ingredients.filter((i) => !i.is_bulk)
  const bulk = ingredients.filter((i) => i.is_bulk)

  // Untouched lines default to picked when they have a catalog item to draw.
  const isPicked = (i: RecipeIngredient) => picked[i.recipe_ingredient_id] ?? i.item_id != null

  const buildPicks = (
    sw: Record<number, number> = swap, qt: Record<number, number> = qty, ex: Extra[] = extras,
  ): CookPick[] => [
    ...direct
      .filter((i) => isPicked(i) && (sw[i.recipe_ingredient_id] ?? i.item_id))
      .map((i) => ({
        recipe_ingredient_id: i.recipe_ingredient_id,
        quantity: qt[i.recipe_ingredient_id] ?? i.quantity ?? undefined,
        item_id: sw[i.recipe_ingredient_id],
      })),
    ...ex
      .filter((e) => e.itemId)
      .map((e) => ({ item_id: e.itemId!, quantity: e.quantity })),
  ]

  // --- "📌 Save to recipe" (tracker #71) ------------------------------------------------
  const applyChanges = useApplyIngredientChanges()
  const [recipeSaved, setRecipeSaved] = useState<string | null>(null)
  const relinkOf = (i: RecipeIngredient) => {
    const s = swap[i.recipe_ingredient_id]
    return s != null && s !== i.item_id ? s : undefined
  }
  const qtyChangeOf = (i: RecipeIngredient) => {
    const q = qty[i.recipe_ingredient_id]
    return q != null && q !== i.quantity ? q : undefined
  }
  const lineChanged = (i: RecipeIngredient) => relinkOf(i) !== undefined || qtyChangeOf(i) !== undefined
  const isMealProtein = (i: RecipeIngredient) =>
    mealProteinItemId != null && relinkOf(i) === mealProteinItemId
  const changedLines = direct.filter(lineChanged)
  const savableExtras = extras.filter((e) => e.itemId)
  const saveAllLines = changedLines.filter((i) => !isMealProtein(i))
  const saveAllCount = saveAllLines.length + savableExtras.length

  const saveToRecipe = (lines: RecipeIngredient[], extraKeys: number[]) => {
    if (recipeId == null) return
    const changes: RecipeIngredientChanges = {
      updates: lines.map((i) => {
        const u: RecipeIngredientChanges['updates'][number] = { recipe_ingredient_id: i.recipe_ingredient_id }
        const relink = relinkOf(i)
        const q = qtyChangeOf(i)
        if (relink !== undefined) u.item_id = relink
        if (q !== undefined) u.quantity = q
        return u
      }),
      additions: extras
        .filter((e) => extraKeys.includes(e.key) && e.itemId)
        .map((e) => ({ item_id: e.itemId!, quantity: e.quantity })),
    }
    setRecipeSaved(null)
    applyChanges.mutate({ recipeId, changes }, {
      onSuccess: () => {
        // What is now in the recipe is no longer a one-off change on this cook/meal.
        const ids = new Set(lines.map((i) => i.recipe_ingredient_id))
        const nextSwap = Object.fromEntries(Object.entries(swap).filter(([k]) => !ids.has(Number(k))))
        const nextQty = Object.fromEntries(Object.entries(qty).filter(([k]) => !ids.has(Number(k))))
        const nextExtras = extras.filter((e) => !extraKeys.includes(e.key))
        setSwap(nextSwap)
        setQty(nextQty)
        setExtras(nextExtras)
        const n = lines.length + changes.additions.length
        setRecipeSaved(`✅ Saved ${n} change${n === 1 ? '' : 's'} to the recipe - used every time from now on.`)
        // Meal plan: keep the entry's saved picks in step, or an added ingredient that is now
        // a recipe line would also stay behind as an extra and be drawn twice.
        if (onSavePicks) onSavePicks(buildPicks(nextSwap, nextQty, nextExtras), () => {})
      },
    })
  }
  const keepButton = (onClick: () => void) => recipeId != null && (
    <button
      type="button" className="keep-in-recipe" disabled={applyChanges.isPending}
      title="Save this change to the recipe itself, so it is there every time - not just for this meal"
      onClick={onClick}
    >
      📌 Save to recipe
    </button>
  )

  const complete = () => {
    onComplete(buildPicks(), (res) => {
      setResult({
        consumed: res.consumed.length,
        shortfalls: res.shortfalls,
      })
    })
  }

  const resultNote = result && (
    <p className="recipe-cook-result">
      {resultLead} {result.consumed} item(s).
      {result.shortfalls.length > 0 && (
        <>
          {' ⚠️ Short: '}
          {result.shortfalls.map((s, n) => (
            <span key={`${s.item_id}-${n}`}>
              {n > 0 && ', '}
              <RecordLink to={{ kind: 'item', id: s.item_id }}>{s.item_name}</RecordLink>
              {` (short ${s.short_by} ${s.unit})`}
            </span>
          ))}
          .
        </>
      )}
    </p>
  )
  if (result && doneReplacesForm) return resultNote

  return (
    <div className="recipe-ingredients">
      {ingredients.length === 0 && emptyNote}
      {(direct.length > 0 || extras.length > 0) && (
        <ul className="recipe-ingredients-list">
          {direct.map((i) => {
            const swappedId = swap[i.recipe_ingredient_id]
            const swappedItem = swappedId ? allFoodItems?.find((f) => f.item_id === swappedId) : undefined
            const onhand = swappedItem ? swappedItem.quantity_onhand : (i.quantity_onhand ?? 0)
            const linkedItem = !swappedItem && i.item_id !== null
              ? allFoodItems?.find((f) => f.item_id === i.item_id) : undefined
            const stockItem = swappedItem ?? linkedItem
            // Stock unit when there's an item to draw from (that's what the number
            // is counted in); otherwise the recipe's own unit, purely for display.
            const unit = stockItem ? stockItem.unit : i.unit
            const warning = unitWarning(i.unit, i.quantity, stockItem?.unit)
            const short = (swappedItem ? true : i.item_id !== null) && i.quantity !== null && onhand < i.quantity
            return (
              <li
                key={i.recipe_ingredient_id}
                className={[short ? 'short' : '', warning ? 'has-unit-warning' : ''].filter(Boolean).join(' ') || undefined}
              >
                <CheckRow
                  checked={isPicked(i)}
                  disabled={!i.item_id && !swappedId}
                  onToggle={(b) => setPicked((p) => ({ ...p, [i.recipe_ingredient_id]: b }))}
                  to={(swappedId ?? i.item_id) ? { kind: 'item', id: (swappedId ?? i.item_id) as number } : null}
                  name={swappedItem ? swappedItem.item_name : (i.item_name ?? i.raw_text)}
                >
                  {!i.item_id && !swappedId && <em> {noLinkHint}</em>}
                </CheckRow>
                {!i.item_id && !swappedId && <LinkOrAddItem line={i} />}
                <FoodPick
                  value={swappedId ?? null}
                  noneLabel={i.item_name ? `(default: ${i.item_name})` : '— swap in an item —'}
                  placeholder={i.item_name ? `(default: ${i.item_name}) - type to swap` : '— swap in an item —'}
                  recipeUnit={i.unit}
                  onPick={(p) => {
                    setSwap((s) => { const next = { ...s }; if (p) next[i.recipe_ingredient_id] = p.itemId; else delete next[i.recipe_ingredient_id]; return next })
                    setPicked((pk) => ({ ...pk, [i.recipe_ingredient_id]: true }))
                  }}
                />
                <input
                  type="number" min={0} step="any"
                  value={qty[i.recipe_ingredient_id] ?? i.quantity ?? 0}
                  onChange={(e) => setQty((q) => ({ ...q, [i.recipe_ingredient_id]: Number(e.target.value) }))}
                />
                <span className="unit">{unit}</span>
                {(i.item_id || swappedId) && (
                  <span className={short ? 'onhand short' : 'onhand'}>
                    have {onhand} {unit}
                  </span>
                )}
                {warning && <span className="unit-mismatch" role="note">{warning}</span>}
                {lineChanged(i) && (
                  <>
                    {isMealProtein(i) && <span className="mgmt-status">this meal's protein</span>}
                    {keepButton(() => saveToRecipe([i], []))}
                  </>
                )}
              </li>
            )
          })}
          {extras.map((e) => {
            const item = e.itemId ? allFoodItems?.find((f) => f.item_id === e.itemId) : undefined
            const onhand = item?.quantity_onhand ?? 0
            const short = !!item && onhand < e.quantity
            return (
              <li key={e.key} className={short ? 'short' : undefined}>
                <FoodPick
                  value={e.itemId}
                  placeholder="Type an item to add…"
                  onPick={(p) => setExtras((xs) => xs.map((x) => (x.key === e.key ? { ...x, itemId: p ? p.itemId : null } : x)))}
                />
                <input
                  type="number" min={0} step="any"
                  value={e.quantity}
                  onChange={(ev) => setExtras((xs) => xs.map((x) => (x.key === e.key ? { ...x, quantity: Number(ev.target.value) } : x)))}
                />
                <span className="unit">{item?.unit ?? ''}</span>
                {item && <span className={short ? 'onhand short' : 'onhand'}>have {onhand} {item.unit}</span>}
                {e.itemId && keepButton(() => saveToRecipe([], [e.key]))}
                <button type="button" className="link-button" onClick={() => setExtras((xs) => xs.filter((x) => x.key !== e.key))}>✕</button>
              </li>
            )
          })}
        </ul>
      )}
      <button
        type="button" className="link-button"
        onClick={() => setExtras((xs) => [...xs, { key: Date.now() + Math.random(), itemId: null, quantity: 1 }])}
      >
        + Add another ingredient
      </button>

      {recipeId != null && saveAllCount > 0 && (
        <div className="keep-in-recipe-bar">
          <span>
            ✏️ You changed {saveAllCount} ingredient{saveAllCount === 1 ? '' : 's'}. Changes are for
            this meal only unless you save them to the recipe.
          </span>
          <button
            type="button" disabled={applyChanges.isPending}
            onClick={() => saveToRecipe(saveAllLines, savableExtras.map((e) => e.key))}
          >
            {applyChanges.isPending ? 'Saving…' : `💾 Save ${saveAllCount === 1 ? 'this change' : `all ${saveAllCount} changes`} to the recipe`}
          </button>
        </div>
      )}
      {recipeSaved && <p className="mgmt-status">{recipeSaved}</p>}
      {applyChanges.isError && (
        <p className="mgmt-status mgmt-status--error">
          Not saved to the recipe: {(applyChanges.error as { detail?: { message?: string } }).detail?.message ?? (applyChanges.error as Error).message}
        </p>
      )}

      <PantryCheck lines={bulk} />

      <div className="recipe-ingredients-actions">
        <button type="button" onClick={complete} disabled={completing}>
          {completing ? completingLabel : completeLabel}
        </button>
        {onSavePicks && (
          <>
            <button
              type="button"
              disabled={savingPicks}
              onClick={() => {
                setSaved(false)
                onSavePicks(buildPicks(), () => setSaved(true))
              }}
            >
              {savingPicks ? 'Saving…' : '💾 Save picks'}
            </button>
            {saved && <span className="mgmt-status">✅ Saved — shopping list updated</span>}
          </>
        )}
        {actions}
      </div>
      {onSavePicks && (
        <p className="mgmt-status">
          Save picks records what you'll cook for the shopping list without drawing any
          stock — Made it draws the stock and takes this off the plan.
        </p>
      )}

      {resultNote}
    </div>
  )
}

function seedFromPicks(picks: CookPick[] | null | undefined) {
  const picked: Record<number, boolean> = {}
  const swap: Record<number, number> = {}
  const qty: Record<number, number> = {}
  const extras: Extra[] = []
  for (const pick of picks ?? []) {
    if (pick.recipe_ingredient_id != null) {
      picked[pick.recipe_ingredient_id] = true
      if (pick.item_id != null) swap[pick.recipe_ingredient_id] = pick.item_id
      if (pick.quantity != null) qty[pick.recipe_ingredient_id] = pick.quantity
    } else if (pick.item_id != null) {
      extras.push({ key: Date.now() + Math.random(), itemId: pick.item_id, quantity: pick.quantity ?? 1 })
    }
  }
  return { picked, swap, qty, extras }
}

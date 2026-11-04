/**
 * Purpose: The recipe-ingredient review form - after "Parse ingredients", each
 *   line is matched to a catalog item, and any line the parser is NOT sure about
 *   is put to the reviewer (pick a suggestion, pick any food item, add a new
 *   item on the spot, or keep it reference-only) before the list can be saved.
 * Version: v4 (2026-09-23) - v4 (tracker #76): each line's item list is a FoodPick - type to search
 *   the whole catalog, "＋ Add … as a new food item" first (created inline), "reference only" as
 *   its none row - instead of a long plain select. The "+ Add '<name>' as a new item" chip stays
 *   (it prefills the parsed name). v3 (tracker #75): "＋ New item…" is the first choice in EVERY
 *   line's item list, whatever state the line is in. The "+ Add as a new item" chip only showed
 *   on undecided/suspect lines, so a confident-but-wrong match had no way to create the right
 *   item here - the owner backed out to the Warehouse, added it, and came back.
 *   v2 (2026-09-19)
 * Scope: PRODUCTION - mx-inv frontend, recipes feature.
 * Architecture: Rendered by RecipeIngredients.tsx (stage 2 of parse-review-cook).
 *   Was inline there through v4. Saves via mutations.useSaveRecipeIngredients;
 *   creates catalog items via warehouse/mutations useCreateItem + useUpdateItem
 *   (a Food item with its aisle category, stocking policy and an undecided
 *   provisioning mode, so it lands in the Galley "needs a decision" table).
 *   The matcher and its confidence (match_class) live in data.parse_recipe_ingredients.
 *   v2: the new-item form is the shared warehouse/NewFoodItemForm (also used at cook
 *   and cart time).
 */
import { useState } from 'react'
import type { RecipeIngredientCandidate } from '../../api/types'
import { useItems } from '../warehouse/useWarehouse'
import { NewFoodItemForm } from '../warehouse/NewFoodItemForm'
import { FoodPick } from '../warehouse/ItemPick'
import { useUnits } from '../../api/units'
import { UnitPicker } from '../../components/UnitPicker'
import { useSaveRecipeIngredients, type SavedIngredient } from './mutations'

// "ground nutmeg, sifted" -> "ground nutmeg": the name a new catalog item starts with.
const cleanName = (nameGuess: string): string => nameGuess.split(',')[0].trim()

interface ReviewRow {
  raw_text: string
  quantity: number | null
  unit: string | null
  /** Original metric amount when the parser converted it; display-only, never saved. */
  convertedFrom: string | null
  item_id: number | null
  is_bulk: boolean
  /** True once a decision about the catalog link has been made (a strong match, a
   *  pick, a new item, or a deliberate "reference only"). Save waits for all rows. */
  resolved: boolean
  /** A previously saved link that does not look like what the line names (advisory). */
  suspect: boolean
  excluded: boolean
  matches: RecipeIngredientCandidate['matches']
  nameGuess: string
  creating: boolean
  note: string | null
}

export function IngredientReview({
  recipeId, candidates, onDone,
}: { recipeId: number; candidates: RecipeIngredientCandidate[]; onDone: () => void }) {
  const saveIngredients = useSaveRecipeIngredients()
  // Full catalog: the parser's suggestions are only a few guesses, and the reviewer
  // must be able to pick ANY food item.
  const { data: allFoodItems } = useItems('food')
  const { data: units } = useUnits()
  const badUnit = (r: ReviewRow) =>
    !r.excluded && !!units && r.unit !== null && !units.some((u) => u.unit_key === r.unit)

  const [rows, setRows] = useState<ReviewRow[]>(() => candidates.map((c) => {
    const strong = c.match_class === 'strong' && c.matches.length > 0
    const excluded = !c.reviewed && c.likely_junk
    return {
      raw_text: c.raw_text,
      quantity: c.quantity,
      unit: c.unit ?? null,
      convertedFrom: c.converted_from ?? null,
      // A previously reviewed line keeps exactly what was saved (including a
      // deliberate "no catalog link"). An unreviewed line is preselected ONLY when
      // the parser is sure; otherwise it is left for the reviewer to decide.
      item_id: c.reviewed ? c.linked_item_id : (strong ? c.matches[0].item_id : null),
      is_bulk: c.reviewed ? (c.is_bulk ?? false) : (strong ? c.matches[0].is_bulk : false),
      resolved: c.reviewed || strong || excluded,
      suspect: c.reviewed && c.link_check === 'check',
      excluded,
      matches: c.matches,
      nameGuess: c.name_guess,
      creating: false,
      note: null,
    }
  }))

  const update = (i: number, patch: Partial<ReviewRow>) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)))

  const linkTo = (i: number, itemId: number | null, isBulk: boolean) =>
    update(i, { item_id: itemId, is_bulk: isBulk, resolved: true, suspect: false, creating: false, note: null })

  const unresolved = rows.filter((r) => !r.excluded && !r.resolved)
  const autoExcluded = candidates.filter((c) => !c.reviewed && c.likely_junk).length

  const save = () => {
    const ingredients: SavedIngredient[] = rows
      .filter((r) => !r.excluded)
      .map((r) => ({ raw_text: r.raw_text, item_id: r.item_id, quantity: r.quantity, unit: r.unit }))
    saveIngredients.mutate({ recipeId, ingredients }, { onSuccess: onDone })
  }

  return (
    <div className="recipe-ingredients-review">
      <p className="mgmt-status">
        Review each line. The parser only pre-selects a catalog item when it is sure; every
        other line is <strong>asked</strong> - pick a suggestion, pick any food item, add it as a
        new item, or keep it reference-only. Unticking a line drops it (headings and notes the
        parser picked up are unticked for you).
      </p>
      {autoExcluded > 0 && (
        <p className="mgmt-status">
          {autoExcluded} line{autoExcluded === 1 ? ' was' : 's were'} left unticked because
          {autoExcluded === 1 ? ' it looks' : ' they look'} like a heading or note (no amount, no
          clear catalog match) - tick any that are really ingredients.
        </p>
      )}
      {unresolved.length > 0 && (
        <p className="recipe-review-summary">
          ❓ {unresolved.length} of {rows.filter((r) => !r.excluded).length} lines still need your
          decision before the list can be saved.{' '}
          <button
            type="button" className="link-button"
            title="Keep the recipe text as it is, with no catalog item, for every undecided line"
            onClick={() => setRows((rs) => rs.map((r) => (
              !r.excluded && !r.resolved ? { ...r, resolved: true, item_id: null, is_bulk: false } : r
            )))}
          >
            Mark all {unresolved.length} as reference-only
          </button>
        </p>
      )}
      <ul className="recipe-review-list">
        {rows.map((r, i) => (
          <li
            key={i}
            className={[r.excluded ? 'excluded' : '', !r.excluded && !r.resolved ? 'needs-decision' : ''].join(' ').trim() || undefined}
          >
            <label className="recipe-review-exclude">
              <input
                type="checkbox" checked={!r.excluded}
                onChange={(e) => update(i, { excluded: !e.target.checked })}
              />
              <span className="recipe-review-raw">{r.raw_text}</span>
            </label>
            {!r.excluded && (
              <>
                <div className="recipe-review-fields">
                  <input
                    type="number" min={0} step="any" placeholder="qty"
                    value={r.quantity ?? ''}
                    onChange={(e) => update(i, { quantity: e.target.value === '' ? null : Number(e.target.value) })}
                  />
                  <UnitPicker
                    value={r.unit} allowEmpty emptyLabel="— no unit —"
                    onChange={(u) => update(i, { unit: u })}
                  />
                  {r.convertedFrom && (
                    <span className="recipe-review-converted" title="Edit the quantity or unit if the conversion looks off">
                      ≈ converted from {r.convertedFrom}
                    </span>
                  )}
                  {/* Tracker #75/#76: "＋ new" is always the first row, even on a line that already has an
                      item - a confident-but-wrong match used to leave no way to create the right item here. */}
                  <FoodPick
                    value={r.resolved ? r.item_id : null}
                    recipeUnit={r.unit}
                    noneLabel="— reference only (no catalog item) —"
                    placeholder={r.resolved ? '— reference only (no catalog item) —' : '— choose an item —'}
                    onPick={(p) => {
                      if (!p) { linkTo(i, null, false); return }
                      const suggested = r.matches.find((m) => m.item_id === p.itemId)
                      linkTo(i, p.itemId, suggested ? suggested.is_bulk : p.row?.stocking_policy === 'bulk')
                    }}
                  />
                  {r.resolved && r.item_id !== null
                    && (r.is_bulk || allFoodItems?.find((f) => f.item_id === r.item_id)?.stocking_policy === 'bulk') && (
                    <span
                      className="recipe-bulk-badge"
                      title="A bulk item: the recipe keeps its measure, but the shopping cart only asks whether you have any. Change this on the item (stocking policy)."
                    >
                      bulk item
                    </span>
                  )}
                </div>
                {r.suspect && (
                  <p className="recipe-review-suspect">
                    ⚠️ This saved link may be wrong - it does not look like what the line says. Check it below.
                  </p>
                )}
                {(!r.resolved || r.suspect) && !r.creating && (
                  <div className="recipe-review-ask">
                    <span>{r.suspect ? '🔧 Fix the link:' : '❓ Which item is this?'}</span>
                    {r.matches.filter((m) => m.item_id !== r.item_id).slice(0, 4).map((m) => (
                      <button
                        key={m.item_id} type="button" className="recipe-review-chip"
                        onClick={() => linkTo(i, m.item_id, m.is_bulk)}
                      >
                        Use “{m.item_name}”
                      </button>
                    ))}
                    <button
                      type="button" className="recipe-review-chip recipe-review-chip--new"
                      onClick={() => update(i, { creating: true })}
                    >
                      + Add “{cleanName(r.nameGuess)}” as a new item
                    </button>
                    <button
                      type="button" className="recipe-review-chip"
                      onClick={() => linkTo(i, null, false)}
                    >
                      Reference only
                    </button>
                  </div>
                )}
                {r.creating && (
                  <NewFoodItemForm
                    initialName={cleanName(r.nameGuess)}
                    recipeUnit={r.unit}
                    onCancel={() => update(i, { creating: false })}
                    onDone={(res) => {
                      linkTo(i, res.itemId, res.isBulk)
                      if (res.existingName) {
                        update(i, { note: `"${cleanName(r.nameGuess)}" already exists as "${res.existingName}" - linked to it instead.` })
                      }
                    }}
                  />
                )}
                {badUnit(r) && (
                  <p className="recipe-review-dup-notice">
                    ⚠️ "{r.unit}" isn't a known unit - pick one from the list (or add it with "＋ New unit…" at the top of the list).
                  </p>
                )}
                {r.note && <p className="recipe-review-dup-notice">ℹ️ {r.note}</p>}
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="recipe-ingredients-actions">
        <button
          type="button" onClick={save}
          disabled={
            saveIngredients.isPending
            || unresolved.length > 0 || rows.some((r) => r.creating || badUnit(r))
          }
          title={unresolved.length > 0 ? 'Decide the highlighted lines first' : undefined}
        >
          {saveIngredients.isPending ? 'Saving…' : '💾 Save ingredient list'}
        </button>
        <button type="button" onClick={onDone}>✕ Cancel</button>
        {rows.some((r) => r.creating) && (
          <span className="mgmt-status">Finish (✓ Create and use) or cancel (✕) the new item before saving.</span>
        )}
      </div>
    </div>
  )
}

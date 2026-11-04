import type { ItemTypeInfo, StockingPolicyInfo } from '../../api/types'

// Purely presentational - item_type/stocking_policy values and their
// label/description text come from the DB (GET /api/items/types|policies);
// this is just the emoji glyph per type_key, with a fallback for any type
// added later that isn't in this map yet.
const TYPE_EMOJI: Record<string, string> = {
  supply: '🧴',
  part: '⚙️',
  tool: '🔧',
  tool_accessory: '🪛',
  food: '🥫',
  gear: '🎒',
}

export function typeEmoji(typeKey: string): string {
  return TYPE_EMOJI[typeKey] ?? '📦'
}

export function typeLabel(types: ItemTypeInfo[] | undefined, typeKey: string): string {
  const label = types?.find((t) => t.type_key === typeKey)?.label ?? typeKey
  return `${typeEmoji(typeKey)} ${label}`
}

export function policyDescription(
  policies: StockingPolicyInfo[] | undefined,
  policyKey: string,
): string | undefined {
  return policies?.find((p) => p.policy_key === policyKey)?.description
}

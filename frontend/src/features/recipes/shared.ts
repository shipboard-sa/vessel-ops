// Matches recipes_tab.py exactly: a "reference only" recipe (no full text,
// just an index into a physical/Kindle cookbook) is stored as a body that
// starts with this prefix - _REF_PREFIX in the Streamlit app - so both UIs
// (this one and, until cutover, the still-live Streamlit app) agree on
// what counts as a reference-only entry.
export const REF_PREFIX = '📖 Reference only'

export function csv(text: string): string[] {
  return (text || '')
    .replace(/\n/g, ',')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

// Shared by ChecklistSteps and ProjectCard - both order their children via
// tasks.sort_order and both need the same "swap with a neighbor, then
// renumber to 1..N" behavior when the user clicks an up/down control.

export function moved<T>(items: T[], index: number, direction: 'up' | 'down'): T[] {
  const swapWith = direction === 'up' ? index - 1 : index + 1
  if (swapWith < 0 || swapWith >= items.length) return items
  const next = items.slice()
  ;[next[index], next[swapWith]] = [next[swapWith], next[index]]
  return next
}

// Returns only the {task_id, sort_order} pairs that actually need writing -
// items already at their target position (the common case for everything
// except the two that were swapped) are skipped.
export function reorderPatches(
  items: { task_id: number; sort_order: number | null }[],
): { task_id: number; sort_order: number }[] {
  return items
    .map((item, i) => ({ task_id: item.task_id, sort_order: i + 1 }))
    .filter((patch, i) => items[i].sort_order !== patch.sort_order)
}

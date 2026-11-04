// `new Date().toISOString().slice(0, 10)` gives the UTC calendar date, not
// the viewer's local one - found live: completing a task in the evening
// (US timezones, UTC already past midnight) recorded tomorrow's date.
// Every "completed on" default must use the local date instead.
export function todayLocal(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

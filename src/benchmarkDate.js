// A date shown to a person, such as "November 16, 2026". Worked out in the viewer's own time zone.
export function formatDate(iso, timeZone) {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', ...(timeZone ? { timeZone } : {}) })
}

// "Last changed November 16, 2026", or what to say when the date was not recorded.
export function lastChangedText(iso) {
  const date = iso ? formatDate(iso) : null
  return date ? `last changed ${date}` : 'last changed date not recorded yet'
}

// Turning a typed figure into a number, and a number back into what is shown in the box.
// People type 6.5 for 6.5%, so percentages are typed as percentages and stored as shares (0.065). Dollars may carry $ and commas,
// coverage may carry an "x". Anything that cannot be read becomes null, and the entry then says what is missing.

export function fromText(unit, text) {
  const raw = String(text ?? '').trim()
  if (raw === '') return null
  const cleaned = raw.replace(/[$,\s]/g, '').replace(/%$/, '').replace(/[x×]$/i, '')
  if (!/^\d*\.?\d+$|^\d+\.$/.test(cleaned)) return null
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  return unit === 'percent' ? Math.round((n / 100) * 1e9) / 1e9 : n
}

export function toText(unit, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  const shown = unit === 'percent' ? value * 100 : value
  return String(Math.round(shown * 1e6) / 1e6)
}

export const ADORNMENT = { dollars: '$', percent: '%', times: '×' }

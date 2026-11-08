// Small text helpers shared by the scenario screens.

// A lever's setting in words: "-10%", "+1.5%", "6 months".
export function leverText(def, value) {
  if (def.unit === 'months') return `${value} month${value === 1 ? '' : 's'}`
  const digits = def.step < 0.01 ? 2 : def.step < 0.1 ? 0 : 1
  const sign = value > 0 && def.id !== 'exitCapRate' ? '+' : ''
  return `${sign}${(value * 100).toFixed(def.id === 'exitCapRate' ? 2 : digits)}%`
}

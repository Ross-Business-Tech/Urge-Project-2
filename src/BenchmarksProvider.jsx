import { useMemo, useState, useCallback } from 'react'
import { toBenchmarkSets } from './modules/shared/index.js'
import { loadSaved, commitChange, browserStorage } from './benchmarksStore.js'
import { BenchmarksContext } from './useBenchmarks.js'

// Holds the team's benchmarks for the whole app, and keeps them on this device (see benchmarksStore.js), with the date they were
// last changed so an old set is easy to spot.
export function BenchmarksProvider({ children, storage = browserStorage(), now = () => new Date().toISOString() }) {
  const [saved] = useState(() => loadSaved(storage))
  const [entries, setEntries] = useState(saved.entries)
  const [changedAt, setChangedAt] = useState(saved.changedAt)
  const [kept, setKept] = useState(true)
  // `when` is given when a whole list is opened from a file, which carries its own date (null when it has none, shown as "not
  // recorded"). When it is left out, the change was made now.
  const replace = useCallback(
    (next, when) => {
      const list = typeof next === 'function' ? next(entries) : next
      const change = commitChange(storage, list, when, now)
      setEntries(list)
      setChangedAt(change.changedAt)
      setKept(change.kept)
    },
    [entries, storage, now],
  )
  const value = useMemo(() => ({ entries, sets: toBenchmarkSets(entries), changedAt, kept, replace, hasProvider: true }), [entries, changedAt, kept, replace])
  return <BenchmarksContext.Provider value={value}>{children}</BenchmarksContext.Provider>
}

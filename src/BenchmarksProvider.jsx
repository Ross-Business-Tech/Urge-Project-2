import { useMemo, useState, useCallback } from 'react'
import { toBenchmarkSets } from './modules/shared/index.js'
import { loadSaved, saveEntries, browserStorage } from './benchmarksStore.js'
import { BenchmarksContext } from './useBenchmarks.js'

// Holds the team's benchmarks for the whole app, and keeps them on this device (see benchmarksStore.js).
export function BenchmarksProvider({ children, storage = browserStorage() }) {
  const [entries, setEntries] = useState(() => loadSaved(storage))
  const [kept, setKept] = useState(true)
  const replace = useCallback(
    (next) => {
      const list = typeof next === 'function' ? next(entries) : next
      setEntries(list)
      setKept(saveEntries(storage, list))
    },
    [entries, storage],
  )
  const value = useMemo(() => ({ entries, sets: toBenchmarkSets(entries), kept, replace, hasProvider: true }), [entries, kept, replace])
  return <BenchmarksContext.Provider value={value}>{children}</BenchmarksContext.Provider>
}

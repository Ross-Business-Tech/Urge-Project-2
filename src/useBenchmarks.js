import { createContext, useContext, useMemo } from 'react'

// The team's own benchmarks, shared by every screen that compares a project with a range (see BenchmarksProvider.jsx).
// Outside the provider (the tests of the individual screens) `entries` is null, and the checks fall back to their own built-in sets.
export const BenchmarksContext = createContext({ entries: null, sets: undefined, kept: true, replace: () => {}, hasProvider: false })

export const useBenchmarks = () => useContext(BenchmarksContext)

// The two things every analysis needs: the entries (for the comparisons against single figures) and the sets built from them.
// Empty outside the provider, which keeps each module on its built-in sets.
export function useBenchmarkContext() {
  const { entries, sets } = useBenchmarks()
  return useMemo(() => (entries ? { benchmarks: entries, benchmarkSets: sets } : {}), [entries, sets])
}

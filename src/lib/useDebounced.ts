import { useEffect, useState } from 'react'

/** The value, once it has stopped changing for `ms` (a search box doesn't ask the backend on every key). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return settled
}

import { useEffect, useState } from 'react'

/** Keeps the last non-null value mounted for `ms` after it goes null, so exit animations can play. */
export function usePresence<T>(value: T | null, ms = 180): { item: T | null; leaving: boolean } {
  const [item, setItem] = useState<T | null>(value)

  useEffect(() => {
    if (value !== null) {
      setItem(value)
      return
    }
    const timer = setTimeout(() => setItem(null), ms)
    return () => clearTimeout(timer)
  }, [value, ms])

  return { item: value ?? item, leaving: value === null && item !== null }
}

import { createContext, useContext } from 'react'
import type { Store } from './store-types'

export const StoreContext = createContext<Store | null>(null)

export function useStore(): Store {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useStore outside provider')
  return store
}

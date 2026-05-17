import { createContext, useContext } from 'react'

export const ReloadContext = createContext({
  reloadKey: 0,
  reloading: false,
  triggerReload: () => {},
})

export const useReload = () => useContext(ReloadContext)

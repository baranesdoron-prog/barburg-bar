import { useCallback, useRef, useState } from 'react'

export interface InfoDialogState {
  title: string
  body: string
}

// A one-button notice popup (nothing to approve/decline, just
// acknowledge) -- e.g. "can't cancel this close to the shift, contact
// the bar manager." Same awaitable shape as useConfirmAssign so a
// caller can `await showInfo(...)` before doing anything else, even
// though there's only one outcome.
export function useInfoDialog() {
  const [infoState, setInfoState] = useState<InfoDialogState | null>(null)
  const resolverRef = useRef<(() => void) | null>(null)

  const showInfo = useCallback((details: InfoDialogState) => {
    return new Promise<void>((resolve) => {
      resolverRef.current = resolve
      setInfoState(details)
    })
  }, [])

  function handleClose() {
    resolverRef.current?.()
    resolverRef.current = null
    setInfoState(null)
  }

  return { showInfo, infoState, handleClose }
}

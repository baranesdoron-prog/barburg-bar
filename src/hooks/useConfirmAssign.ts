import { useCallback, useRef, useState } from 'react'

export interface ConfirmAssignState {
  dateLabel: string
  typeLabel: string
  hoursLabel: string
  positionLabel: string
}

// Turns a self-assign click into an awaitable yes/no gate: call
// confirmAssign(details) from an async handler, render <dialogState> via
// ConfirmAssignDialog, and the promise resolves once the person
// approves or declines the popup.
export function useConfirmAssign() {
  const [dialogState, setDialogState] = useState<ConfirmAssignState | null>(null)
  const resolverRef = useRef<((approved: boolean) => void) | null>(null)

  const confirmAssign = useCallback((details: ConfirmAssignState) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
      setDialogState(details)
    })
  }, [])

  function handleApprove() {
    resolverRef.current?.(true)
    resolverRef.current = null
    setDialogState(null)
  }

  function handleDecline() {
    resolverRef.current?.(false)
    resolverRef.current = null
    setDialogState(null)
  }

  return { confirmAssign, dialogState, handleApprove, handleDecline }
}

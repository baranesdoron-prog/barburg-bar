import { useCallback, useRef, useState } from 'react'

export interface ConfirmAssignState {
  title: string
  action: 'assign' | 'remove'
  dateLabel: string
  typeLabel: string
  hoursLabel: string
  positionLabel: string
}

// Turns a self-assign/self-remove click into an awaitable yes/no gate:
// call confirmAssign(details) from an async handler, render <dialogState>
// via ConfirmAssignDialog, and the promise resolves once the person
// approves or declines the popup. Shared by both flows -- only the
// title differs ("איזה כיף!" vs "איזה באסה! לא מסתדר?").
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

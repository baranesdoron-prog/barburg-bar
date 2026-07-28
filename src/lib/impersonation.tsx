import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

import type { AppRole } from '@/lib/types'

interface ImpersonationValue {
  realRole: AppRole
  effectiveRole: AppRole
  isPreviewing: boolean
  startPreview: (role: AppRole) => void
  stopPreview: () => void
}

const ImpersonationContext = createContext<ImpersonationValue | null>(null)

export function ImpersonationProvider({ realRole, children }: { realRole: AppRole; children: ReactNode }) {
  const [previewRole, setPreviewRole] = useState<AppRole | null>(null)

  const value = useMemo<ImpersonationValue>(
    () => ({
      realRole,
      effectiveRole: previewRole ?? realRole,
      isPreviewing: previewRole !== null,
      startPreview: (role) => {
        if (realRole === 'administrator') setPreviewRole(role)
      },
      stopPreview: () => setPreviewRole(null),
    }),
    [realRole, previewRole],
  )

  return <ImpersonationContext.Provider value={value}>{children}</ImpersonationContext.Provider>
}

export function useImpersonation() {
  const ctx = useContext(ImpersonationContext)
  if (!ctx) throw new Error('useImpersonation must be used within an ImpersonationProvider')
  return ctx
}

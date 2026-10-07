import { Button } from '@/components/ui/button'
import type { InfoDialogState } from '@/hooks/useInfoDialog'

export function InfoDialog({ state, onClose }: { state: InfoDialogState | null; onClose: () => void }) {
  if (!state) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background w-full max-w-sm rounded-lg border p-5 shadow-lg">
        <p className="text-lg font-semibold">{state.title}</p>
        <p className="text-muted-foreground mt-2 text-sm">{state.body}</p>
        <div className="mt-4">
          <Button className="w-full" onClick={onClose}>
            סגירה
          </Button>
        </div>
      </div>
    </div>
  )
}

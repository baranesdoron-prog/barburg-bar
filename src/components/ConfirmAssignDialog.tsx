import { Button } from '@/components/ui/button'

export function ConfirmAssignDialog({
  state,
  onApprove,
  onDecline,
}: {
  state: { dateLabel: string; positionLabel: string } | null
  onApprove: () => void
  onDecline: () => void
}) {
  if (!state) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background w-full max-w-sm rounded-lg border p-5 shadow-lg">
        <p className="text-lg font-semibold">איזה כיף!</p>
        <p className="text-muted-foreground mt-2 text-sm">
          את/ה משובץ/ת למשמרת {state.dateLabel} בתור {state.positionLabel}.
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onDecline}>
            ביטול
          </Button>
          <Button className="flex-1" onClick={onApprove}>
            אישור
          </Button>
        </div>
      </div>
    </div>
  )
}

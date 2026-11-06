import { SHEKELS_PER_TOKEN } from '@/lib/punchcards'

// The card as customers know it from the paper/punchcard.plus version: one
// Barburg token per 5 ₪, used tokens stamped "מומש", and a big green stamp
// once every token is used.
export function PunchcardView({
  amount,
  tokensTotal,
  tokensUsed,
  footer,
}: {
  amount: number
  tokensTotal: number
  tokensUsed: number
  footer?: React.ReactNode
}) {
  const fullyUsed = tokensUsed >= tokensTotal

  return (
    <div className="relative flex flex-col items-center gap-3 overflow-hidden rounded-2xl px-4 pt-4 pb-3" style={{ background: '#F4DDBB', color: '#2B1A02' }}>
      <div className="text-center">
        <div className="text-xl font-extrabold">
          {tokensTotal} ניקובים ב־{amount} ₪
        </div>
        <div className="text-sm font-bold">ניקוב = {SHEKELS_PER_TOKEN} ₪</div>
      </div>

      <div className="grid w-full grid-cols-5 gap-2">
        {Array.from({ length: tokensTotal }, (_, i) =>
          i < tokensUsed ? (
            <div
              key={i}
              className="flex aspect-square -rotate-12 items-center justify-center rounded-full text-[11px] font-extrabold"
              style={{ background: '#7A5230', color: '#F4DDBB' }}
              aria-label="מומש"
            >
              מומש
            </div>
          ) : (
            <img key={i} src="/logo.png" alt="" className="aspect-square w-full rounded-full object-cover" />
          ),
        )}
      </div>

      {footer}

      {fullyUsed && (
        <div
          className="pointer-events-none absolute top-1/2 left-1/2 flex h-36 w-60 -translate-x-1/2 -translate-y-1/2 -rotate-12 items-center justify-center rounded-full border-8"
          style={{ borderColor: '#2E9E2E' }}
        >
          <span className="px-3 py-2 text-center text-3xl leading-none font-extrabold text-white" style={{ background: '#2E9E2E' }}>
            מומשה במלואה
          </span>
        </div>
      )}
    </div>
  )
}

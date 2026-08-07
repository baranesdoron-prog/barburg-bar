import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const PROCEDURES_DOC_URL =
  'https://docs.google.com/document/d/1LKktHCOwZZQxhOJcQcPI792p9HIVfO_X_BIIMN457To/edit?tab=t.0#heading=h.ty20t9bogqq3'

export function Procedures() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-xl font-semibold">נהלים</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">מסמך הנהלים</CardTitle>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <a href={PROCEDURES_DOC_URL} target="_blank" rel="noreferrer">
              פתיחת מסמך הנהלים
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

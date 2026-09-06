import { useAppUserContext } from '@/lib/outletContext'
import { ROLES_VIEWING_SHIFTS } from '@/lib/roleLabels'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const PROCEDURES_DOC_URL = 'https://docs.google.com/document/d/19cRzgAZq7P-wgCyD-7c4HrbOhGm0zeBvRJLypba3Qkc/edit?tab=t.0'
const BAR_MANAGER_GUIDE_URL =
  'https://docs.google.com/document/d/1LKktHCOwZZQxhOJcQcPI792p9HIVfO_X_BIIMN457To/edit?tab=t.0#heading=h.ty20t9bogqq3'

export function Procedures() {
  const { effectiveRole } = useAppUserContext()
  const canViewBarManagerGuide = ROLES_VIEWING_SHIFTS.includes(effectiveRole)

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-xl font-semibold">נהלים</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">דף נהלים</CardTitle>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <a href={PROCEDURES_DOC_URL} target="_blank" rel="noreferrer">
              דף נהלים
            </a>
          </Button>
        </CardContent>
      </Card>

      {canViewBarManagerGuide && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">מדריך למנהל בר</CardTitle>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <a href={BAR_MANAGER_GUIDE_URL} target="_blank" rel="noreferrer">
                מדריך למנהל בר
              </a>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

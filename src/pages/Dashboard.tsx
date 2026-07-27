import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { roleLabels } from '@/lib/roleLabels'
import { useAppUserContext } from '@/lib/outletContext'

export function Dashboard() {
  const { appUser } = useAppUserContext()

  return (
    <Card className="mx-auto max-w-md text-center">
      <CardHeader>
        <CardTitle>לוח הבקרה בבנייה</CardTitle>
        <CardDescription>{roleLabels[appUser.role!]}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">
          תוכן לוח הבקרה יתווסף בהמשך, לפי תפקיד.
        </p>
      </CardContent>
    </Card>
  )
}

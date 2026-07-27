import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { AppUser } from '@/lib/types'

const roleLabels: Record<NonNullable<AppUser['role']>, string> = {
  administrator: 'מנהל/ת מערכת',
  bar_manager: 'מנהל/ת בר',
  shift_manager: 'אחראי/ת משמרת',
  employee: 'עובד/ת',
  viewer: 'צופה',
}

export function Approved({ appUser }: { appUser: AppUser }) {
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm text-center">
        <CardHeader>
          <CardTitle>אושרת בהצלחה</CardTitle>
          <CardDescription>
            {appUser.role ? roleLabels[appUser.role] : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            לוח הבקרה המלא בבנייה (עתידי).
          </p>
        </CardContent>
        <CardFooter className="justify-center">
          <Button variant="outline" onClick={() => supabase.auth.signOut()}>
            התנתקות
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}

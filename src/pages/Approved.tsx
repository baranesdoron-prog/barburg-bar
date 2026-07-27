import { Link } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { AppUser } from '@/lib/types'
import { roleLabels } from '@/lib/roleLabels'

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
        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">
            לוח הבקרה המלא בבנייה (עתידי).
          </p>
          {appUser.role === 'administrator' && (
            <Button asChild variant="secondary">
              <Link to="/admin/approvals">ניהול בקשות הצטרפות</Link>
            </Button>
          )}
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

import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

export function PendingApproval() {
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm text-center">
        <CardHeader>
          <CardTitle>ממתין/ה לאישור</CardTitle>
          <CardDescription>
            בקשתך נשלחה למנהל המערכת.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            תקבל/י הודעה כשהחשבון שלך יאושר.
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

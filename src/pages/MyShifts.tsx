import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function MyShifts() {
  return (
    <Card className="mx-auto max-w-md text-center">
      <CardHeader>
        <CardTitle>המשמרות שלי</CardTitle>
        <CardDescription>בקרוב</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">
          ניהול משמרות יתווסף בהמשך.
        </p>
      </CardContent>
    </Card>
  )
}

// Admin-only: creates (or resets) a demo customer account, so an
// administrator can log in as a customer and try the customer pages while
// they're not open to the public yet. Returns the login details once; the
// password is random and changes every time this runs.

import { json, serviceClient } from '../lib/whatsapp'

const DEMO_EMAIL = 'demo-customer@barburg.app'

function randomPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let db
  try {
    db = serviceClient()
  } catch {
    return json({ error: 'השרת לא מוגדר: חסר המשתנה SUPABASE_SERVICE_ROLE_KEY ב־Netlify.' }, 500)
  }

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Missing authorization' }, 401)
  const { data: userData, error: userError } = await db.auth.getUser(token)
  if (userError || !userData?.user) return json({ error: 'Invalid session' }, 401)
  const { data: caller } = await db.from('app_users').select('role, status').eq('id', userData.user.id).single()
  if (!caller || caller.status !== 'approved' || caller.role !== 'administrator') {
    return json({ error: 'לאדמינים בלבד' }, 403)
  }

  const password = randomPassword()

  // Find an existing demo user (first page is plenty for this small project).
  const { data: list, error: listError } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listError) return json({ error: listError.message }, 500)
  let userId = list.users.find((u) => u.email?.toLowerCase() === DEMO_EMAIL)?.id ?? null

  if (userId) {
    const { error } = await db.auth.admin.updateUserById(userId, { password, email_confirm: true })
    if (error) return json({ error: error.message }, 500)
  } else {
    const { data, error } = await db.auth.admin.createUser({
      email: DEMO_EMAIL,
      password,
      // No full_name on purpose: with one, the sign-up trigger would also
      // create an employee record and make the user a bartender.
      email_confirm: true,
    })
    if (error || !data.user) return json({ error: error?.message ?? 'Could not create the user' }, 500)
    userId = data.user.id
  }

  // The sign-up trigger creates the app_users row as pending; make it an
  // approved customer.
  const { error: roleError } = await db
    .from('app_users')
    .update({ role: 'customer', status: 'approved', approved_at: new Date().toISOString() })
    .eq('id', userId)
  if (roleError) return json({ error: roleError.message }, 500)

  return json({ email: DEMO_EMAIL, password })
}

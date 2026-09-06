import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return jsonResponse({ error: 'Missing authorization' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Verify the caller has a real session, using their own token (no
  // elevated privilege yet).
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: callerData, error: callerError } = await callerClient.auth.getUser()
  if (callerError || !callerData?.user) {
    return jsonResponse({ error: 'Invalid session' }, 401)
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  // The entire security boundary of this function: only a real,
  // approved administrator may reach the privileged call below.
  const { data: callerAppUser } = await adminClient
    .from('app_users')
    .select('role, status')
    .eq('id', callerData.user.id)
    .single()

  if (!callerAppUser || callerAppUser.status !== 'approved' || callerAppUser.role !== 'administrator') {
    return jsonResponse({ error: 'Only administrators can change passwords' }, 403)
  }

  let body: { user_id?: string; password?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400)
  }

  const { user_id, password } = body

  if (!user_id || !password) {
    return jsonResponse({ error: 'Missing or invalid fields' }, 400)
  }

  const { error: updateError } = await adminClient.auth.admin.updateUserById(user_id, { password })

  if (updateError) {
    return jsonResponse({ error: updateError.message }, 400)
  }

  return jsonResponse({ success: true }, 200)
})

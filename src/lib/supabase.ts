import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill them in.',
  )
}

// Passkeys (Face ID / fingerprint login) are still an experimental
// Supabase Auth feature, so the client has to opt in.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { experimental: { passkey: true } },
})

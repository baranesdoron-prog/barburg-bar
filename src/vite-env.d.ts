/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Set by vite.config.ts at build time.
declare const __BUILD_SHA__: string
declare const __BUILD_TIME__: string

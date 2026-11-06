import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Copy, Eye, ImagePlus, Trash2 } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { C } from '@/lib/designTokens'
import { useAppUserContext } from '@/lib/outletContext'
import { CustomerHome, NewsCard, isShowing, type NewsPost } from '@/pages/News'

const fieldClass = 'rounded-xl border px-3 text-base outline-none focus-visible:ring-2'

// Administrators (and later bar managers) publish what customers see on
// their home page: news, and highlights pinned above it.
export function AdminNews() {
  const [posts, setPosts] = useState<NewsPost[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.from('news_posts').select('*').order('created_at', { ascending: false })
    if (loadError) setError(loadError.message)
    setPosts((data as NewsPost[]) ?? [])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function remove(post: NewsPost) {
    if (!window.confirm('למחוק את ההודעה? היא תרד מדף הבית של הלקוחות.')) return
    const { error: deleteError } = await supabase.from('news_posts').delete().eq('id', post.id)
    if (deleteError) setError(deleteError.message)
    load()
  }

  return (
    <div dir="rtl" className="mx-auto flex max-w-md flex-col gap-5 pb-24" style={{ color: C.text }}>
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold">חדשות ודגשים ללקוחות</h1>
        <Link to="/news" className="text-sm font-semibold whitespace-nowrap" style={{ color: C.primary }}>
          איך זה נראה ללקוח
        </Link>
      </div>

      <Composer published={posts ?? []} onPublished={load} />

      {error && <p style={{ color: C.error }}>{error}</p>}

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-extrabold">מה מפורסם</h2>
        {posts?.length === 0 && (
          <p className="text-sm" style={{ color: C.textSecondary }}>
            עוד לא פורסם כלום.
          </p>
        )}
        {posts?.map((post) => (
          <div key={post.id} className="flex flex-col gap-2" style={{ opacity: isShowing(post) ? 1 : 0.55 }}>
            <NewsCard post={post} />
            <div className="flex items-center justify-between text-sm">
              <span style={{ color: C.textSecondary }}>{isShowing(post) ? 'מוצג ללקוחות' : 'עבר התאריך: לא מוצג'}</span>
              <button type="button" onClick={() => remove(post)} className="flex items-center gap-1 font-semibold" style={{ color: C.error }}>
                <Trash2 className="size-4" />
                מחיקה
              </button>
            </div>
          </div>
        ))}
      </section>

      <DemoCustomer />
    </div>
  )
}

function Composer({ published, onPublished }: { published: NewsPost[]; onPublished: () => void }) {
  const { appUser } = useAppUserContext()
  const [previewing, setPreviewing] = useState(false)
  const [authorName, setAuthorName] = useState<string | null>(null)
  const [balance, setBalance] = useState(0)
  const [kind, setKind] = useState<'news' | 'highlight'>('news')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [showUntil, setShowUntil] = useState('')
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.rpc('punchcard_balance').then(({ data }) => setBalance((data as number | null) ?? 0))
    if (!appUser.employee_id) return
    supabase
      .from('employees')
      .select('full_name')
      .eq('id', appUser.employee_id)
      .single()
      .then(({ data }) => setAuthorName((data as { full_name: string } | null)?.full_name ?? null))
  }, [appUser.employee_id])

  const hasContent = !!(title.trim() || body.trim() || imageUrl)

  // The draft as it would be stored, so the preview uses the real card.
  const draft: NewsPost = {
    id: 'draft',
    kind,
    title: title.trim() || null,
    body: body.trim() || null,
    image_url: imageUrl,
    show_until: showUntil || null,
    author_name: authorName,
    created_at: new Date().toISOString(),
  }

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError(null)
    const path = `${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, '_')}`
    const { error: uploadError } = await supabase.storage.from('news-images').upload(path, file)
    setUploading(false)
    if (uploadError) {
      setError(uploadError.message)
      return
    }
    setImageUrl(supabase.storage.from('news-images').getPublicUrl(path).data.publicUrl)
  }

  async function publish(e?: FormEvent) {
    e?.preventDefault()
    if (!hasContent) {
      setError('יש להוסיף כותרת, טקסט או תמונה')
      return
    }
    setSaving(true)
    setError(null)
    const { error: insertError } = await supabase.from('news_posts').insert({
      kind,
      title: title.trim() || null,
      body: body.trim() || null,
      image_url: imageUrl,
      show_until: showUntil || null,
    })
    setSaving(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    setTitle('')
    setBody('')
    setImageUrl(null)
    setShowUntil('')
    setPreviewing(false)
    onPublished()
  }

  return (
    <form onSubmit={publish} className="flex flex-col gap-3 rounded-2xl border p-4" style={{ borderColor: C.border, background: C.card }}>
      <div className="flex gap-1 rounded-full p-1" style={{ background: C.subtleBg }}>
        {(['news', 'highlight'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className="h-10 flex-1 rounded-full text-sm font-bold"
            style={kind === k ? { background: C.primary, color: '#fff' } : { color: C.textSecondary }}
          >
            {k === 'news' ? 'חדשה' : 'דגש (מוצמד למעלה)'}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="news-title" className="text-sm font-bold">
          כותרת
        </label>
        <input id="news-title" value={title} onChange={(e) => setTitle(e.target.value)} className={`${fieldClass} h-12`} style={{ borderColor: C.border }} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="news-body" className="text-sm font-bold">
          טקסט
        </label>
        <textarea id="news-body" value={body} onChange={(e) => setBody(e.target.value)} className={`${fieldClass} min-h-24 py-2`} style={{ borderColor: C.border }} />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-bold">תמונה או פלייר (לא חובה)</span>
        {imageUrl && <img src={imageUrl} alt="" className="w-full rounded-xl object-cover" />}
        <label
          className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed text-sm font-semibold"
          style={{ borderColor: C.border }}
        >
          <ImagePlus className="size-4" />
          {uploading ? 'מעלה…' : imageUrl ? 'החלפת תמונה' : 'בחירת תמונה'}
          <input type="file" accept="image/*" onChange={upload} disabled={uploading} className="sr-only" />
        </label>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="news-until" className="text-sm font-bold">
          מוצג עד (לא חובה)
        </label>
        <input
          id="news-until"
          type="date"
          value={showUntil}
          onChange={(e) => setShowUntil(e.target.value)}
          className={`${fieldClass} h-12`}
          style={{ borderColor: C.border }}
        />
        <span className="text-xs" style={{ color: C.textSecondary }}>
          אחרי התאריך ההודעה יורדת מדף הבית לבד. בלי תאריך היא נשארת עד שמוחקים.
        </span>
      </div>

      {error && <p className="text-sm" style={{ color: C.error }}>{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={!hasContent || uploading}
          onClick={() => {
            setError(null)
            setPreviewing(true)
          }}
          className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-xl border-2 text-base font-bold disabled:opacity-50"
          style={{ borderColor: C.primary, color: C.primary }}
        >
          <Eye className="size-4" />
          תצוגה מקדימה
        </button>
        <button
          type="submit"
          disabled={saving || uploading}
          className="h-12 flex-1 rounded-xl text-base font-bold text-white disabled:opacity-50"
          style={{ background: C.primary }}
        >
          פרסום
        </button>
      </div>

      {previewing && (
        <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: C.appBg }}>
          <div dir="rtl" className="sticky top-0 z-10 flex flex-col gap-2.5 px-4 py-3 text-white" style={{ background: C.text }}>
            <div className="flex items-center gap-2">
              <Eye className="size-4" style={{ color: C.accent }} />
              <span className="font-extrabold">תצוגה מקדימה: כך הלקוח יראה</span>
            </div>
            <span className="text-sm opacity-85">
              {isShowing(draft)
                ? 'עוד לא פורסם. המסומן במסגרת מקווקוות הוא הטיוטה שלך.'
                : 'שימו לב: תאריך "מוצג עד" כבר עבר, ולכן לקוחות לא יראו את ההודעה.'}
            </span>
            {error && <span className="text-sm" style={{ color: '#FFB4B4' }}>{error}</span>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPreviewing(false)}
                className="h-11 flex-1 rounded-lg border border-white/50 text-base font-bold"
              >
                חזרה לעריכה
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => publish()}
                className="h-11 flex-1 rounded-lg text-base font-extrabold disabled:opacity-50"
                style={{ background: C.accent, color: '#2B1A02' }}
              >
                פרסום
              </button>
            </div>
          </div>
          <div className="px-4 pt-5">
            <CustomerHome
              posts={[draft, ...published.filter(isShowing)]}
              balance={balance}
              draftId="draft"
              interactive={false}
            />
          </div>
        </div>
      )}
    </form>
  )
}

// Creates (or resets) the demo customer account, so the customer pages can
// be tried while they're not open to the public.
function DemoCustomer() {
  const { session } = useAppUserContext()
  const [login, setLogin] = useState<{ email: string; password: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/.netlify/functions/demo-customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: '{}',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) setError(data.error ?? `שגיאה (${res.status})`)
      else setLogin(data)
    } catch {
      setError('לא הצלחנו להגיע לשרת.')
    }
    setBusy(false)
  }

  return (
    <section className="flex flex-col gap-2 rounded-2xl border p-4" style={{ borderColor: C.border, background: C.card }}>
      <h2 className="text-base font-extrabold">חשבון לקוח לדוגמה</h2>
      <p className="text-sm" style={{ color: C.textSecondary }}>
        אזור הלקוחות עדיין סגור לציבור. כאן נוצר חשבון לקוח לבדיקה: מתנתקים, נכנסים איתו, ורואים בדיוק מה לקוח רואה. כל לחיצה יוצרת סיסמה חדשה.
      </p>
      {login && (
        <div className="flex flex-col gap-1 rounded-xl p-3 text-sm" style={{ background: C.primaryLight }}>
          <span>
            אימייל: <b dir="ltr">{login.email}</b>
          </span>
          <span className="flex items-center gap-2">
            סיסמה: <b dir="ltr">{login.password}</b>
            <button
              type="button"
              aria-label="העתקת הסיסמה"
              onClick={() => navigator.clipboard?.writeText(login.password)}
              className="rounded p-1"
            >
              <Copy className="size-4" />
            </button>
          </span>
          <span className="text-xs" style={{ color: C.textSecondary }}>
            הסיסמה מוצגת רק עכשיו.
          </span>
        </div>
      )}
      {error && <p className="text-sm" style={{ color: C.error }}>{error}</p>}
      <button type="button" disabled={busy} onClick={create} className="h-11 rounded-xl border text-sm font-bold disabled:opacity-50" style={{ borderColor: C.primary, color: C.primary }}>
        {login ? 'סיסמה חדשה' : 'יצירת חשבון לקוח לדוגמה'}
      </button>
    </section>
  )
}

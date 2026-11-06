import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { C } from '@/lib/designTokens'
import { useAppUserContext } from '@/lib/outletContext'
import { formatDate } from '@/lib/punchcards'

export interface NewsPost {
  id: string
  kind: 'news' | 'highlight'
  title: string | null
  body: string | null
  image_url: string | null
  show_until: string | null
  author_name: string | null
  created_at: string
}

function israelToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date())
}

export function isShowing(post: NewsPost) {
  return !post.show_until || post.show_until >= israelToday()
}

export function NewsCard({ post }: { post: NewsPost }) {
  const highlight = post.kind === 'highlight'
  return (
    <article
      className="flex flex-col overflow-hidden rounded-2xl border"
      style={highlight ? { borderColor: C.accent, background: C.card } : { borderColor: C.border, background: C.card }}
    >
      {post.image_url && <img src={post.image_url} alt={post.title ?? ''} className="w-full object-cover" />}
      {(post.title || post.body) && (
        <div className="flex flex-col gap-1.5 p-4">
          {highlight && (
            <span className="self-start rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: C.warningBg, color: '#7A4A0A' }}>
              דגש{post.show_until ? ` · עד ${formatDate(`${post.show_until}T12:00:00`)}` : ''}
            </span>
          )}
          {post.title && <h3 className="text-lg font-extrabold">{post.title}</h3>}
          {post.body && (
            <p className="text-base whitespace-pre-line" style={{ color: '#333D38' }}>
              {post.body}
            </p>
          )}
          <span className="text-xs" style={{ color: C.textSecondary }}>
            {[post.author_name, formatDate(post.created_at)].filter(Boolean).join(' · ')}
          </span>
        </div>
      )}
    </article>
  )
}

// The customers' home page: highlights first, then the news, with quick
// links to their punchcard and the menu.
export function News() {
  const { appUser } = useAppUserContext()
  const [posts, setPosts] = useState<NewsPost[] | null>(null)
  const [balance, setBalance] = useState<number | null>(null)

  useEffect(() => {
    Promise.all([
      supabase.from('news_posts').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.rpc('punchcard_balance'),
    ]).then(([postsRes, balanceRes]) => {
      setPosts(((postsRes.data as NewsPost[]) ?? []).filter(isShowing))
      setBalance((balanceRes.data as number | null) ?? 0)
    })
  }, [appUser.id])

  if (posts === null) return null

  const highlights = posts.filter((p) => p.kind === 'highlight')
  const news = posts.filter((p) => p.kind === 'news')

  return (
    <div dir="rtl" className="mx-auto flex max-w-md flex-col gap-4 pb-24" style={{ color: C.text }}>
      <div className="flex items-center gap-3">
        <img src="/logo.png" alt="ברבורג" className="size-12 rounded-full object-cover" />
        <h1 className="text-2xl font-extrabold">ברבורג</h1>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <Link to="/punchcards" className="flex flex-col gap-1 rounded-2xl p-3.5 text-white" style={{ background: C.primary }}>
          <span className="text-sm opacity-85">בכרטיסיות שלי</span>
          <span className="text-3xl leading-none font-extrabold">{balance ?? 0}</span>
          <span className="text-sm font-bold">{balance ? 'ניקובים · להזמנה' : 'לקניית כרטיסייה'}</span>
        </Link>
        <Link to="/menu" className="flex flex-col gap-1 rounded-2xl border p-3.5" style={{ borderColor: C.border, background: C.card }}>
          <span className="text-sm" style={{ color: C.textSecondary }}>
            מה שותים הערב?
          </span>
          <span className="text-xl font-extrabold">תפריט הבר</span>
          <span className="text-sm font-bold" style={{ color: C.primary }}>
            לצפייה
          </span>
        </Link>
      </div>

      {highlights.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-extrabold">דגשים</h2>
          {highlights.map((p) => (
            <NewsCard key={p.id} post={p} />
          ))}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-extrabold">חדשות</h2>
        {news.length === 0 && (
          <p className="text-sm" style={{ color: C.textSecondary }}>
            עוד אין עדכונים.
          </p>
        )}
        {news.map((p) => (
          <NewsCard key={p.id} post={p} />
        ))}
      </section>

    </div>
  )
}

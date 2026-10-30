// HTML for the shift emails, in the app's look (same colors as
// src/lib/designTokens.ts). Email clients only reliably support tables and
// inline styles -- no flexbox, no SVG (Gmail drops it), no web fonts --
// so the layout is nested tables and the duty avatars are PNGs served from
// the app's public/email/ folder.

export type Duty = 'bartender' | 'area_manager' | 'area_supervisor' | 'bar_manager'
export type EmailKind = 'assigned' | 'removed' | 'reminder'

export interface TeamMember {
  name: string
  role: Duty
  phone: string | null
}

export interface ShiftEmail {
  kind: EmailKind
  appUrl: string
  firstName: string
  role: Duty
  // "פתיחה" / "סגירה" when only one half of the evening is theirs.
  partLabel: string | null
  dateLabel: string // "יום חמישי, 12.11"
  hoursLabel: string // "19:30–00:30"
  actorName: string | null // the manager, when it wasn't the employee themselves
  team: TeamMember[]
  showAllPhones: boolean
  openTaskCount: number | null // bar manager's reminder only
  weekStart: string
  googleUrl: string | null
  outlookUrl: string | null
  icsFilename: string | null
}

const C = {
  primary: '#174D3B',
  primaryHover: '#23664F',
  primaryLight: '#E8F3EC',
  accent: '#E9A23B',
  accentLight: '#FFF3DF',
  appBg: '#FAF8F5',
  outerBg: '#EFEBE4',
  card: '#FFFFFF',
  subtleBg: '#F3F5F1',
  text: '#202A26',
  textSecondary: '#647067',
  textMuted: '#737D76',
  border: '#E5E8E2',
  warningText: '#8A5000',
  error: '#C83F3F',
  errorBg: '#FDECEC',
  errorText: '#8F2E2E',
}

export const DUTY_LABELS: Record<Duty, string> = {
  bartender: 'ברמן/ית',
  area_manager: 'אחראי/ת מתחם',
  area_supervisor: 'מנהל/ת מתחם',
  bar_manager: 'מנהל/ת בר',
}

const DUTY_PLURAL: Record<Duty, string> = {
  bartender: 'ברמנים/יות',
  area_manager: 'אחראי/ות מתחם',
  area_supervisor: 'מנהל/ת מתחם',
  bar_manager: 'מנהל/ת בר',
}

// Same as src/lib/dutyIcons.ts.
const DUTY_COLOR: Record<Duty, string> = {
  bar_manager: C.primary,
  bartender: C.accent,
  area_manager: '#3F8F6B',
  area_supervisor: '#2563EB',
}

const TEAM_ORDER: Duty[] = ['bar_manager', 'area_supervisor', 'bartender', 'area_manager']

const FONT = "Assistant, 'Segoe UI', Arial, sans-serif"

function esc(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function detailRow(label: string, value: string, opts: { last?: boolean; struck?: boolean; ltr?: boolean } = {}) {
  const border = opts.last ? '' : `border-bottom:1px solid ${C.border};`
  const valueStyle = opts.struck
    ? `color:${C.textSecondary};text-decoration:line-through;`
    : `color:${C.text};`
  return `<tr>
    <td style="padding:12px 14px;${border}font-size:14px;color:${C.textMuted};">${esc(label)}</td>
    <td style="padding:12px 14px;${border}font-size:14px;font-weight:700;text-align:left;${valueStyle}">${opts.ltr ? `<span dir="ltr">${esc(value)}</span>` : esc(value)}</td>
  </tr>`
}

function card(inner: string) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:${C.card};border:1px solid ${C.border};border-radius:18px;">${inner}</table>`
}

function sectionTitle(text: string) {
  return `<div style="font-size:14px;font-weight:700;color:${C.text};margin:0 0 8px;">${esc(text)}</div>`
}

function button(href: string, label: string, primary = true) {
  const style = primary
    ? `background:${C.primary};color:#ffffff;`
    : `background:${C.card};color:${C.text};border:1px solid ${C.border};`
  return `<a href="${esc(href)}" style="display:block;${style}text-decoration:none;text-align:center;font-weight:700;font-size:${primary ? 16 : 14}px;line-height:${primary ? 50 : 44}px;border-radius:${primary ? 16 : 14}px;">${esc(label)}</a>`
}

function teamSection(email: ShiftEmail) {
  if (email.team.length === 0) return ''
  const byRole = new Map<Duty, TeamMember[]>()
  for (const member of email.team) byRole.set(member.role, [...(byRole.get(member.role) ?? []), member])

  const rows: string[] = []
  for (const role of TEAM_ORDER) {
    const members = byRole.get(role)
    if (!members) continue
    // Phones: always the bar manager's (who to call); everyone's in the
    // reminder, so the evening's team can reach each other.
    const withPhones = email.showAllPhones || role === 'bar_manager'
    if (withPhones) {
      for (const m of members) rows.push(teamRow(role, esc(m.name), DUTY_LABELS[role], m.phone))
    } else {
      const names = members.map((m) => esc(m.name)).join(', ')
      rows.push(teamRow(role, names, members.length > 1 ? DUTY_PLURAL[role] : DUTY_LABELS[role], null))
    }
  }

  const body = rows
    .map((row, i) => row.replaceAll('{{border}}', i === rows.length - 1 ? '' : `border-bottom:1px solid ${C.border};`))
    .join('')
  const title = email.kind === 'reminder' && email.role === 'bar_manager' ? 'הצוות שלך' : 'מי עוד במשמרת'
  return `<tr><td style="padding:0 0 14px;">${sectionTitle(title)}${card(body)}</td></tr>`
}

function teamRow(role: Duty, namesHtml: string, roleLabel: string, phone: string | null) {
  const phoneCell = phone
    ? `<td style="padding:10px 14px;{{border}}font-size:13px;font-weight:600;text-align:left;white-space:nowrap;" dir="ltr"><a href="tel:${esc(phone)}" style="color:${C.primary};text-decoration:none;">${esc(phone)}</a></td>`
    : `<td style="padding:10px 14px;{{border}}"></td>`
  return `<tr>
    <td width="40" style="padding:10px 0 10px 0;padding-right:14px;{{border}}"><div style="width:26px;height:26px;border-radius:13px;background:${DUTY_COLOR[role]};"></div></td>
    <td style="padding:10px 8px;{{border}}font-size:14px;color:${C.text};"><b>${namesHtml}</b><br><span style="font-size:12px;color:${C.textMuted};">${esc(roleLabel)}</span></td>
    ${phoneCell}
  </tr>`
}

function calendarSection(email: ShiftEmail) {
  if (!email.googleUrl || !email.outlookUrl) return ''
  return `<tr><td style="padding:0 0 14px;">
    ${sectionTitle('הוספה ליומן')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="50%" style="padding-left:4px;">${button(email.googleUrl, 'Google Calendar', false)}</td>
      <td width="50%" style="padding-right:4px;">${button(email.outlookUrl, 'Outlook', false)}</td>
    </tr></table>
    ${
      email.icsFilename
        ? `<div style="margin-top:8px;padding:10px 12px;border-radius:14px;background:${C.subtleBg};font-size:13px;color:${C.textSecondary};">מצורף קובץ יומן לאייפון ול־Outlook: <b dir="ltr">${esc(email.icsFilename)}</b></div>`
        : ''
    }
  </td></tr>`
}

function hero(email: ShiftEmail) {
  const position = email.partLabel ? `${DUTY_LABELS[email.role]} (${email.partLabel})` : DUTY_LABELS[email.role]
  const avatarFile = email.kind === 'removed' ? `${email.role}-off.png` : `${email.role}.png`
  const avatar = `<img src="${esc(`${email.appUrl}/email/${avatarFile}`)}" width="92" height="92" alt="${esc(DUTY_LABELS[email.role])}" style="display:block;margin:0 auto;border:0;width:92px;height:92px;border-radius:46px;">`

  let bg = C.primaryLight
  let titleColor = C.primary
  let subColor = C.primaryHover
  let title = ''
  let sub = ''
  let tag = ''

  if (email.kind === 'assigned') {
    title = email.actorName ? `היי ${email.firstName}, שובצת למשמרת!` : `איזה כיף, ${email.firstName}!`
    sub = email.actorName
      ? `<b>${esc(email.actorName)}</b> שיבץ/ה אותך בתור <b>${esc(position)}</b>`
      : `שובצת למשמרת בתור <b>${esc(position)}</b>`
    if (email.actorName) {
      tag = `<div style="margin:0 auto 12px;display:inline-block;padding:5px 12px;border-radius:999px;background:${C.card};font-size:13px;font-weight:700;color:${C.primary};">שובצת ע״י מנהל/ת</div>`
    }
  } else if (email.kind === 'removed') {
    bg = C.subtleBg
    titleColor = C.text
    subColor = C.textSecondary
    title = 'הוסרת מהמשמרת'
    sub = email.actorName
      ? `<b>${esc(email.actorName)}</b> הסיר/ה אותך מהמשמרת בתור ${esc(position)}`
      : `חבל שלא מסתדר, ${esc(email.firstName)}. נתראה במשמרת אחרת!`
  } else {
    bg = C.accentLight
    titleColor = C.warningText
    subColor = C.warningText
    title = `מחר במשמרת, ${email.firstName}!`
    sub = `את/ה <b>${esc(position)}</b> מחר בערב · ${esc(email.hoursLabel.split('–')[0])}`
  }

  return `<tr><td align="center" style="background:${bg};padding:26px 18px 22px;text-align:center;">
    ${avatar}
    <div style="height:14px;line-height:14px;">&nbsp;</div>
    ${tag}
    <div style="font-size:24px;font-weight:800;color:${titleColor};">${esc(title)}</div>
    <div style="margin-top:4px;font-size:15px;color:${subColor};">${sub}</div>
  </td></tr>`
}

export function renderShiftEmail(email: ShiftEmail): { subject: string; html: string } {
  const removed = email.kind === 'removed'
  const position = email.partLabel ? `${DUTY_LABELS[email.role]} (${email.partLabel})` : DUTY_LABELS[email.role]

  const subject =
    email.kind === 'assigned'
      ? email.actorName
        ? `שובצת למשמרת ברבורג ע״י ${email.actorName} · ${email.dateLabel}`
        : `שובצת למשמרת ברבורג · ${email.dateLabel}`
      : email.kind === 'removed'
        ? `הוסרת ממשמרת ברבורג · ${email.dateLabel}`
        : `תזכורת: מחר במשמרת ברבורג · ${email.hoursLabel.split('–')[0]}`

  const details = card(
    detailRow('תאריך', email.kind === 'reminder' ? `מחר, ${email.dateLabel}` : email.dateLabel, { struck: removed }) +
      detailRow('שעות', email.hoursLabel, { struck: removed, ltr: true }) +
      detailRow('תפקיד', position, { struck: removed, last: removed }) +
      (removed ? '' : detailRow('מקום', 'ברבורג', { last: true })),
  )

  const tasks =
    email.openTaskCount !== null
      ? `<tr><td style="padding:0 0 14px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.primaryLight};border-radius:16px;"><tr>
          <td style="padding:12px 14px;font-size:14px;color:${C.primary};">${
            email.openTaskCount > 0 ? `נותרו <b>${email.openTaskCount} משימות</b> ברשימת השבוע` : 'כל משימות השבוע הושלמו'
          }</td>
          <td style="padding:12px 14px;text-align:left;"><a href="${esc(`${email.appUrl}/weekly-checklist?week=${email.weekStart}`)}" style="font-size:13px;font-weight:700;color:${C.primary};">לרשימה</a></td>
        </tr></table></td></tr>`
      : ''

  const removedNote = removed
    ? `<tr><td style="padding:0 0 14px;"><div style="padding:12px;border-radius:14px;background:${C.errorBg};font-size:13px;color:${C.errorText};">אם הוספת את המשמרת ליומן, הקובץ המצורף יסיר אותה (באייפון וב־Outlook). ב־Google Calendar יש למחוק ידנית.</div></td></tr>`
    : ''

  const cta = removed
    ? button(`${email.appUrl}/onboarding`, 'למשמרות פתוחות אחרות')
    : email.kind === 'reminder'
      ? button(`${email.appUrl}/shifts`, 'לפרטי המשמרת באפליקציה')
      : button(`${email.appUrl}/my-shifts`, 'למשמרות שלי באפליקציה')

  const footer =
    email.kind === 'assigned'
      ? email.actorName
        ? `לא מסתדר לך? כדאי לדבר עם ${esc(email.actorName)} בהקדם.`
        : 'לא מסתדר? אפשר לבטל באפליקציה עד סוף השבוע שלפני המשמרת. אחרי זה, יש לפנות למנהל/ת הבר.'
      : email.kind === 'reminder'
        ? 'משהו השתנה? עדכן/י את מנהל/ת הבר בהקדם.'
        : ''

  const html = `<!doctype html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.outerBg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.outerBg};" dir="rtl">
<tr><td align="center" style="padding:20px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl" style="max-width:480px;background:${C.appBg};border:1px solid ${C.border};border-radius:24px;overflow:hidden;font-family:${FONT};color:${C.text};text-align:right;">
  <tr><td align="center" style="background:${C.card};border-bottom:1px solid ${C.border};padding:14px;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="font-size:18px;font-weight:800;color:${C.text};padding-left:8px;">ברבורג</td>
      <td><img src="${esc(`${email.appUrl}/logo.png`)}" width="36" height="36" alt="" style="display:block;border:0;width:36px;height:36px;border-radius:18px;"></td>
    </tr></table>
  </td></tr>
  ${hero(email)}
  <tr><td style="padding:18px 16px 20px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 14px;">${details}</td></tr>
      ${removedNote}
      ${removed ? '' : teamSection(email)}
      ${tasks}
      ${email.kind === 'assigned' ? calendarSection(email) : ''}
      <tr><td style="padding:0 0 ${footer ? 14 : 0}px;">${cta}</td></tr>
      ${footer ? `<tr><td style="font-size:12px;line-height:1.6;color:${C.textMuted};text-align:center;">${footer}</td></tr>` : ''}
    </table>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`

  return { subject, html }
}

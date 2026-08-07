-- Shift manager's Sunday-through-Thursday weekly checklist.

create table weekly_checklist_items (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  sort_order int not null,
  title text not null,
  completed boolean not null default false,
  completed_by uuid references app_users(id),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index weekly_checklist_items_week_sort_idx on weekly_checklist_items (week_start, sort_order);

alter table weekly_checklist_items enable row level security;

create policy weekly_checklist_select_approved on weekly_checklist_items
  for select using (is_approved());

create policy weekly_checklist_update_managers on weekly_checklist_items
  for update
  using (current_app_role() in ('shift_manager', 'administrator'))
  with check (current_app_role() in ('shift_manager', 'administrator'));

-- Idempotent get-or-create for a given week, called when the page loads
-- (no cron needed for a 10-row template).
create function ensure_weekly_checklist(p_week_start date)
returns setof weekly_checklist_items
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from weekly_checklist_items where week_start = p_week_start) then
    insert into weekly_checklist_items (week_start, sort_order, title) values
      (p_week_start, 1, 'סקירת ספירת המלאי מהמשמרת הקודמת (בירות, יין, בקבוקי אלכוהול, משקאות קלים, אחר)'),
      (p_week_start, 2, 'זיהוי פריטים חסרים או מתחת לסף המינימום'),
      (p_week_start, 3, 'הכנת הזמנות רכש לכל ספק לפי הקטגוריות שלו'),
      (p_week_start, 4, 'וידוא שהמלאי הצפוי לאחר ההזמנות יספיק למשמרת חמישי הקרובה'),
      (p_week_start, 5, 'שליחת ההזמנות כך שיגיעו למכולת מפגשים (איתן ורדי) לאיסוף'),
      (p_week_start, 6, 'איסוף ההזמנות מהמכולת (איתן ורדי) וארגונן בבר — יום רביעי'),
      (p_week_start, 7, 'דיווח בקבוצת הוואטסאפ על פריט חסר מהספק או מהמלאי לקראת חמישי'),
      (p_week_start, 8, 'וידוא שיבוץ ברמנים למשמרת פתיחה (19:30–22:00) ולמשמרת סגירה (22:00–00:30); עדכון הצוות בוואטסאפ אם חסר כוח אדם'),
      (p_week_start, 9, 'סקירת פרוטוקול הפתיחה ווידוא: הבר נקי ומוכן, המקררים מלאים, מספיק קרח, כל הציוד במקום ופעיל, 2 עמדות טעינת טלפונים מוכנות'),
      (p_week_start, 10, 'בסגירה: הבר נקי מבפנים ובשני השולחנות בחוץ, כל הציוד הוחזר למקומו, בוצעו ספירת מלאי ובדיקת ציוד עבור אחראי המשמרת הבא');
  end if;

  return query select * from weekly_checklist_items where week_start = p_week_start order by sort_order;
end;
$$;

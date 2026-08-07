-- Give each checklist task a real due date within its week, so the
-- dashboard can flag late/upcoming tasks instead of just showing a flat list.

alter table weekly_checklist_items add column due_date date;

update weekly_checklist_items
set due_date = week_start + (case
  when sort_order <= 5 then 0
  when sort_order <= 8 then 3
  else 4
end);

alter table weekly_checklist_items alter column due_date set not null;

create or replace function ensure_weekly_checklist(p_week_start date)
returns setof weekly_checklist_items
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from weekly_checklist_items where week_start = p_week_start) then
    insert into weekly_checklist_items (week_start, sort_order, title, due_date) values
      (p_week_start, 1, 'סקירת ספירת המלאי מהמשמרת הקודמת (בירות, יין, בקבוקי אלכוהול, משקאות קלים, אחר)', p_week_start + 0),
      (p_week_start, 2, 'זיהוי פריטים חסרים או מתחת לסף המינימום', p_week_start + 0),
      (p_week_start, 3, 'הכנת הזמנות רכש לכל ספק לפי הקטגוריות שלו', p_week_start + 0),
      (p_week_start, 4, 'וידוא שהמלאי הצפוי לאחר ההזמנות יספיק למשמרת חמישי הקרובה', p_week_start + 0),
      (p_week_start, 5, 'שליחת ההזמנות כך שיגיעו למכולת מפגשים (איתן ורדי) לאיסוף', p_week_start + 0),
      (p_week_start, 6, 'איסוף ההזמנות מהמכולת (איתן ורדי) וארגונן בבר — יום רביעי', p_week_start + 3),
      (p_week_start, 7, 'דיווח בקבוצת הוואטסאפ על פריט חסר מהספק או מהמלאי לקראת חמישי', p_week_start + 3),
      (p_week_start, 8, 'וידוא שיבוץ ברמנים למשמרת פתיחה (19:30–22:00) ולמשמרת סגירה (22:00–00:30); עדכון הצוות בוואטסאפ אם חסר כוח אדם', p_week_start + 3),
      (p_week_start, 9, 'סקירת פרוטוקול הפתיחה ווידוא: הבר נקי ומוכן, המקררים מלאים, מספיק קרח, כל הציוד במקום ופעיל, 2 עמדות טעינת טלפונים מוכנות', p_week_start + 4),
      (p_week_start, 10, 'בסגירה: הבר נקי מבפנים ובשני השולחנות בחוץ, כל הציוד הוחזר למקומו, בוצעו ספירת מלאי ובדיקת ציוד עבור אחראי המשמרת הבא', p_week_start + 4);
  end if;

  return query select * from weekly_checklist_items where week_start = p_week_start order by sort_order;
end;
$$;

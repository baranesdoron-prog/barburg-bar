-- Spell out how to assign bartenders: open the opening and closing shifts
-- in the Shifts screen and assign there, not just "make sure it's done".

update weekly_checklist_items
set title = 'פתיחת משמרת הפתיחה (19:30–22:00) ומשמרת הסגירה (22:00–00:30) במסך המשמרות ושיבוץ ברמנים לכל אחת מהן; עדכון הצוות בוואטסאפ אם חסר כוח אדם'
where title = 'וידוא שיבוץ ברמנים למשמרת פתיחה (19:30–22:00) ולמשמרת סגירה (22:00–00:30); עדכון הצוות בוואטסאפ אם חסר כוח אדם';

create or replace function ensure_weekly_checklist(p_week_start date)
returns setof weekly_checklist_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_issues_item_id uuid;
  v_prev_week date := p_week_start - 7;
  v_prev_thu_start timestamptz := (v_prev_week + 4 + time '19:30') at time zone 'Asia/Jerusalem';
  v_prev_thu_mid   timestamptz := (v_prev_week + 4 + time '22:00') at time zone 'Asia/Jerusalem';
begin
  perform pg_advisory_xact_lock(hashtext(p_week_start::text));

  if not exists (select 1 from weekly_checklist_items where week_start = p_week_start) then
    insert into weekly_checklist_items (week_start, sort_order, title, due_date, is_optional)
    values (p_week_start, 1, 'סקירת ספירת המלאי מהמשמרת הקודמת (בירות, יין, בקבוקי אלכוהול, משקאות קלים, אחר)', p_week_start + 0, false);

    insert into weekly_checklist_items (week_start, sort_order, title, due_date, is_optional)
    values (p_week_start, 2, 'סקירת בעיות שדווחו במשמרת הקודמת', p_week_start + 0, false)
    returning id into v_issues_item_id;

    insert into weekly_checklist_items (week_start, sort_order, title, due_date, is_optional) values
      (p_week_start, 3, 'זיהוי פריטים חסרים או מתחת לסף המינימום', p_week_start + 0, false),
      (p_week_start, 4, 'הכנת הזמנות רכש לכל ספק לפי הקטגוריות שלו', p_week_start + 0, false),
      (p_week_start, 5, 'וידוא שהמלאי הצפוי לאחר ההזמנות יספיק למשמרת חמישי הקרובה', p_week_start + 0, false),
      (p_week_start, 6, 'שליחת ההזמנות כך שיגיעו למכולת מפגשים (איתן ורדי) לאיסוף', p_week_start + 0, false),
      (p_week_start, 7, 'איסוף ההזמנות מהמכולת (איתן ורדי) וארגונן בבר — יום רביעי', p_week_start + 3, false),
      (p_week_start, 8, 'דיווח בקבוצת הוואטסאפ על פריט חסר מהספק או מהמלאי לקראת חמישי', p_week_start + 3, true),
      (p_week_start, 9, 'פתיחת משמרת הפתיחה (19:30–22:00) ומשמרת הסגירה (22:00–00:30) במסך המשמרות ושיבוץ ברמנים לכל אחת מהן; עדכון הצוות בוואטסאפ אם חסר כוח אדם', p_week_start + 3, false),
      (p_week_start, 10, 'סקירת פרוטוקול הפתיחה ווידוא: הבר נקי ומוכן, המקררים מלאים, מספיק קרח, כל הציוד במקום ופעיל, 2 עמדות טעינת טלפונים מוכנות', p_week_start + 4, false),
      (p_week_start, 11, 'בסגירה: הבר נקי מבפנים ובשני השולחנות בחוץ, כל הציוד הוחזר למקומו, בוצעו ספירת מלאי ובדיקת ציוד עבור אחראי המשמרת הבא', p_week_start + 4, false);

    insert into weekly_checklist_subtasks (checklist_item_id, title, source_journal_entry_id)
    select
      v_issues_item_id,
      (case je.category when 'equipment_issue' then 'תקלת ציוד: ' else 'ציוד שבור: ' end) || je.description,
      je.id
    from journal_entries je
    join shifts s on s.id = je.shift_id
    where s.start_time in (v_prev_thu_start, v_prev_thu_mid)
      and je.category in ('equipment_issue', 'broken_equipment');
  end if;

  return query select * from weekly_checklist_items where week_start = p_week_start order by sort_order;
end;
$$;

-- Step-by-step drawings for bartenders: each menu item can carry its
-- preparation as data (glass, ice, then the pours in order), from which the
-- bar menu draws one glass per step. Staff-only, like staff_notes:
-- customer_menu() doesn't return it.
--
-- Shape: {"glass": "highball"|"lowball"|"wine"|"shot",
--         "ice": "none"|"three_quarters"|"full"|"on_request",
--         "pours": [{"ingredient": text, "amount": "half"|"one"|"two"|"top", "color": "#rrggbb"}]}

alter table menu_items add column prep_steps jsonb;

-- The cocktails, from the bartender procedures: highball, ice ¾ of the
-- glass, one measure of alcohol, mixer to the top (Aperol: its own recipe).
update menu_items i set prep_steps = v.steps::jsonb
from (values
  ('ערק לימונענע / אשכוליות', '{"glass":"highball","ice":"three_quarters","pours":[{"ingredient":"ערק","amount":"one","color":"#EEF1EA"},{"ingredient":"לימונענע / אשכוליות","amount":"top","color":"#E4EFB8"}]}'),
  ('ג׳ין & טוניק', '{"glass":"highball","ice":"three_quarters","pours":[{"ingredient":"ג׳ין","amount":"one","color":"#EEF4F2"},{"ingredient":"טוניק","amount":"top","color":"#DCEEE6"}]}'),
  ('אפרול שפריץ', '{"glass":"highball","ice":"three_quarters","pours":[{"ingredient":"אפרול","amount":"one","color":"#F26B1D"},{"ingredient":"קאווה","amount":"two","color":"#F3D98B"},{"ingredient":"סודה","amount":"top","color":"#DCEEE6"}]}'),
  ('קמפרי תפוזים', '{"glass":"highball","ice":"three_quarters","pours":[{"ingredient":"קמפרי","amount":"one","color":"#C8102E"},{"ingredient":"מיץ תפוזים","amount":"top","color":"#F9A13A"}]}'),
  ('רום / ויסקי קולה', '{"glass":"highball","ice":"three_quarters","pours":[{"ingredient":"רום או ויסקי","amount":"one","color":"#B8742A"},{"ingredient":"קולה","amount":"top","color":"#4A2616"}]}'),
  ('וודקה XL', '{"glass":"highball","ice":"three_quarters","pours":[{"ingredient":"וודקה","amount":"one","color":"#EEF4F2"},{"ingredient":"משקה אנרגיה","amount":"top","color":"#E6D45C"}]}')
) as v (name, steps)
where i.name = v.name and i.prep_steps is null;

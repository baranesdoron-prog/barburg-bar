-- One-time real-data correction: bartender/area_manager duty became a
-- whole-evening pairing this cycle (one pick creates a row for both the
-- opening and closing shift instance), but several real people booked
-- before that change only ever got one side inserted. Per explicit
-- confirmation, pair each of these to the full evening by inserting the
-- missing side's row -- same effect as using the app's own "unify"
-- action (re-selecting your own name from your row's edit menu).
--
-- NOT included: 2026-10-25's bartender duty already has 4 distinct real
-- people (לינדה דברת, אבשלום אביטל, יובל לייכט on opening; גלעד ברייט on
-- closing) against a max of 3 -- pairing all four would over-book that
-- shift, so this is intentionally left for a separate decision instead
-- of guessing who to pair.
--
-- on conflict guards against double-insertion if this is ever re-run;
-- shift_assignments has a unique (shift_id, employee_id) constraint.
insert into shift_assignments (shift_id, employee_id, assignment_role) values
  -- 2026-10-18 (Thu 22 Oct) bartender: Amit Artman, דנה ורדי -- opening
  -- only, add their closing row.
  ('8a21274e-2c5d-45ad-aac1-9c0f706a6af1', '754ee4af-f0a3-4777-9a22-bd564d35c892', 'bartender'),
  ('8a21274e-2c5d-45ad-aac1-9c0f706a6af1', 'b1255878-377a-405d-bb48-17fe29e5075e', 'bartender'),
  -- 2026-10-25 area_manager: עופר יערי -- opening only, add closing.
  ('9b0ab0ce-1f75-4496-9805-7291b02e7c78', '062b6072-3874-4612-869e-ab0b1456830f', 'area_manager'),
  -- 2026-11-01 area_manager: נועה מגל, איל מגל -- opening only, add closing.
  ('091eb08c-0a2e-47df-aad6-5641417aa375', '0d713de8-fdf7-4aaf-b8c2-b3e88c26f7fe', 'area_manager'),
  ('091eb08c-0a2e-47df-aad6-5641417aa375', '79cc278e-0410-4344-a579-9c7b05d425f1', 'area_manager'),
  -- 2026-11-01 bartender: לינדה דברת -- opening only, add closing.
  ('091eb08c-0a2e-47df-aad6-5641417aa375', '9a4628b6-13cf-442b-8d90-e00be33ff716', 'bartender'),
  -- 2026-11-22 bartender: עופר יערי opening only (add closing), עידן
  -- טוביאנה closing only (add opening).
  ('13de3b16-dbea-4f8d-8be9-e163c4e82741', '062b6072-3874-4612-869e-ab0b1456830f', 'bartender'),
  ('8d62e939-e2e3-4f62-98b8-479fbbdde106', 'dcb7dc0d-0f6d-49c0-b460-8f1c77d03094', 'bartender')
on conflict (shift_id, employee_id) do nothing;

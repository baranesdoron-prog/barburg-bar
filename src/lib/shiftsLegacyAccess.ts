// Hand-picked rollback access list for the old /shifts-legacy page -- not a
// role or a DB-backed permission, just two named app_users.id values (not
// employee_id -- this gates the PAGE, independent of who's linked to which
// employee). The redesigned page is now the real /shifts; this keeps the
// previous implementation reachable only to these two administrators as a
// break-glass fallback if something's wrong with the new one.
export const SHIFTS_LEGACY_ACCESS_USER_IDS: string[] = [
  '21fe4736-9577-44b6-95b6-81c7d2f8d887', // דורון ברנס
  '0f3f2464-0488-4483-8547-b08afd8f9c68', // רועי עילם
]

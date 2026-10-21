// Temporary, hand-picked access list for the /shifts-preview redesign
// evaluation -- not a role or a DB-backed permission, just two named
// app_users.id values (not employee_id -- this gates the PAGE, independent
// of who's linked to which employee). Remove this file and its two call
// sites (App.tsx's route guard, navigation.ts's nav item) once the preview
// is either rolled out for real or dropped.
export const SHIFTS_PREVIEW_ALLOWED_USER_IDS: string[] = [
  '21fe4736-9577-44b6-95b6-81c7d2f8d887', // דורון ברנס
  '0f3f2464-0488-4483-8547-b08afd8f9c68', // רועי עילם
]

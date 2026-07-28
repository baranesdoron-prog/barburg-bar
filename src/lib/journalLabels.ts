import type { JournalCategory } from '@/lib/types'

export const journalCategoryLabels: Record<JournalCategory, string> = {
  equipment_issue: 'תקלת ציוד',
  broken_equipment: 'ציוד שבור',
  items_missing: 'פריטים חסרים במשמרת',
  special_event: 'אירוע מיוחד',
  improvement_suggestion: 'הצעה לשיפור',
  positive_feedback: 'משוב חיובי',
  general_note: 'הערה כללית',
}

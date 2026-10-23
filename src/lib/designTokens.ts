// Shared color tokens for the redesigned mobile-first pages (currently
// /shifts and /reports). Kept as plain hex values rather than Tailwind
// classes/CSS variables since these pages lean on inline styles for
// precise control (see ShiftsPreview.tsx's RTL-logical-class note).
export const C = {
  primary: '#174D3B',
  primaryHover: '#23664F',
  primaryLight: '#E8F3EC',
  accent: '#E9A23B',
  accentLight: '#FFF3DF',
  appBg: '#FAF8F5',
  card: '#FFFFFF',
  subtleBg: '#F3F5F1',
  text: '#202A26',
  textSecondary: '#647067',
  textMuted: '#737D76',
  border: '#E5E8E2',
  success: '#16835D',
  successBg: '#E6F6ED',
  warning: '#B76A00',
  warningBg: '#FFF2DB',
  error: '#C83F3F',
  errorBg: '#FDECEC',
  info: '#2563EB',
  infoBg: '#EAF2FF',
}

// Icon-tile colors for product categories, cycled by the category's
// position -- shared so a category keeps the same color on the inventory
// items list and the categories page.
export const CATEGORY_COLORS = [C.primary, C.accent, '#4E8B6A', C.info]

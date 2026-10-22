/**
 * Arrow-key movement for the booking plan radiogroup.
 *
 * The page is RTL. In a right-to-left group, Left is "next" and Right is
 * "previous" (WAI-ARIA radio pattern). Up is always previous and Down is
 * always next, so the same keys work when the cards stack vertically on a
 * phone. Returns null for every other key, which the button handles itself
 * (Enter, Space, Tab).
 */
const NEXT_LTR = ['ArrowRight', 'ArrowDown'];
const PREV_LTR = ['ArrowLeft', 'ArrowUp'];
const NEXT_RTL = ['ArrowLeft', 'ArrowDown'];
const PREV_RTL = ['ArrowRight', 'ArrowUp'];

export function planRadioMove(index: number, key: string, rtl: boolean, count: number): number | null {
  if (count <= 0) return null;
  const next = rtl ? NEXT_RTL : NEXT_LTR;
  const prev = rtl ? PREV_RTL : PREV_LTR;
  const delta = next.includes(key) ? 1 : prev.includes(key) ? -1 : 0;
  if (delta === 0) return null;
  const i = ((index % count) + count) % count;
  return (i + delta + count) % count;
}

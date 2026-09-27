/**
 * The ids a payments action should actually submit.
 *
 * The dashboard keeps one selection across every expanded student panel, so
 * the raw selection can span two children. A button sits under one child's
 * table and promises to act on that child — this is what keeps that promise.
 * Without it, ticking Yuval's charges and then pressing "paid" under Noa
 * marks Yuval's too: money changed without intent.
 */
export function idsForPanel(
  selected: Iterable<number>,
  panelCharges: { id: number }[],
): number[] {
  const inPanel = new Set(panelCharges.map(c => c.id));
  return [...selected].filter(id => inPanel.has(id));
}

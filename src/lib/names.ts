/** The name a child is called by: the first word of the name on file.
 *  «היי נוגה כהן!» is how a form letter greets someone, not a tutor. */
export function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? '';
}

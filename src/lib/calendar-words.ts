/**
 * What a calendar-read failure means, for the tutor. The server classifies
 * the error (classifyReadError in $lib/server/calendar.ts) into a short code
 * that never carries the secret feed URL; this turns the code into what
 * happened and, where there is one, what to do.
 */
export function readIssueWords(reason: string): string {
  if (reason === 'timeout') return 'היומן לא ענה בזמן';
  if (reason === 'parse error') return 'היומן הגיע בפורמט לא צפוי';
  const http = /^HTTP (\d{3})$/.exec(reason);
  if (http) {
    const status = Number(http[1]);
    if (status === 401 || status === 403) return 'אין הרשאה לקרוא את היומן — אולי הקישור הסודי שלו הוחלף';
    if (status === 404) return 'היומן לא נמצא — אולי הקישור הסודי שלו הוחלף';
    return `שרת היומן החזיר שגיאה (${status})`;
  }
  return reason;
}

/** Where bug reports and game requests go. */
export const CONTACT_EMAIL = 'contact@lamplight.cards';

/** Tips that keep Lamplight free and ad-free. */
export const SUPPORT_URL = 'https://ko-fi.com/lamplightcards';

const mailto = (subject: string, body: string) => `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

/**
 * A bug report, with what helps to reproduce it filled in (the sender sees it all before sending):
 * the game and table, and the device's screen and browser.
 */
export function bugReportLink(where?: { game?: string; table?: string }): string {
  const about = [
    where?.game && `Game: ${where.game}`,
    where?.table && `Table: ${where.table}`,
    typeof window !== 'undefined' && `Screen: ${window.innerWidth}×${window.innerHeight}`,
    typeof navigator !== 'undefined' && `Browser: ${navigator.userAgent}`,
  ].filter(Boolean);
  return mailto(`Lamplight bug${where?.game ? `: ${where.game}` : ''}`, `What happened?\n\n\nWhat did you expect?\n\n\n---\n${about.join('\n')}\n`);
}

export const gameRequestLink = () => mailto('Lamplight game request', 'Which game would you like to play?\n\n\nAny house rules we should know?\n\n');

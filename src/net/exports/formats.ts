import type { GameConfig } from '../../engine/types';

/**
 * The files a game can be saved as. Every game (but real-time ones) has the spreadsheet; some have
 * their game's own standard record too, which other programs read:
 * - PBN, Portable Bridge Notation: Contract Bridge (bridge programs, BBO's hand viewer).
 * - OHH, Open Hand History: Hold'em and Omaha (poker tracking tools). Its streets are Hold'em's,
 *   so stud and draw poker don't fit it.
 * Decided from the game file alone, so the table's menu knows without loading any rules.
 */
export type ExportFormat = 'csv' | 'pbn' | 'ohh';

export const EXPORT_LABEL: Record<ExportFormat, string> = {
  csv: 'Save this game (spreadsheet)',
  pbn: 'Save as PBN (bridge programs)',
  ohh: 'Save as hand history (poker tools)',
};

export const EXPORT_FILE: Record<ExportFormat, { ext: string; type: string }> = {
  csv: { ext: 'csv', type: 'text/csv;charset=utf-8' },
  pbn: { ext: 'pbn', type: 'text/plain;charset=iso-8859-1' },
  ohh: { ext: 'ohh', type: 'application/json;charset=utf-8' },
};

/** The standard records (beyond the spreadsheet) this game can be saved as. */
export function recordFormats(config: GameConfig): ExportFormat[] {
  const r = config.rules;
  if (r?.family === 'trick-taking' && r.bidding?.type === 'bridge') return ['pbn'];
  if (r?.family === 'poker' && !r.draw && !r.stud) return ['ohh'];
  return [];
}

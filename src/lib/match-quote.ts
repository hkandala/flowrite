/**
 * Text quote matching adapted from the Hypothesis client.
 * Original: https://github.com/hypothesis/client/blob/main/src/annotator/anchoring/match-quote.ts
 * License: BSD-2-Clause (Hypothesis) + MIT (approx-string-match)
 *
 * Uses the W3C Web Annotation TextQuoteSelector format (exact + prefix + suffix)
 * to find and re-anchor text in a document, with fuzzy matching support.
 */

import approxSearch from "approx-string-match";
import type { Match as StringMatch } from "approx-string-match";

export type TextQuoteSelector = {
  exact: string;
  prefix?: string;
  suffix?: string;
};

export type MatchResult = {
  start: number;
  end: number;
  score: number;
};

/**
 * Find approximate matches for `str` in `text` allowing up to `maxErrors`.
 * Fast-paths exact matches via indexOf before falling back to approx search.
 */
function search(text: string, str: string, maxErrors: number): StringMatch[] {
  // Fast path: exact matches via indexOf
  let matchPos = 0;
  const exactMatches: StringMatch[] = [];
  while (matchPos !== -1) {
    matchPos = text.indexOf(str, matchPos);
    if (matchPos !== -1) {
      exactMatches.push({
        start: matchPos,
        end: matchPos + str.length,
        errors: 0,
      });
      matchPos += 1;
    }
  }
  if (exactMatches.length > 0) return exactMatches;

  // Fallback: approximate search
  return approxSearch(text, str, maxErrors);
}

/**
 * Compute a similarity score (0..1) between `text` and `str`.
 */
function textMatchScore(text: string, str: string): number {
  if (str.length === 0 || text.length === 0) return 0.0;
  const matches = search(text, str, str.length);
  if (matches.length === 0) return 0.0;
  return 1 - matches[0].errors / str.length;
}

/**
 * Find the best approximate match for `quote` in `text`.
 *
 * @param text - Full document text to search
 * @param quote - The exact text to find
 * @param context - Optional prefix/suffix for disambiguation, hint for position
 * @returns Best match with { start, end, score } or null if no acceptable match
 */
export function matchQuote(
  text: string,
  quote: string,
  context: { prefix?: string; suffix?: string; hint?: number } = {},
): MatchResult | null {
  if (quote.length === 0) return null;

  const maxErrors = Math.min(256, Math.floor(quote.length / 2));
  const matches = search(text, quote, maxErrors);
  if (matches.length === 0) return null;

  const scored = matches.map((m) => {
    const quoteWeight = 50;
    const prefixWeight = 20;
    const suffixWeight = 20;
    const posWeight = 2;

    const quoteScore = 1 - m.errors / quote.length;

    const prefixScore = context.prefix
      ? textMatchScore(
          text.slice(Math.max(0, m.start - context.prefix.length), m.start),
          context.prefix,
        )
      : 1.0;

    const suffixScore = context.suffix
      ? textMatchScore(
          text.slice(m.end, m.end + context.suffix.length),
          context.suffix,
        )
      : 1.0;

    let posScore = 1.0;
    if (typeof context.hint === "number") {
      posScore = 1.0 - Math.abs(m.start - context.hint) / text.length;
    }

    const rawScore =
      quoteWeight * quoteScore +
      prefixWeight * prefixScore +
      suffixWeight * suffixScore +
      posWeight * posScore;
    const maxScore = quoteWeight + prefixWeight + suffixWeight + posWeight;

    return { start: m.start, end: m.end, score: rawScore / maxScore };
  });

  scored.sort((a, b) => b.score - a.score);

  if (scored[0].score < 0.5) return null;

  return scored[0];
}

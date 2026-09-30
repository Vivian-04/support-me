/**
 * WCAG 2.x contrast helpers for validating creator profile themes (#227).
 * Mirrored in frontend/lib/theme.ts, which runs the same checks for live
 * feedback in the theme editor — this copy is the one that is enforced.
 */

/** Minimum contrast ratio for normal-size text under WCAG AA. */
export const WCAG_AA_TEXT = 4.5;

/** Relative luminance of a `#rrggbb` color, per the WCAG definition. */
export function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two `#rrggbb` colors, from 1 (none) to 21. */
export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

import type { CSSProperties } from 'react';

/**
 * Creator profile themes (#227). A creator picks a background, an accent,
 * a font and a layout; the public profile applies them as CSS variables on
 * its root element. A null theme means the default design, unchanged —
 * including following the visitor's light/dark preference.
 */

export type ThemeFont = 'default' | 'serif' | 'mono' | 'system';
export type ThemeLayout = 'default' | 'compact' | 'centered';

export interface ProfileTheme {
  backgroundColor: string;
  accentColor: string;
  font: ThemeFont;
  layout: ThemeLayout;
}

// Matches the light palette in app/globals.css.
export const DEFAULT_THEME: ProfileTheme = {
  backgroundColor: '#fdfcf7',
  accentColor: '#7c3aed',
  font: 'default',
  layout: 'default',
};

// Only fonts the app already loads (Geist Mono) or every OS ships, so a
// theme never adds a web-font download to the profile page.
export const THEME_FONTS: Record<ThemeFont, { label: string; stack: string | null }> = {
  default: { label: 'Default', stack: null },
  serif: { label: 'Serif', stack: 'Georgia, Cambria, "Times New Roman", serif' },
  mono: { label: 'Monospace', stack: 'var(--font-geist-mono), ui-monospace, monospace' },
  system: { label: 'System', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
};

// Class names for the profile's outer (page) and inner (column) wrappers.
export const THEME_LAYOUTS: Record<ThemeLayout, { label: string; page: string; column: string }> = {
  default: { label: 'Default', page: 'py-10', column: 'space-y-6' },
  compact: { label: 'Compact', page: 'py-4', column: 'space-y-3' },
  centered: { label: 'Centered', page: 'py-10 flex flex-col justify-center', column: 'w-full space-y-6' },
};

// The design system's two palettes (app/globals.css :root and .dark). A
// custom theme pins the profile to whichever reads better on its background,
// so text, cards and borders stay legible regardless of the visitor's mode.
const LIGHT_PALETTE = {
  '--foreground': '#0a0a0a',
  '--ink': '#0a0a0a',
  '--card': '#ffffff',
  '--muted': '#57534e',
  '--accent-bg': '#ede9fe',
  '--input-bg': '#ffffff',
  '--shadow-color': '#0a0a0a',
};
const DARK_PALETTE = {
  '--foreground': '#f4f2ec',
  '--ink': '#f4f2ec',
  '--card': '#211e1b',
  '--muted': '#a8a29e',
  '--accent-bg': '#2b2440',
  '--input-bg': '#161412',
  '--shadow-color': '#000000',
};
const BUTTON_TEXT_COLOR = '#ffffff';

/** Minimum contrast ratio for normal-size text under WCAG AA. */
export const WCAG_AA_TEXT = 4.5;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const isHexColor = (value: string): boolean => HEX_COLOR.test(value);

/** Relative luminance of a `#rrggbb` color, per the WCAG definition. */
function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two `#rrggbb` colors, from 1 (none) to 21. */
export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

function paletteFor(backgroundColor: string) {
  return contrastRatio(backgroundColor, LIGHT_PALETTE['--ink']) >=
    contrastRatio(backgroundColor, DARK_PALETTE['--ink'])
    ? LIGHT_PALETTE
    : DARK_PALETTE;
}

/**
 * WCAG AA problems with a theme, as user-facing messages; empty when it
 * passes. Mirrors the checks the backend enforces on save
 * (backend/src/schemas/creators.ts).
 */
export function themeContrastIssues(theme: ProfileTheme): string[] {
  const issues: string[] = [];
  if (!isHexColor(theme.backgroundColor) || !isHexColor(theme.accentColor)) {
    return ['Colors must be hex values like #7c3aed.'];
  }
  const textRatio = contrastRatio(theme.backgroundColor, paletteFor(theme.backgroundColor)['--ink']);
  if (textRatio < WCAG_AA_TEXT) {
    issues.push(`Text on this background has ${textRatio.toFixed(2)}:1 contrast; WCAG AA needs ${WCAG_AA_TEXT}:1.`);
  }
  const buttonRatio = contrastRatio(theme.accentColor, BUTTON_TEXT_COLOR);
  if (buttonRatio < WCAG_AA_TEXT) {
    issues.push(`Button text on this accent has ${buttonRatio.toFixed(2)}:1 contrast; WCAG AA needs ${WCAG_AA_TEXT}:1.`);
  }
  return issues;
}

export const sameTheme = (a: ProfileTheme, b: ProfileTheme): boolean =>
  a.backgroundColor.toLowerCase() === b.backgroundColor.toLowerCase() &&
  a.accentColor.toLowerCase() === b.accentColor.toLowerCase() &&
  a.font === b.font &&
  a.layout === b.layout;

export const isDefaultTheme = (theme: ProfileTheme): boolean => sameTheme(theme, DEFAULT_THEME);

/** Inline style that applies a theme to an element and everything inside it. */
export function themeStyle(theme: ProfileTheme): CSSProperties {
  const font = THEME_FONTS[theme.font].stack;
  return {
    ...paletteFor(theme.backgroundColor),
    '--background': theme.backgroundColor,
    '--primary': theme.accentColor,
    // Headings read --font-display (app/globals.css); body text inherits.
    ...(font ? { '--font-display': font, fontFamily: font } : {}),
  } as CSSProperties;
}

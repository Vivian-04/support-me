import { describe, it, expect } from 'vitest';
import {
  DEFAULT_THEME,
  contrastRatio,
  isDefaultTheme,
  themeContrastIssues,
  themeStyle,
  type ProfileTheme,
} from '@/lib/theme';

const theme = (overrides: Partial<ProfileTheme> = {}): ProfileTheme => ({ ...DEFAULT_THEME, ...overrides });
const vars = (t: ProfileTheme) => themeStyle(t) as Record<string, string>;

describe('contrastRatio', () => {
  it('spans 1 (identical colors) to 21 (black on white)', () => {
    expect(contrastRatio('#7c3aed', '#7c3aed')).toBe(1);
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
  });
});

describe('themeContrastIssues', () => {
  it('passes the default theme, which matches the current design', () => {
    expect(themeContrastIssues(DEFAULT_THEME)).toEqual([]);
  });

  it('passes a dark background, since text switches to the light ink', () => {
    expect(themeContrastIssues(theme({ backgroundColor: '#101820' }))).toEqual([]);
  });

  it('flags a background too mid-toned for either text color', () => {
    const issues = themeContrastIssues(theme({ backgroundColor: '#777777' }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^Text on this background/);
  });

  it('flags an accent too light for white button text', () => {
    const issues = themeContrastIssues(theme({ accentColor: '#ffd84d' }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^Button text on this accent/);
  });

  it('rejects colors that are not 6-digit hex values', () => {
    expect(themeContrastIssues(theme({ accentColor: 'purple' }))).toEqual([
      'Colors must be hex values like #7c3aed.',
    ]);
  });
});

describe('isDefaultTheme', () => {
  it('matches the defaults regardless of hex letter case', () => {
    expect(isDefaultTheme(theme({ accentColor: '#7C3AED' }))).toBe(true);
    expect(isDefaultTheme(theme({ layout: 'compact' }))).toBe(false);
  });
});

describe('themeStyle', () => {
  it('sets the background and accent variables', () => {
    const style = vars(theme({ backgroundColor: '#fff4e6', accentColor: '#b42318' }));
    expect(style['--background']).toBe('#fff4e6');
    expect(style['--primary']).toBe('#b42318');
  });

  it('uses the dark palette on a dark background and the light one on a light background', () => {
    expect(vars(theme({ backgroundColor: '#101820' }))['--ink']).toBe('#f4f2ec');
    expect(vars(theme({ backgroundColor: '#fff4e6' }))['--ink']).toBe('#0a0a0a');
  });

  it('only overrides fonts for a non-default choice', () => {
    expect(themeStyle(DEFAULT_THEME)).not.toHaveProperty('fontFamily');
    const style = vars(theme({ font: 'serif' }));
    expect(style.fontFamily).toMatch(/serif$/);
    expect(style['--font-display']).toBe(style.fontFamily);
  });
});

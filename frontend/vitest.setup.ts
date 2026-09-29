import '@testing-library/jest-dom/vitest';
import { vi, afterEach } from 'vitest';

afterEach(() => {
  if (typeof document !== 'undefined') {
    document.cookie = 'supportme_locale=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  }
  if (typeof localStorage !== 'undefined' && typeof localStorage.clear === 'function') {
    try {
      localStorage.clear();
    } catch {
      // ignore
    }
  }
});

vi.mock('@/lib/wallet', () => ({
  connectWallet: vi.fn(),
  disconnectWallet: vi.fn(),
  signMessage: vi.fn(),
  initWallet: vi.fn(),
}));

vi.mock('next/font/google', () => ({
  Geist: () => ({ variable: '--font-geist-sans' }),
  Geist_Mono: () => ({ variable: '--font-geist-mono' }),
  Space_Grotesk: () => ({ variable: '--font-display' }),
}));

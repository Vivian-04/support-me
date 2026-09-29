import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AppHubPage from '@/app/app/page';
import { useAuth } from '@/context/AuthContext';
import { useCreator } from '@/context/CreatorContext';

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/components/AppNav', () => ({
  AppNav: () => <nav data-testid="app-nav" />,
}));

vi.mock('@/context/CreatorContext', () => ({
  useCreator: vi.fn(),
}));

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>();
  return {
    ...actual,
    Horizon: {
      ...actual.Horizon,
      Server: class MockServer {
        loadAccount = vi.fn().mockResolvedValue({
          balances: [{ asset_type: 'native', balance: '100' }],
        });
      },
    },
  };
});

const mockUseAuth = vi.mocked(useAuth);
const mockUseCreator = vi.mocked(useCreator);

describe('AppHubPage', () => {
  const creator = {
    id: 1,
    userId: 42,
    username: 'alice',
    displayName: 'Alice',
    walletAddress: 'GALICE',
    avatarUrl: null,
    donationGoal: null,
    acceptsXlm: true,
    acceptsUsdc: true,
    acceptsUsdt: false,
    socialLinks: null,
    presetAmounts: [],
  };

  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: { id: 42, walletAddress: 'GALICE' },
      token: 'mock-jwt-token',
      loading: false,
      loginWithWallet: vi.fn(),
      logout: vi.fn(),
    });

    mockUseCreator.mockReturnValue({
      creator,
      loading: false,
      invalidate: vi.fn(),
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/creators/me')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => creator,
          });
        }
        if (url.includes('/api/prices')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ prices: { XLM: 0.12 } }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({}),
        });
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders profile link and opens ShareModal when Share button is tapped', async () => {
    render(<AppHubPage />);

    await waitFor(() => {
      expect(screen.getByText('Hey, Alice 👋')).toBeInTheDocument();
      expect(screen.getByText(/\/alice$/)).toBeInTheDocument();
    });

    // Share modal is not open yet
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Click the Share button
    const shareBtn = screen.getByRole('button', { name: 'Share profile' });
    fireEvent.click(shareBtn);

    // Share modal opens with choices
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Share Profile')).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /both/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /copy link/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /qr code/i })).toBeInTheDocument();
    });

    // Close the modal
    const closeBtn = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(closeBtn);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

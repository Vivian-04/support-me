import { Suspense } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreatorProfileClient from '@/app/[username]/CreatorProfileClient';
import { useAuth } from '@/context/AuthContext';
import { connectWallet } from '@/lib/wallet';

// CreatorProfileClient unwraps the `params` prop with React's use(), which
// suspends on an unresolved promise — App Router provides a Suspense
// boundary in production, so tests need to provide one too. The initial
// render has to be wrapped in `act` (and awaited) for React to actually
// flush past the suspended commit once the (already-resolved) promise
// settles — otherwise React Testing Library never sees the real content.
async function renderProfile(username: string) {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <CreatorProfileClient params={Promise.resolve({ username })} />
      </Suspense>
    );
  });
}

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

// The installed @hugeicons/core-free-icons (4.3.5) has no `TwitterLogoIcon`
// export, so the component would render `icon={undefined}` and every test in
// this file threw "currentIcon is not iterable". Stub just that export here.
vi.mock('@hugeicons/core-free-icons', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@hugeicons/core-free-icons');
  return { ...actual, TwitterLogoIcon: actual.TwitterLogoIcon ?? actual.LinkIcon };
});

vi.mock('@/lib/wallet', () => ({
  connectWallet: vi.fn(),
  disconnectWallet: vi.fn(),
}));

vi.mock('@/lib/notify', () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// The `@hugeicons/core-free-icons` version currently pinned in package-lock.json
// doesn't export `TwitterLogoIcon` (it's `undefined`), which crashes
// `HugeiconsIcon` on every render that reaches the Share button — pre-existing
// and unrelated to this change (reproduces identically against the unmodified
// component on upstream/main). Stub the icon renderer so these tests can
// exercise the component's actual logic instead of that unrelated bug.
vi.mock('@hugeicons/react', () => ({
  HugeiconsIcon: () => null,
}));

// lib/assets.js's ASSETS registry is gated on NEXT_PUBLIC_USDC_ISSUER /
// NEXT_PUBLIC_USDT_ISSUER at module-load time (see lib/__tests__/assets.test.ts
// for that logic in isolation). Here we only care about how
// CreatorProfileClient consumes availableAssetCodes()/getAsset() against
// creator.acceptsXlm/Usdc/Usdt, so stub a deployment where all three are
// configured and let the component's own gating do the filtering.
vi.mock('@/lib/assets', () => ({
  availableAssetCodes: () => ['XLM', 'USDC', 'USDT'],
  getAsset: (code: string) => ({
    code,
    label: code,
    balanceMatcher: () => false,
  }),
}));

// Avoids a real Horizon network call from loadAssetBalance() whenever a
// wallet "connects" in these tests.
vi.mock('@stellar/stellar-sdk', async () => {
  const actual = await vi.importActual<typeof import('@stellar/stellar-sdk')>('@stellar/stellar-sdk');
  return {
    ...actual,
    Horizon: {
      Server: class {
        async loadAccount() {
          return { balances: [] };
        }
      },
    },
  };
});

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners: Record<string, Array<(event: MessageEvent) => void>> = {};

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, cb: (event: MessageEvent) => void) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(cb);
  }

  removeEventListener() {}

  close() {
    this.closed = true;
  }
}

// Some Node versions ship a native `localStorage` global that jsdom's own
// implementation doesn't fully take over in this test environment (its
// getItem/setItem/clear come back `undefined`), so the language-switcher
// tests below stub in a minimal in-memory Storage instead of relying on
// `window.localStorage` directly. lib/i18n.ts itself already guards every
// real-world localStorage call in a try/catch for the same reason.
class FakeLocalStorage {
  private store = new Map<string, string>();

  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }
}

const mockUseAuth = vi.mocked(useAuth);
const mockConnectWallet = vi.mocked(connectWallet);

const baseCreator = {
  id: 1,
  username: 'alice',
  displayName: 'Alice',
  walletAddress: 'GALICEXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  bio: null,
  avatarUrl: null,
  socialLinks: null,
  acceptsXlm: true,
  acceptsUsdc: true,
  acceptsUsdt: false,
  donationGoal: null,
};

const goal = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 1,
  title: 'New microphone',
  targetAmount: 500,
  currentAmount: 120,
  currency: 'XLM',
  status: 'ACTIVE',
  recurring: false,
  ...overrides,
});

function mockFetchSequence(handlers: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      for (const [pattern, body] of Object.entries(handlers)) {
        if (url.includes(pattern)) {
          return {
            ok: true,
            json: async () => body,
          } as Response;
        }
      }
      return { ok: false, json: async () => ({}) } as Response;
    })
  );
}

describe('CreatorProfileClient', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: null,
      token: null,
      loading: false,
      loginWithWallet: vi.fn(),
      logout: vi.fn(),
    });
    vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
    FakeEventSource.instances = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders a progress bar for every active goal, using server-computed totals', async () => {
    mockFetchSequence({
      '/api/creators/alice': baseCreator,
      '/api/goals/alice': {
        items: [
          goal({ id: 1, title: 'New microphone', targetAmount: 500, currentAmount: 120, currency: 'XLM' }),
          goal({ id: 2, title: 'Monthly support', targetAmount: 2000, currentAmount: 0, currency: 'XLM', recurring: true }),
        ],
      },
    });

    await renderProfile('alice');

    await waitFor(() => expect(screen.getByText('New microphone')).toBeInTheDocument());
    expect(screen.getByText('120 / 500 XLM')).toBeInTheDocument();

    expect(screen.getByText('Monthly support')).toBeInTheDocument();
    expect(screen.getByText('0 / 2000 XLM')).toBeInTheDocument();
    expect(screen.getByText('Recurring')).toBeInTheDocument();

    // Two independent progressbars, not one summed/blended total.
    expect(screen.getAllByRole('progressbar')).toHaveLength(2);
  });

  it('renders no goal section when the creator has no active goals', async () => {
    mockFetchSequence({
      '/api/creators/alice': baseCreator,
      '/api/goals/alice': { items: [] },
    });

    await renderProfile('alice');

    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('offers USDT in the asset selector once the wallet is connected, when the creator accepts it', async () => {
    mockFetchSequence({
      '/api/creators/alice': { ...baseCreator, acceptsUsdt: true },
      '/api/goals/alice': { items: [] },
    });
    mockConnectWallet.mockResolvedValue('GDONORXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');

    await renderProfile('alice');
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /connect wallet/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'USDT' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'XLM' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'USDC' })).toBeInTheDocument();
  });

  it('does not offer USDT when the creator has not opted in, even if configured on this deployment', async () => {
    mockFetchSequence({
      '/api/creators/alice': { ...baseCreator, acceptsUsdt: false },
      '/api/goals/alice': { items: [] },
    });
    mockConnectWallet.mockResolvedValue('GDONORXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');

    await renderProfile('alice');
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /connect wallet/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'XLM' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'USDT' })).not.toBeInTheDocument();
  });

  // Issue #120: quick-select preset amount buttons on the donate page.
  it('falls back to default preset amounts when the creator has not configured any', async () => {
    mockFetchSequence({
      '/api/creators/alice': { ...baseCreator, presetAmounts: [] },
      '/api/goals/alice': { items: [] },
    });
    mockConnectWallet.mockResolvedValue('GDONORXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');

    await renderProfile('alice');
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /connect wallet/i }));

    for (const preset of ['1', '5', '10', '20']) {
      expect(screen.getByRole('button', { name: preset })).toBeInTheDocument();
    }
  });

  it("shows the creator's custom preset amounts instead of the defaults", async () => {
    mockFetchSequence({
      '/api/creators/alice': { ...baseCreator, presetAmounts: [2, 15, 50] },
      '/api/goals/alice': { items: [] },
    });
    mockConnectWallet.mockResolvedValue('GDONORXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');

    await renderProfile('alice');
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /connect wallet/i }));

    for (const preset of ['2', '15', '50']) {
      expect(screen.getByRole('button', { name: preset })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: '20' })).not.toBeInTheDocument();
  });

  it('clicking a preset amount populates the donation amount input', async () => {
    mockFetchSequence({
      '/api/creators/alice': { ...baseCreator, presetAmounts: [2, 15, 50] },
      '/api/goals/alice': { items: [] },
    });
    mockConnectWallet.mockResolvedValue('GDONORXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');

    await renderProfile('alice');
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /connect wallet/i }));

    await userEvent.click(screen.getByRole('button', { name: '15' }));

    expect(screen.getByLabelText(/amount/i)).toHaveValue(15);
  });

  describe('language switcher', () => {
    let fakeLocalStorage: FakeLocalStorage;

    beforeEach(() => {
      fakeLocalStorage = new FakeLocalStorage();
      vi.stubGlobal('localStorage', fakeLocalStorage);
    });

    it('renders donate/profile strings in English by default', async () => {
      mockFetchSequence({
        '/api/creators/alice': baseCreator,
        '/api/goals/alice': { items: [] },
      });

      await renderProfile('alice');

      await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
      expect(screen.getByRole('button', { name: /connect wallet/i })).toBeInTheDocument();
      expect(screen.getByText(/support alice/i)).toBeInTheDocument();
    });

    it('switches the donate/profile strings to Spanish when a different language is picked', async () => {
      mockFetchSequence({
        '/api/creators/alice': baseCreator,
        '/api/goals/alice': { items: [] },
      });

      await renderProfile('alice');
      await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

      const select = screen.getByRole('combobox', { name: /language/i });
      await userEvent.selectOptions(select, 'es');

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /conectar billetera/i })).toBeInTheDocument()
      );
      expect(screen.getByText(/apoya a alice/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /connect wallet/i })).not.toBeInTheDocument();

      // The choice is persisted so it survives a remount (e.g. navigating away and back).
      expect(fakeLocalStorage.getItem('supportme-locale')).toBe('es');
    });

    it('restores a previously-picked language on the next render', async () => {
      fakeLocalStorage.setItem('supportme-locale', 'es');
      mockFetchSequence({
        '/api/creators/alice': baseCreator,
        '/api/goals/alice': { items: [] },
      });

      await renderProfile('alice');

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /conectar billetera/i })).toBeInTheDocument()
      );
    });
  });

  describe('live updates (SSE) lifecycle', () => {
    const goalsCalls = () =>
      vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/api/goals/alice')).length;

    const setHidden = (hidden: boolean) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      document.dispatchEvent(new Event('visibilitychange'));
    };

    afterEach(() => {
      setHidden(false);
    });

    beforeEach(() => {
      mockFetchSequence({
        '/api/creators/alice': baseCreator,
        '/api/goals/alice': { items: [goal()] },
      });
    });

    it('shows a paused indicator when the stream errors and backfills goals once it reconnects', async () => {
      await renderProfile('alice');
      await waitFor(() => expect(screen.getByText('New microphone')).toBeInTheDocument());
      const source = FakeEventSource.instances[0];
      act(() => source.onopen?.());
      expect(screen.queryByText(/live updates paused/i)).not.toBeInTheDocument();
      const before = goalsCalls();

      act(() => source.onerror?.());
      expect(screen.getByRole('status')).toHaveTextContent(/live updates paused/i);
      // Nothing is refetched while the connection is still down.
      expect(goalsCalls()).toBe(before);

      act(() => source.onopen?.());
      expect(screen.queryByText(/live updates paused/i)).not.toBeInTheDocument();
      await waitFor(() => expect(goalsCalls()).toBe(before + 1));
    });

    it('does not refetch on the first successful connection', async () => {
      await renderProfile('alice');
      await waitFor(() => expect(screen.getByText('New microphone')).toBeInTheDocument());
      const before = goalsCalls();

      act(() => FakeEventSource.instances[0].onopen?.());

      expect(goalsCalls()).toBe(before);
    });

    it('closes the stream while the tab is hidden and reopens it with a backfill when visible again', async () => {
      await renderProfile('alice');
      await waitFor(() => expect(screen.getByText('New microphone')).toBeInTheDocument());
      const first = FakeEventSource.instances[0];
      const before = goalsCalls();

      act(() => setHidden(true));
      expect(first.closed).toBe(true);
      expect(FakeEventSource.instances).toHaveLength(1);

      act(() => setHidden(false));
      expect(FakeEventSource.instances).toHaveLength(2);

      act(() => FakeEventSource.instances[1].onopen?.());
      await waitFor(() => expect(goalsCalls()).toBe(before + 1));

    });
  });
});

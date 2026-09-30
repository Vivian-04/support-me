import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { forwardRef } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QrCodeCard } from '@/components/QrCodeCard';
import { notify } from '@/lib/notify';

vi.mock('@/lib/notify', () => ({
  notify: { error: vi.fn(), success: vi.fn() },
}));

// `toBlobMock` is read both inside the vi.mock factory below and from test
// bodies, so it must go through vi.hoisted: the factory itself is hoisted
// above every other declaration in this file, including a plain `const`.
const { toBlobMock } = vi.hoisted(() => ({ toBlobMock: vi.fn() }));

// jsdom has no real <canvas> implementation, so QRCodeCanvas is stubbed to a
// plain element carrying a `toBlob` the download handler can call. QRCodeSVG
// is stubbed to a real <svg> (with the id the SVG-download handler looks up
// by `document.getElementById`), so the DOM-serialization path is exercised
// against real markup rather than a mock. QrCodeCard passes `ref` as a real
// object ref (not a callback), so the stub must itself be `forwardRef`
// wrapped: a plain function component silently drops an object `ref` passed
// as a prop rather than attaching it, since React never forwards `ref` to a
// non-forwardRef function component. Defined inline in the factory (rather
// than as an outer `const`) so it never needs to survive the same hoisting
// the `require()`-based alternative works around less cleanly.
vi.mock('qrcode.react', () => {
  const MockQRCodeCanvas = forwardRef<HTMLCanvasElement>((_props, ref) => (
    <canvas
      ref={(el) => {
        if (el) (el as unknown as { toBlob: typeof toBlobMock }).toBlob = toBlobMock;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}
      data-testid="qr-canvas"
    />
  ));
  MockQRCodeCanvas.displayName = 'MockQRCodeCanvas';

  return {
    QRCodeCanvas: MockQRCodeCanvas,
    QRCodeSVG: ({ id, value, role, 'aria-label': ariaLabel }: Record<string, string>) => (
      <svg id={id} role={role} aria-label={ariaLabel} data-testid="qr-svg" data-value={value} />
    ),
  };
});

describe('QrCodeCard', () => {
  const creator = { username: 'alice' };
  const anchorClickSpy = vi.fn();

  beforeEach(() => {
    toBlobMock.mockReset();
    anchorClickSpy.mockReset();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn(),
    });
    // Every download handler builds a throwaway <a download> and calls
    // .click() on it; jsdom implements .click() but it is not observable
    // navigation, so the anchor's own click method is replaced once here
    // (restored after every test) rather than re-wrapping createElement
    // per test, which stacks spies across tests if not carefully restored.
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === 'a') el.click = anchorClickSpy;
      return el;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders the profile URL and the QR code', () => {
    render(<QrCodeCard creator={creator} />);

    expect(screen.getByText('https://support-mee.vercel.app/alice')).toBeInTheDocument();
    expect(screen.getByTestId('qr-svg')).toHaveAttribute('data-value', 'https://support-mee.vercel.app/alice');
  });

  it('reflects the current username, not a captured initial value', () => {
    const { rerender } = render(<QrCodeCard creator={{ username: 'alice' }} />);
    expect(screen.getByText(/\/alice$/)).toBeInTheDocument();

    rerender(<QrCodeCard creator={{ username: 'alice-renamed' }} />);
    expect(screen.getByText(/\/alice-renamed$/)).toBeInTheDocument();
    expect(screen.queryByText(/\/alice$/)).not.toBeInTheDocument();
  });

  it('downloads a PNG built from the offscreen higher-resolution canvas', () => {
    const blob = new Blob(['fake-png'], { type: 'image/png' });
    toBlobMock.mockImplementation((cb: (b: Blob) => void) => cb(blob));

    render(<QrCodeCard creator={creator} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download PNG' }));

    expect(toBlobMock).toHaveBeenCalledWith(expect.any(Function), 'image/png');
    expect(anchorClickSpy).toHaveBeenCalledOnce();
  });

  it('names the downloaded PNG after the creator and a fixed suffix', () => {
    const blob = new Blob(['fake-png'], { type: 'image/png' });
    toBlobMock.mockImplementation((cb: (b: Blob) => void) => cb(blob));
    const appendSpy = vi.spyOn(document.body, 'appendChild');

    render(<QrCodeCard creator={creator} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download PNG' }));

    const anchor = appendSpy.mock.calls
      .map(([node]) => node)
      .find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);
    expect(anchor?.download).toBe('alice-supportme-qr.png');
  });

  it('reports an error instead of silently failing when the canvas has no blob to offer', () => {
    toBlobMock.mockImplementation((cb: (b: Blob | null) => void) => cb(null));

    render(<QrCodeCard creator={creator} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download PNG' }));

    expect(notify.error).toHaveBeenCalledWith('Could not generate the QR code image.');
    expect(anchorClickSpy).not.toHaveBeenCalled();
  });

  it('downloads an SVG serialized from the visible QR code element', () => {
    render(<QrCodeCard creator={creator} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download SVG' }));

    expect(anchorClickSpy).toHaveBeenCalledOnce();
  });

  it('names the downloaded SVG after the creator and a fixed suffix', () => {
    const appendSpy = vi.spyOn(document.body, 'appendChild');

    render(<QrCodeCard creator={creator} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download SVG' }));

    const anchor = appendSpy.mock.calls
      .map(([node]) => node)
      .find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);
    expect(anchor?.download).toBe('alice-supportme-qr.svg');
  });

  it('reports an error when the SVG element cannot be found', () => {
    render(<QrCodeCard creator={creator} />);
    screen.getByTestId('qr-svg').remove();

    fireEvent.click(screen.getByRole('button', { name: 'Download SVG' }));

    expect(notify.error).toHaveBeenCalledWith('Could not generate the QR code image.');
    expect(anchorClickSpy).not.toHaveBeenCalled();
  });

  it('describes the QR code purpose to assistive technology', () => {
    render(<QrCodeCard creator={creator} />);

    expect(
      screen.getByRole('img', { name: "QR code linking to @alice's SupportMe donation page" })
    ).toBeInTheDocument();
  });

  describe('Share', () => {
    const pngBlob = new Blob(['fake-png'], { type: 'image/png' });

    beforeEach(() => {
      vi.mocked(notify.error).mockClear();
      vi.mocked(notify.success).mockClear();
      toBlobMock.mockImplementation((cb: (b: Blob) => void) => cb(pngBlob));
    });

    it('shares the QR image and link through the native share sheet when files are supported', async () => {
      const share = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { share, canShare: vi.fn(() => true) });

      render(<QrCodeCard creator={creator} />);
      fireEvent.click(screen.getByRole('button', { name: 'Share' }));

      await waitFor(() => expect(share).toHaveBeenCalledOnce());
      const data = share.mock.calls[0][0] as ShareData;
      expect(data.url).toBe('https://support-mee.vercel.app/alice');
      expect(data.files?.[0].name).toBe('alice-supportme-qr.png');
    });

    it('shares just the link when the browser cannot share files', async () => {
      const share = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { share, canShare: vi.fn(() => false) });

      render(<QrCodeCard creator={creator} />);
      fireEvent.click(screen.getByRole('button', { name: 'Share' }));

      await waitFor(() => expect(share).toHaveBeenCalledOnce());
      expect(share.mock.calls[0][0]).not.toHaveProperty('files');
    });

    it('copies the link when the Web Share API is unavailable', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { clipboard: { writeText } });

      render(<QrCodeCard creator={creator} />);
      fireEvent.click(screen.getByRole('button', { name: 'Share' }));

      await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://support-mee.vercel.app/alice'));
      expect(notify.success).toHaveBeenCalledWith('Profile link copied to clipboard');
    });

    it('stays silent when the user dismisses the share sheet', async () => {
      const writeText = vi.fn();
      const share = vi.fn().mockRejectedValue(Object.assign(new Error('dismissed'), { name: 'AbortError' }));
      vi.stubGlobal('navigator', { share, canShare: vi.fn(() => true), clipboard: { writeText } });

      render(<QrCodeCard creator={creator} />);
      fireEvent.click(screen.getByRole('button', { name: 'Share' }));

      await waitFor(() => expect(share).toHaveBeenCalledOnce());
      expect(writeText).not.toHaveBeenCalled();
      expect(notify.error).not.toHaveBeenCalled();
    });

    it('falls back to copying the link when sharing fails', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      const share = vi.fn().mockRejectedValue(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
      vi.stubGlobal('navigator', { share, canShare: vi.fn(() => true), clipboard: { writeText } });

      render(<QrCodeCard creator={creator} />);
      fireEvent.click(screen.getByRole('button', { name: 'Share' }));

      await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://support-mee.vercel.app/alice'));
    });
  });
});

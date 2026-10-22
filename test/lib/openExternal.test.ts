import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ argon: { isArgonHost: false }, openUrl: vi.fn(async () => true) }));
vi.mock('@argon/glue', () => ({ argon: mocks.argon }));
vi.mock('@argon/glue/native', () => ({ native: { hostProc: { openUrl: mocks.openUrl } } }));
import { openExternalUrl } from '@/lib/linkPreview/openExternal';

beforeEach(() => {
  mocks.argon.isArgonHost = false;
  delete (window as any).argonIpc;
  vi.clearAllMocks();
});

describe('external links', () => {
  test('a web link opens in the browser without attempting IPC', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openExternalUrl('https://example.com/');
    expect(open).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer');
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });
  test('an Argon host uses its intercepted window.open', () => {
    mocks.argon.isArgonHost = true;
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openExternalUrl('https://example.com/');
    expect(open).toHaveBeenCalled();
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });
  test('an Electron IPC bridge is used when present', () => {
    (window as any).argonIpc = {};
    openExternalUrl('https://example.com/');
    expect(mocks.openUrl).toHaveBeenCalledWith('https://example.com/');
  });
  test('message links cannot launch another protocol', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    for (const url of ['javascript:alert(1)', 'file:///tmp/foo', 'argon://test']) openExternalUrl(url);
    expect(open).not.toHaveBeenCalled();
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { getBrowserPosition, locationAvailability, locationErrorIssue } from '../src/lib/geolocation';

afterEach(() => vi.useRealTimers());

describe('browser location diagnostics', () => {
  it('identifies insecure HTTP even when the browser hides geolocation', () => {
    expect(locationAvailability(false, false)?.kind).toBe('insecure');
    expect(locationAvailability(false, true)?.kind).toBe('insecure');
    expect(locationAvailability(true, false)?.kind).toBe('unsupported');
    expect(locationAvailability(true, true)).toBeNull();
  });
  it('distinguishes denied permission, unavailable position, and timeout', () => {
    expect(locationErrorIssue({ code: 1 }).kind).toBe('permission');
    expect(locationErrorIssue({ code: 2 }).kind).toBe('unavailable');
    expect(locationErrorIssue({ code: 3 }).kind).toBe('timeout');
    expect(locationErrorIssue(new Error('failure')).kind).toBe('unknown');
  });
  it('times out even if the browser never invokes its callbacks', async () => {
    vi.useFakeTimers();
    const result = getBrowserPosition({ getCurrentPosition: vi.fn() });
    const assertion = expect(result).rejects.toMatchObject({ code: 3 });
    await vi.advanceTimersByTimeAsync(16_000);
    await assertion;
  });
  it('ignores late GPS results after the user has chosen another origin', async () => {
    vi.useFakeTimers();
    let success!: PositionCallback;
    const controller = new AbortController();
    const result = getBrowserPosition({ getCurrentPosition: callback => { success = callback; } }, controller.signal);
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    success({ coords: { longitude: 120.21, latitude: 30.24 } } as GeolocationPosition);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('returns GPS coordinates without converting or substituting an IP location', async () => {
    vi.useFakeTimers();
    const position = { coords: { longitude: 120.21, latitude: 30.24, accuracy: 50 } } as GeolocationPosition;
    await expect(getBrowserPosition({ getCurrentPosition: success => success(position) })).resolves.toBe(position);
    expect(vi.getTimerCount()).toBe(0);
  });
});

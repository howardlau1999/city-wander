import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAmapClient, RequestGate } from '../server/amap';

afterEach(() => vi.useRealTimers());

describe('高德个人 Key 请求速率', () => {
  it('并发请求每 375ms 开始一次，不受返回速度影响', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const starts: number[] = [];
    const api = createAmapClient('test-key', async () => { starts.push(Date.now()); return new Response(JSON.stringify({ status: '1' })); }, new RequestGate());
    const results = Promise.all([api('/v3/place/text', {}), api('/v5/direction/walking', {}), api('/v5/direction/driving', {})]);
    await vi.advanceTimersByTimeAsync(749);
    expect(starts).toEqual([0, 375]);
    await vi.advanceTimersByTimeAsync(1);
    await results;
    expect(starts).toEqual([0, 375, 750]);
  });
  it('队列有上限，超出容量立即返回 429', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const gate = new RequestGate(375, 2);
    await gate.waitForSlot();
    const a = gate.waitForSlot(), b = gate.waitForSlot();
    await expect(gate.waitForSlot()).rejects.toMatchObject({ statusCode: 429 });
    await vi.advanceTimersByTimeAsync(750);
    await Promise.all([a, b]);
  });
  it('排队也受规划整体 deadline 约束，过期请求不会启动网络', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const gate = new RequestGate();
    await gate.waitForSlot();
    const starts: number[] = [];
    const api = createAmapClient('test-key', async () => { starts.push(Date.now()); return new Response(JSON.stringify({ status: '1' })); }, gate);
    await expect(api('/v5/direction/driving', {}, { deadline: 200 })).rejects.toMatchObject({ statusCode: 504 });
    expect(starts).toEqual([]);
  });
});

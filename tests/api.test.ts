import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../server/app';
import type { AmapRequest } from '../server/amap';

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }))); });

async function serve(env: NodeJS.ProcessEnv = {}, api?: AmapRequest) {
  const server = createApp(env, api).listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  return `http://127.0.0.1:${address.port}`;
}

describe('HTTP API boundary', () => {
  it('only exposes browser configuration, never the Web Service key', async () => {
    const base = await serve({ AMAP_WEB_KEY: 'private-server-key', AMAP_JS_KEY: 'public-js-key', AMAP_SECURITY_JS_CODE: 'js-code' });
    const response = await fetch(`${base}/api/config`);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ liveRouting: true, jsKey: 'public-js-key', securityJsCode: 'js-code' });
    expect(text).not.toContain('private-server-key');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it('returns a clear 503 for unconfigured live place search', async () => {
    const base = await serve();
    const response = await fetch(`${base}/api/places?query=公园`);
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain('AMAP_WEB_KEY');
  });
  it('rejects malformed or impossible plan inputs before calling upstream', async () => {
    let called = false;
    const base = await serve({}, async () => { called = true; return {}; });
    const response = await fetch(`${base}/api/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minutes: 0 }) });
    expect(response.status).toBe(400);
    expect(called).toBe(false);
  });
  it('converts GPS coordinates once using gps, with documented precision', async () => {
    const base = await serve({}, async (endpoint, params) => {
      expect(endpoint).toBe('/v3/assistant/coordinate/convert');
      expect(params).toEqual({ locations: '120.123457,30.765432', coordsys: 'gps' });
      return { locations: '120.1288,30.7632' };
    });
    const response = await fetch(`${base}/api/convert-location`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: [120.123456789, 30.7654321] }) });
    expect(await response.json()).toEqual({ location: [120.1288, 30.7632] });
  });
});

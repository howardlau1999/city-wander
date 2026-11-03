import express, { type ErrorRequestHandler } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ApiError, coordinate, createAmapClient, locationString, parsePlaces, type AmapRequest } from './amap.js';
import { coordinateSchema, planSchema, planWander } from './planner.js';

export function createApp(env: NodeJS.ProcessEnv = process.env, injectedApi?: AmapRequest) {
  const app = express();
  const api = injectedApi ?? createAmapClient(env.AMAP_WEB_KEY ?? '');
  app.disable('x-powered-by');
  app.use(express.json({ limit: '12kb' }));
  app.use('/api', (_request, response, next) => { response.setHeader('Cache-Control', 'no-store'); next(); });

  // This starter is intended for personal use. Bound requests to protect the API quota.
  const requests = new Map<string, { at: number; count: number }>();
  app.use('/api', (request, response, next) => {
    if (request.path === '/config') return next();
    const now = Date.now();
    for (const [ip, item] of requests) if (now - item.at > 60_000) requests.delete(ip);
    const key = request.ip ?? 'local';
    const entry = requests.get(key) ?? { at: now, count: 0 };
    entry.count += request.path === '/plan' ? 5 : 1;
    requests.set(key, entry);
    if (entry.count > 30) return response.status(429).json({ error: '请求有些频繁，请稍等一分钟再试。' });
    next();
  });

  app.get('/api/config', (_request, response) => response.json({
    liveRouting: Boolean(env.AMAP_WEB_KEY?.trim()), jsKey: env.AMAP_JS_KEY ?? '', securityJsCode: env.AMAP_SECURITY_JS_CODE ?? '',
  }));
  app.get('/api/places', async (request, response, next) => {
    try {
      const input = z.object({ query: z.string().trim().min(1).max(80), city: z.string().trim().min(1).max(40).default('杭州') }).parse(request.query);
      const result = await api('/v3/place/text', { keywords: input.query, city: input.city, citylimit: 'true', offset: 10, page: 1, extensions: 'all' });
      response.json({ places: parsePlaces(result) });
    } catch (error) { next(error); }
  });
  app.post('/api/convert-location', async (request, response, next) => {
    try {
      const input = z.object({ location: coordinateSchema }).parse(request.body);
      const result = await api('/v3/assistant/coordinate/convert', { locations: locationString(input.location), coordsys: 'gps' });
      const location = coordinate(result.locations);
      if (!location) throw new ApiError('高德未返回有效的转换坐标。');
      response.json({ location });
    } catch (error) { next(error); }
  });
  app.post('/api/plan', async (request, response, next) => {
    try { response.json(await planWander(planSchema.parse(request.body), api)); } catch (error) { next(error); }
  });
  app.use('/api', (_request, response) => response.status(404).json({ error: '接口不存在。' }));

  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  if (existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.use((request, response, next) => request.method === 'GET' && request.accepts('html') ? response.sendFile(path.join(dist, 'index.html')) : next());
  }
  const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (error instanceof z.ZodError) response.status(400).json({ error: `输入有误：${error.issues[0]?.message ?? '请检查输入。'}` });
    else if (error instanceof ApiError) response.status(error.statusCode).json({ error: error.message });
    else if (error instanceof SyntaxError) response.status(400).json({ error: '请求内容不是有效的 JSON。' });
    else response.status(500).json({ error: '服务暂时无法完成请求，请稍后再试。' });
  };
  app.use(errorHandler);
  return app;
}

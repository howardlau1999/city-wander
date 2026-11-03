import { describe, expect, it } from 'vitest';
import { ApiError, createAmapClient, parsePlaces, type AmapRequest } from '../server/amap';
import { bestPath, distanceBetween, durationScore, isWaterfrontPoi, offsetLocation, parsePath, planSchema, planWander, rankRoutes, routeFootprint, selectWaypointPairs } from '../server/planner';
import { createDemoPlan, DEMO_ORIGIN } from '../src/lib/demo';
import type { PlanRequest } from '../shared/types';

const request: PlanRequest = { origin: DEMO_ORIGIN, mode: 'driving', minutes: 60, preference: 'park', seed: 42 };
const pathFixture = {
  distance: '1500', cost: { duration: '600', tolls: '0' },
  steps: [{ road_name: '钱江路', polyline: '120.21,30.24;120.22,30.25' }, { road_name: '钱江路', polyline: '120.22,30.25;120.23,30.26' }],
};

describe('高德路线解析', () => {
  it('读取 v5 cost.duration，并合并分段坐标、去除相邻重复点', () => {
    expect(parsePath(pathFixture)).toMatchObject({ durationSeconds: 600, distanceMeters: 1500, roads: ['钱江路'], polyline: [[120.21, 30.24], [120.22, 30.25], [120.23, 30.26]] });
  });
  it('不把无时长、无几何或非法坐标响应拼成假路线', () => {
    expect(parsePath({ ...pathFixture, cost: {} })).toBeNull();
    expect(parsePath({ ...pathFixture, steps: [] })).toBeNull();
    expect(parsePath({ ...pathFixture, steps: [{ polyline: '120.2,30.2;nope' }] })).toBeNull();
    expect(() => bestPath({ route: { paths: [] } })).toThrow(ApiError);
  });
  it('过滤异常 POI，优先使用入口坐标', () => {
    expect(parsePlaces({ pois: [{ id: 'park', name: '公园', location: '120.2,30.2', entr_location: '120.21,30.21', address: [] }, { id: 'bad', name: '坏数据', location: [] }] })).toEqual([{ id: 'park', name: '公园', location: [120.21, 30.21], address: '' }]);
  });
});

describe('环线策略', () => {
  it('按实际时间偏差排序，去除相同途经点的重复路线', () => {
    const [a, b, c] = createDemoPlan(request).routes;
    a.matchScore = durationScore(3600, 60);
    b.matchScore = durationScore(5400, 60);
    c.waypoints = [...a.waypoints].reverse();
    c.matchScore = 70;
    expect(rankRoutes([b, c, a], request).map((route) => route.id)).toEqual([a.id, b.id]);
  });
  it('拒绝非法时间和步行高架组合', () => {
    expect(planSchema.safeParse({ ...request, minutes: 0 }).success).toBe(false);
    expect(planSchema.safeParse({ ...request, minutes: 181 }).success).toBe(false);
    expect(planSchema.safeParse({ ...request, mode: 'walking', preference: 'elevated' }).success).toBe(false);
    expect(planSchema.safeParse({ ...request, origin: { ...DEMO_ORIGIN, location: [300, 30] } }).success).toBe(false);
  });
  it('驾车分成最多一个途经点的两段请求，步行分三段，并累加真实耗时', async () => {
    for (const mode of ['driving', 'walking'] as const) {
      const calls: { endpoint: string; params: Record<string, string | number> }[] = [];
      let search = 0;
      const api: AmapRequest = async (endpoint, params) => {
        calls.push({ endpoint, params });
        if (endpoint.includes('place')) {
          search++;
          return { pois: [{ id: `p${search}`, name: `公园${search}`, location: offsetLocation(request.origin.location, 5000, search * 120).join(',') }] };
        }
        const polyline = [params.origin, ...(params.waypoints ? [params.waypoints] : []), params.destination].join(';');
        return { route: { paths: [{ ...pathFixture, cost: { duration: mode === 'driving' ? '1800' : '1200' }, steps: [{ road_name: '测试道路', polyline }] }] } };
      };
      const result = await planWander({ ...request, mode }, api);
      expect(result.routes).toHaveLength(3);
      expect(result.routes.every((route) => route.durationSeconds === 3600)).toBe(true);
      expect(result.routes.every((route) => route.source === 'amap' && route.waypoints.length === 2)).toBe(true);
      const routeCalls = calls.filter((call) => call.endpoint.includes('direction'));
      expect(routeCalls).toHaveLength(mode === 'driving' ? 6 : 9);
      expect(routeCalls.every((call) => !String(call.params.waypoints ?? '').includes(';'))).toBe(true);
      expect(routeCalls.at(-1)?.params.destination).toBe('120.212686,30.242255');
    }
  });
  it('附近无合适 POI 时明确失败，不回退示例', async () => {
    await expect(planWander(request, async () => ({ pois: [] }))).rejects.toThrow('没有找到足够');
  });
  it('重走检测能识别反向道路上的不同顶点，不把普通环线当成折返', () => {
    const origin = DEMO_ORIGIN.location;
    const east = offsetLocation(origin, 2000, 90), north = offsetLocation(origin, 2000, 0), midway = offsetLocation(origin, 1000, 90);
    expect(routeFootprint([origin, east, midway, origin], origin).repeatRatio).toBeGreaterThan(0.4);
    expect(routeFootprint([origin, east, north, origin], origin).repeatRatio).toBeLessThan(0.05);
  });
  it('时间偏差过大的路线不会混在接近目标的候选中；全部不匹配时只返回一条', () => {
    const routes = createDemoPlan(request).routes;
    routes[0].durationSeconds = 3600; routes[0].matchScore = 100;
    routes[1].durationSeconds = 8000; routes[1].matchScore = 0;
    routes[2].durationSeconds = 10_000; routes[2].matchScore = 0;
    expect(rankRoutes(routes, request).map((route) => route.id)).toEqual([routes[0].id]);
    routes[0].durationSeconds = 7500; routes[0].matchScore = 0;
    expect(rankRoutes([routes[2], routes[1], routes[0]], request).map((route) => route.id)).toEqual([routes[0].id]);
  });
  it('几何评分优先选择分散方向的途经点，而不是同方向的薄三角', () => {
    const makePlace = (id: string, bearing: number) => ({ id, name: id, location: offsetLocation(request.origin.location, 5000, bearing) });
    const a = makePlace('a', 0), near = makePlace('near', 10), wide = makePlace('wide', 120);
    expect(selectWaypointPairs([[a], [near, wide], [a]], request)[0].map((place) => place.id)).toEqual(['a', 'wide']);
  });
  it('上游权限错误立即停止规划，保留明确错误而非继续消耗配额', async () => {
    let calls = 0;
    await expect(planWander(request, async () => { calls++; throw new ApiError('高德请求未成功（10012）。请检查权限。'); })).rejects.toThrow('权限');
    expect(calls).toBe(1);
  });
  it('真实时长偏短时只校准一轮，进入±15%后立即停止额外算路', async () => {
    for (const mode of ['driving', 'walking'] as const) {
      let searches = 0, directions = 0;
      const centres: [number, number][] = [];
      const api: AmapRequest = async (endpoint, params) => {
        if (endpoint.includes('place')) {
          searches++;
          centres.push(String(params.location).split(',').map(Number) as [number, number]);
          return { pois: [{ id: `p${searches}`, name: `公园${searches}`, location: params.location }] };
        }
        directions++;
        const duration = searches <= 3 ? (mode === 'driving' ? '900' : '600') : (mode === 'driving' ? '1700' : '1100');
        return { route: { paths: [{ ...pathFixture, cost: { duration }, steps: [{ road_name: '测试道路', polyline: [params.origin, ...(params.waypoints ? [params.waypoints] : []), params.destination].join(';') }] }] } };
      };
      const result = await planWander({ ...request, mode }, api);
      expect(searches).toBe(6);
      expect(directions).toBe(mode === 'driving' ? 8 : 12);
      expect(distanceBetween(request.origin.location, centres[3]) / distanceBetween(request.origin.location, centres[0])).toBeCloseTo(1.8, 1);
      expect(Math.abs(result.routes[0].durationSeconds - 3600)).toBeLessThanOrEqual(3600 * 0.15);
    }
  });
  it('校准后仍偏离目标也不会递归重试，并给出时长提示', async () => {
    let searches = 0, directions = 0;
    const api: AmapRequest = async (endpoint, params) => {
      if (endpoint.includes('place')) return { pois: [{ id: `p${++searches}`, name: '公园', location: params.location }] };
      directions++;
      return { route: { paths: [{ ...pathFixture, cost: { duration: '1200' }, steps: [{ polyline: [params.origin, ...(params.waypoints ? [params.waypoints] : []), params.destination].join(';') }] }] } };
    };
    const result = await planWander(request, api);
    expect(searches).toBe(6);
    expect(directions).toBe(10);
    expect(result.warnings.join('')).toContain('±20%');
  });
  it('滨水偏好拒绝滨江区商家名，只保留明确的公共水岸地点', () => {
    expect(isWaterfrontPoi({ name: '星巴克(滨江城市之星店)', typecode: '050500' })).toBe(false);
    expect(isWaterfrontPoi({ name: '湖畔居', typecode: '050400' })).toBe(false);
    expect(isWaterfrontPoi({ name: '沿江步道咖啡馆', typecode: '050500' })).toBe(false);
    expect(isWaterfrontPoi({ name: '滨江公园', typecode: '110101' })).toBe(true);
    expect(isWaterfrontPoi({ name: '钱塘江沿江绿道', typecode: '190205' })).toBe(true);
    expect(isWaterfrontPoi({ name: '武林门码头', typecode: '150400' })).toBe(true);
  });
  it('高架偏好使用大路优先 37，且保留不保证高架的提示', async () => {
    let search = 0;
    const strategies: unknown[] = [];
    const api: AmapRequest = async (endpoint, params) => {
      if (endpoint.includes('place')) return { pois: [{ id: `p${++search}`, name: '城市地标', location: `${120.23 + search * 0.01},30.26` }] };
      strategies.push(params.strategy);
      return { route: { paths: [pathFixture] } };
    };
    const result = await planWander({ ...request, preference: 'elevated' }, api);
    expect(strategies.every((strategy) => strategy === 37)).toBe(true);
    expect(result.routes[0].warnings.join('')).toContain('不保证');
  });
});

describe('错误与演示边界', () => {
  it('网络错误不回显密钥或原始 URL', async () => {
    const api = createAmapClient('private-key', async () => { throw new Error('https://example.test/?key=private-key'); });
    await expect(api('/v3/place/around', {})).rejects.toThrow('连接失败');
    await expect(api('/v3/place/around', {})).rejects.not.toThrow('private-key');
  });
  it('缺少 Key 给出明确配置错误', async () => {
    await expect(createAmapClient('')('/v3/place/around', {})).rejects.toMatchObject({ statusCode: 503 });
  });
  it('演示模式有清晰来源标记，换 seed 会换途经点', () => {
    const a = createDemoPlan(request), b = createDemoPlan({ ...request, seed: 43 });
    expect(a.source).toBe('demo');
    expect(a.routes.every((route) => route.source === 'demo' && route.warnings.join('').includes('不能用于导航'))).toBe(true);
    expect(a.routes[0].waypoints).not.toEqual(b.routes[0].waypoints);
    expect(a.routes[0].polyline.at(-1)).toEqual(request.origin.location);
  });
});

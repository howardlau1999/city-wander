import { z } from 'zod';
import type { Coordinate, Place, PlanRequest, PlanResponse, Preference, WanderRoute } from '../shared/types.js';
import { ApiError, array, coordinate, locationString, object, parsePlaces, string, type AmapRequest } from './amap.js';

export const coordinateSchema = z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]);
export const planSchema = z.object({
  origin: z.object({ id: z.string().min(1).max(120), name: z.string().trim().min(1).max(120), location: coordinateSchema, address: z.string().max(250).optional() }),
  mode: z.enum(['driving', 'walking']),
  minutes: z.number().int().min(15).max(180),
  preference: z.enum(['surprise', 'park', 'waterfront', 'elevated']),
  seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).refine((request) => !(request.mode === 'walking' && request.preference === 'elevated'), { message: '步行不支持高架偏好，请选择其他风景。' });

export function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let mixed = Math.imul(value ^ (value >>> 15), value | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function distanceBetween(a: Coordinate, b: Coordinate): number {
  const radians = Math.PI / 180;
  const dLat = (b[1] - a[1]) * radians;
  const dLng = (b[0] - a[0]) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin(dLng / 2) ** 2;
  return 12_742_000 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function offsetLocation(origin: Coordinate, meters: number, bearing: number): Coordinate {
  const angle = bearing * Math.PI / 180;
  return [origin[0] + Math.sin(angle) * meters / (111_320 * Math.cos(origin[1] * Math.PI / 180)), origin[1] + Math.cos(angle) * meters / 111_320];
}

export interface ParsedPath { durationSeconds: number; distanceMeters: number; polyline: Coordinate[]; roads: string[]; tolls: number }

export function parsePath(value: unknown): ParsedPath | null {
  const path = object(value);
  const durationSeconds = Number(object(path.cost).duration);
  const distanceMeters = Number(path.distance);
  const steps = array(path.steps).map(object);
  // Missing route geometry is a failed preview, never substitute a straight line.
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(distanceMeters) || distanceMeters <= 0 || !steps.length) return null;
  const polyline: Coordinate[] = [];
  for (const step of steps) {
    const points = string(step.polyline).split(';');
    if (!string(step.polyline)) return null;
    for (const entry of points) {
      const point = coordinate(entry);
      if (!point) return null;
      const last = polyline.at(-1);
      if (!last || point[0] !== last[0] || point[1] !== last[1]) polyline.push(point);
    }
  }
  if (polyline.length < 2) return null;
  return { durationSeconds, distanceMeters, polyline, roads: [...new Set(steps.map((step) => string(step.road_name)).filter(Boolean))], tolls: Number(object(path.cost).tolls) || 0 };
}

export function bestPath(data: unknown): ParsedPath {
  const paths = array(object(object(data).route).paths).map(parsePath).filter((path): path is ParsedPath => path !== null);
  if (!paths.length) throw new ApiError('这个途经点组合没有可用的道路路线，请换一批路线或更改起点。', 422);
  return paths[0];
}

export function durationScore(durationSeconds: number, targetMinutes: number): number {
  return Math.max(0, Math.round(100 - Math.abs(durationSeconds - targetMinutes * 60) / (targetMinutes * 60) * 100));
}

const preferenceLabels: Record<Preference, string> = { surprise: '随心发现', park: '公园与绿意', waterfront: '沿水漫游', elevated: '城市天际线' };

export function isWaterfrontPoi(value: unknown): boolean {
  const poi = object(value);
  const name = string(poi.name), typecode = string(poi.typecode);
  // "滨江" is also a district name. Require an actual public waterside feature,
  // not a cafe, restaurant, hotel or shop whose branch happens to be in 滨江.
  if (!/^(110|150|190|220)/.test(typecode)) return false;
  return /(?:滨江|江滨|滨河|河滨|湖滨|滨湖|沿江|沿河|沿湖|江畔|河畔|湖畔).*(?:公园|步道|绿道|广场|平台|长廊|观景|栈道)|江堤|河堤|湖堤|码头|亲水(?:平台|公园|步道|绿道|广场)/.test(name);
}

// Approximate spatial coverage, not an assertion about lane-level road identity.
// Sampling into 50 m cells also catches a return leg whose polyline has different vertices.
export function routeFootprint(polyline: Coordinate[], reference: Coordinate): { cells: Set<string>; repeatRatio: number } {
  const cells = new Set<string>();
  let previous = '', visits = 0, repeated = 0;
  const longitudeScale = 111_320 * Math.cos(reference[1] * Math.PI / 180);
  for (let index = 1; index < polyline.length; index++) {
    const a = polyline[index - 1], b = polyline[index];
    const steps = Math.min(1000, Math.max(1, Math.ceil(distanceBetween(a, b) / 20)));
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      const lng = a[0] + (b[0] - a[0]) * t, lat = a[1] + (b[1] - a[1]) * t;
      const cell = `${Math.floor((lng - reference[0]) * longitudeScale / 50)},${Math.floor((lat - reference[1]) * 111_320 / 50)}`;
      if (cell === previous) continue;
      previous = cell;
      visits++;
      if (cells.has(cell)) repeated++;
      cells.add(cell);
    }
  }
  return { cells, repeatRatio: visits ? repeated / visits : 0 };
}

export function selectWaypointPairs(pools: Place[][], request: PlanRequest, radiusScale = 1): [Place, Place][] {
  const all = [...new Map(pools.flat().map((place) => [place.id, place])).values()];
  const targetStraightMeters = request.minutes / 60 * (request.mode === 'driving' ? 25_000 : 4_500) / 1.3 * radiusScale;
  const selected: [Place, Place][] = [];
  const used = new Set<string>();
  for (let index = 0; index < 3; index++) {
    const firstPool = (pools[index].length ? pools[index] : all).slice(0, 6);
    const secondPool = (pools[(index + 1) % 3].length ? pools[(index + 1) % 3] : all).slice(0, 6);
    const options: { pair: [Place, Place]; score: number; key: string }[] = [];
    for (let a = 0; a < firstPool.length; a++) for (let b = 0; b < secondPool.length; b++) {
      const first = firstPool[a], second = secondPool[b];
      const key = [first.id, second.id].sort().join('|');
      const between = distanceBetween(first.location, second.location);
      if (first.id === second.id || between < 100 || used.has(key)) continue;
      const radial = distanceBetween(request.origin.location, first.location) + distanceBetween(request.origin.location, second.location);
      // Same-direction waypoints form a thin out-and-back, even when both are scenic.
      const separationPenalty = Math.max(0, 0.55 - between / radial) * 2;
      options.push({ pair: [first, second], key, score: Math.abs(radial + between - targetStraightMeters) / targetStraightMeters + separationPenalty + (a + b) * 0.015 });
    }
    options.sort((a, b) => a.score - b.score);
    if (options[0]) { selected.push(options[0].pair); used.add(options[0].key); }
  }
  return selected;
}

export function rankRoutes(routes: WanderRoute[], request: PlanRequest): WanderRoute[] {
  const unique = new Map<string, WanderRoute>();
  for (const route of routes) {
    const key = route.waypoints.map((point) => point.id).sort().join('|');
    const existing = unique.get(key);
    if (!existing || route.matchScore > existing.matchScore) unique.set(key, route);
  }
  const evaluated = [...unique.values()].map((route) => ({ route, footprint: routeFootprint(route.polyline, request.origin.location) }));
  // A route twice the requested duration isn't an equally useful alternative.
  const withinRange = evaluated.filter(({ route }) => Math.abs(route.durationSeconds - request.minutes * 60) <= request.minutes * 60 * 0.5);
  const pool = withinRange.length ? withinRange : evaluated;
  pool.sort((a, b) => {
    // Duration is the user's main constraint; scenic/overlap preferences break ties.
    const difference = Math.abs(a.route.durationSeconds - request.minutes * 60) - Math.abs(b.route.durationSeconds - request.minutes * 60);
    if (difference !== 0) return difference;
    const elevatedBonus = (route: WanderRoute) => request.preference === 'elevated' && route.roads.some((road) => /高架|快速路/.test(road)) ? 5 : 0;
    return (b.route.matchScore + elevatedBonus(b.route) - b.footprint.repeatRatio * 35) - (a.route.matchScore + elevatedBonus(a.route) - a.footprint.repeatRatio * 35);
  });
  const selected: typeof evaluated = [];
  for (const entry of pool) {
    const duplicate = selected.some((existing) => {
      const intersection = [...entry.footprint.cells].filter((cell) => existing.footprint.cells.has(cell)).length;
      const union = new Set([...entry.footprint.cells, ...existing.footprint.cells]).size;
      return union > 0 && intersection / union > 0.85;
    });
    if (!duplicate) selected.push(entry);
    if (selected.length >= (withinRange.length ? 3 : 1)) break;
  }
  return selected.map(({ route }) => route);
}

async function searchCandidates(request: PlanRequest, api: AmapRequest, radiusScale = 1): Promise<Place[][]> {
  const random = seededRandom(request.seed);
  const targetMeters = request.minutes / 60 * (request.mode === 'driving' ? 25_000 : 4_500);
  // A roughly triangular loop is ~3.7 radii before accounting for road detours.
  const radius = Math.max(request.mode === 'driving' ? 850 : 180, Math.min(22_000, targetMeters / 4.8 * radiusScale));
  const startBearing = random() * 360;
  const pools: Place[][] = [];
  for (let index = 0; index < 3; index++) {
    const centre = offsetLocation(request.origin.location, radius * [0.78, 1, 1.18][index], startBearing + index * 120);
    const params: Record<string, string | number> = {
      location: locationString(centre), radius: Math.round(Math.min(6000, Math.max(600, radius * 0.65))),
      offset: 20, page: 1, extensions: 'all', sortrule: 'distance',
    };
    if (request.preference === 'park') params.types = '110101';
    else if (request.preference === 'waterfront') {
      params.keywords = '滨江公园|江滨公园|滨河公园|湖滨公园|沿江步道|沿江绿道|江堤|亲水平台|码头';
      params.types = '110000|150000|190000|220000';
    }
    else if (request.preference === 'elevated') params.types = '120000|150000';
    else params.types = '110000|140000|120000';
    const result = await api('/v3/place/around', params);
    if (request.preference === 'waterfront') result.pois = array(result.pois).filter(isWaterfrontPoi);
    const places = parsePlaces(result).filter((place) =>
      place.id !== request.origin.id && distanceBetween(place.location, request.origin.location) > (request.mode === 'walking' ? 100 : 250));
    // Prefer the sampled ring, with a small seeded perturbation for "换一批".
    // Fully shuffling a large POI response would make short walks overshoot badly.
    pools.push(places.map((place) => ({ place, order: distanceBetween(place.location, centre) + random() * radius * 0.3 }))
      .sort((a, b) => a.order - b.order).map(({ place }) => place));
  }
  return pools;
}

export async function planWander(request: PlanRequest, api: AmapRequest): Promise<PlanResponse> {
  // Hard budget applies even when a provider result is malformed. No unbounded sampling.
  let calls = 0;
  const startedAt = Date.now();
  const maxCalls = request.mode === 'driving' ? 16 : 21;
  const limitedApi: AmapRequest = (path, params) => {
    if (++calls > maxCalls || Date.now() - startedAt > 45_000) throw new ApiError('本次路线规划耗时较长，请稍后换一批重试。', 504);
    return api(path, params, { deadline: startedAt + 45_000 });
  };
  const pools = await searchCandidates(request, limitedApi);
  const allPlaces = [...new Map(pools.flat().map((place) => [place.id, place])).values()];
  if (allPlaces.length < 2) throw new ApiError('附近没有找到足够的符合偏好的途经点，试试其他偏好或更长时长。', 422);
  const candidates = selectWaypointPairs(pools, request);
  const routes: WanderRoute[] = [];
  const errors: ApiError[] = [];
  const targetSeconds = request.minutes * 60;
  const closestRoute = () => [...routes].sort((a, b) => Math.abs(a.durationSeconds - targetSeconds) - Math.abs(b.durationSeconds - targetSeconds))[0];
  let attemptedRoutes = 0;
  const evaluate = async (pairs: [Place, Place][], calibration = false) => {
  for (const waypoints of pairs) {
    if (calibration && closestRoute() && Math.abs(closestRoute().durationSeconds - targetSeconds) <= targetSeconds * 0.15) break;
    const index = attemptedRoutes++;
    const points = [request.origin, ...waypoints, request.origin];
    const paths: ParsedPath[] = [];
    try {
      if (request.mode === 'driving') {
        const common = { strategy: request.preference === 'elevated' ? 37 : 32, ferry: 1, show_fields: 'cost,polyline' };
        // Default Web Service access only promises one waypoint per request.
        paths.push(bestPath(await limitedApi('/v5/direction/driving', { ...common, origin: locationString(points[0].location), waypoints: locationString(points[1].location), destination: locationString(points[2].location) })));
        paths.push(bestPath(await limitedApi('/v5/direction/driving', { ...common, origin: locationString(points[2].location), destination: locationString(points[3].location) })));
      } else {
        for (let leg = 0; leg < 3; leg++) paths.push(bestPath(await limitedApi('/v5/direction/walking', {
          origin: locationString(points[leg].location), destination: locationString(points[leg + 1].location), show_fields: 'cost,polyline', isindoor: 0,
        })));
      }
      const durationSeconds = paths.reduce((sum, path) => sum + path.durationSeconds, 0);
      const roads = [...new Set(paths.flatMap((path) => path.roads))];
      const polyline = paths.flatMap((path) => path.polyline);
      const repeatRatio = routeFootprint(polyline, request.origin.location).repeatRatio;
      const warnings: string[] = [];
      if (Math.abs(durationSeconds / 60 - request.minutes) > request.minutes * 0.2) warnings.push(`这条路线与目标相差约 ${Math.round(Math.abs(durationSeconds / 60 - request.minutes))} 分钟。`);
      if (request.preference === 'elevated') warnings.push('使用大路优先策略；高架路名仅作线索，不保证全程或一定驶上高架。');
      if (request.preference === 'waterfront') warnings.push('途经含滨水关键词的地点，不保证道路全程临水。');
      if (paths.some((path) => path.tolls > 0)) warnings.push('高德算路结果包含收费路段。');
      if (repeatRatio > 0.22) warnings.push('这条路线有较多重复经过的区域，可能存在折返，可在地图上检查或换一批。');
      routes.push({
        id: `amap-${request.seed}-${index}`, name: `${preferenceLabels[request.preference]} · ${index + 1}`,
        description: `从${request.origin.name}出发，途经${waypoints.map((point) => point.name).join('、')}，再回到起点。`,
        origin: request.origin, waypoints, mode: request.mode, durationSeconds,
        distanceMeters: paths.reduce((sum, path) => sum + path.distanceMeters, 0), polyline, roads,
        tags: ['回到起点', preferenceLabels[request.preference], ...(repeatRatio > 0.22 ? ['部分折返'] : [])],
        warnings, source: 'amap', matchScore: durationScore(durationSeconds, request.minutes),
      });
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      errors.push(error);
      // Authentication/quota/transport failures will affect every candidate; don't spend more calls.
      if (error.statusCode !== 422) break;
    }
  }
  };
  await evaluate(candidates);
  // Calibrate once against an actual route instead of assuming city driving speed.
  // The same three bearings preserve exploration direction; only the radius changes.
  const bestInitial = closestRoute();
  if (bestInitial && Math.abs(bestInitial.durationSeconds - targetSeconds) > targetSeconds * 0.2
      && errors.every((error) => error.statusCode === 422) && Date.now() - startedAt < 33_000) {
    const radiusScale = Math.max(0.5, Math.min(1.8, targetSeconds / bestInitial.durationSeconds));
    try {
      const calibratedPools = await searchCandidates(request, limitedApi, radiusScale);
      const previousPairs = new Set(candidates.map((pair) => pair.map((place) => place.id).sort().join('|')));
      const straightLength = (pair: Place[]) => distanceBetween(request.origin.location, pair[0].location) + distanceBetween(pair[0].location, pair[1].location) + distanceBetween(pair[1].location, request.origin.location);
      const calibratedLength = straightLength(bestInitial.waypoints) * radiusScale;
      const calibratedPairs = selectWaypointPairs(calibratedPools, request, radiusScale)
        .filter((pair) => !previousPairs.has(pair.map((place) => place.id).sort().join('|')))
        .sort((a, b) => Math.abs(straightLength(a) - calibratedLength) - Math.abs(straightLength(b) - calibratedLength));
      await evaluate(calibratedPairs.slice(0, 2), true);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      errors.push(error);
    }
  }
  if (!routes.length) throw errors[0] ?? new ApiError('没有找到可用环线，请调整起点或偏好。', 422);
  const warnings = ['时长为各路段行进时间估计之和，不含停车、游览；实际路况与高德重新算路可能改变路线。'];
  if (request.mode === 'driving') warnings.push('暂未按车牌规避限行，出发前请在高德核对车辆及限行设置。');
  if (errors.length) warnings.push('部分候选未完成算路，仅展示已成功获取的路线。');
  const ranked = rankRoutes(routes, request);
  if (ranked.every((route) => Math.abs(route.durationSeconds - targetSeconds) > targetSeconds * 0.5)) {
    warnings.push('这次没有找到接近目标时长的环线，仅展示最接近的候选；建议换一批或调整起点、偏好。');
  } else if (ranked.every((route) => Math.abs(route.durationSeconds - targetSeconds) > targetSeconds * 0.2)) {
    warnings.push('本次有限候选中仍未找到目标时长 ±20% 以内的路线，已按实际时长接近程度排序，可换一批继续探索。');
  }
  return { routes: ranked, warnings, source: 'amap' };
}

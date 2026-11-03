import type { Coordinate, Place, PlanRequest, PlanResponse, Preference } from '../../shared/types';

export const DEMO_ORIGIN: Place = { id: 'hangzhou-balcony', name: '城市阳台', location: [120.212686, 30.242255], address: '杭州市上城区 · 钱江新城' };

const places: Record<string, Place> = {
  forest: { id: 'demo-forest', name: '钱江新城森林公园', location: [120.2208, 30.2517], address: '钱江新城（演示位置）' },
  century: { id: 'demo-century', name: '钱江世纪公园', location: [120.2381, 30.2392], address: '钱江世纪城（演示位置）' },
  river: { id: 'demo-river', name: '滨江公园', location: [120.2013, 30.2181], address: '钱塘江南岸（演示位置）' },
  lake: { id: 'demo-lake', name: '柳浪闻莺', location: [120.1568, 30.2386], address: '西湖东南岸（演示位置）' },
  bridge: { id: 'demo-bridge', name: '长桥公园', location: [120.1548, 30.2312], address: '西湖南岸（演示位置）' },
  civic: { id: 'demo-civic', name: '市民中心', location: [120.2128, 30.2471], address: '钱江新城（演示位置）' },
  theatre: { id: 'demo-theatre', name: '杭州大剧院', location: [120.2174, 30.2443], address: '钱江新城（演示位置）' },
  garden: { id: 'demo-garden', name: '波浪文化城', location: [120.2224, 30.2478], address: '钱江新城（演示位置）' },
};

const routeNames: Record<Preference, string[]> = {
  surprise: ['江风与城市之间', '去看看另一面的杭州', '把时间交给沿途'],
  park: ['在城市里找一片绿', '公园串起来的下午', '绕一圈，遇见绿意'],
  waterfront: ['沿着钱塘江吹吹风', '两岸之间，慢一点', '从江边到湖边'],
  elevated: ['换个高度看杭州', '城市天际线漫游', '穿过傍晚的车流'],
};

function illustrativeLine(points: Coordinate[], variant: number): Coordinate[] {
  const line: Coordinate[] = [];
  for (let segment = 0; segment < points.length - 1; segment++) {
    const a = points[segment], b = points[segment + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    for (let step = 0; step < 12; step++) {
      const t = step / 12;
      const bend = Math.sin(t * Math.PI) * (0.12 + variant * 0.025) * (segment % 2 ? -1 : 1);
      line.push([a[0] + dx * t - dy * bend, a[1] + dy * t + dx * bend]);
    }
  }
  return [...line, points[points.length - 1]];
}

export function createDemoPlan(request: PlanRequest): PlanResponse {
  const walk = request.mode === 'walking';
  const templates = walk
    ? [[places.civic, places.theatre], [places.theatre, places.garden], [places.forest, places.civic]]
    : request.preference === 'park'
      ? [[places.forest, places.century], [places.lake, places.bridge], [places.river, places.century]]
      : [[places.river, places.century], [places.forest, places.century], [places.lake, places.river]];
  const shift = Math.abs(request.seed % 3);
  const names = routeNames[request.preference];
  const routes = templates.map((_, index) => {
    const template = templates[(index + shift) % templates.length];
    const waypoints = template.map((place) => ({ ...place }));
    const minutes = Math.max(10, request.minutes + [-2, 6, -7][index]);
    const scenicPoints: Coordinate[] = !walk && index === 0
      ? [request.origin.location, [120.203, 30.233], waypoints[0].location, [120.223, 30.219], waypoints[1].location, [120.224, 30.255], request.origin.location]
      : [request.origin.location, ...waypoints.map((place) => place.location), request.origin.location];
    return {
      id: `demo-${request.seed}-${index}`, name: names[index],
      description: index === 0 ? '给自己一点没有目的地的时间。路过风景，再慢慢回到出发的地方。' : `经过${waypoints.map((place) => place.name).join('和')}，发现日常之外的杭州。`,
      mode: request.mode, durationSeconds: minutes * 60, distanceMeters: Math.round(minutes / 60 * (walk ? 4300 : 26_000)),
      origin: request.origin, waypoints, polyline: illustrativeLine(scenicPoints, index),
      roads: walk ? ['沿江步道（演示）', '城市绿道（演示）'] : request.preference === 'elevated' ? ['秋石高架路（演示）', '钱江路（演示）'] : ['钱江路（演示）', '之江路（演示）'],
      tags: ['回到起点', walk ? '城市散步' : '城市兜风', request.preference === 'park' ? '公园绿意' : request.preference === 'elevated' ? '高架偏好' : '沿途风景'],
      warnings: ['演示路线、坐标和指标仅用于体验交互，不代表可通行道路，也不能用于导航。', ...(request.preference === 'elevated' ? ['高架偏好仅是尝试，大路优先不保证驶上高架。'] : [])],
      source: 'demo' as const, matchScore: Math.max(0, Math.round(100 - Math.abs(minutes - request.minutes) / request.minutes * 100)),
    };
  });
  return { routes, source: 'demo', warnings: ['当前为杭州演示模式；配置高德 Key 后，将搜索真实途经点并按实际道路计算路线。'] };
}

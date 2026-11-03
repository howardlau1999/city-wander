import type { Coordinate, Place, PlanRequest, PlanResponse, Preference } from '../../shared/types';

export const DEMO_ORIGIN: Place = { id: 'hangzhou-balcony', name: '城市阳台', location: [120.212686, 30.242255], address: '杭州市上城区 · 钱江新城' };

const routeNames: Record<Preference, string[]> = {
  surprise: ['风景与城市之间', '去看看城市的另一面', '把时间交给沿途'],
  park: ['在城市里找一片绿', '公园串起来的下午', '绕一圈，遇见绿意'],
  waterfront: ['沿着水岸吹吹风', '与水相伴，慢一点', '去寻找水边的风景'],
  elevated: ['换个高度看城市', '城市天际线漫游', '穿过傍晚的车流'],
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
  // These points illustrate a loop near the selected origin; they are not POIs or roads.
  const radiusKm = Math.max(walk ? 0.25 : 1, request.minutes / 60 * (walk ? 4.3 : 26) / 5.5);
  const longitudeScale = Math.max(0.15, Math.cos(request.origin.location[1] * Math.PI / 180));
  const offset = (east: number, north: number): Coordinate => [
    request.origin.location[0] + east * radiusKm / (111.32 * longitudeScale),
    request.origin.location[1] + north * radiusKm / 111.32,
  ];
  const templates = [[[0.9, 0.65], [1.15, -0.55]], [[-0.6, 1.1], [-1.05, -0.3]], [[0.3, -1.1], [-0.9, -0.7]]];
  const pointNames: Record<Preference, string[]> = {
    surprise: ['街角小广场', '城市风景点'],
    park: ['绿意公园', '林荫花园'],
    waterfront: ['水岸步道', '临水平台'],
    elevated: ['城市观景点', '开阔大道旁'],
  };
  const shift = Math.abs(request.seed % 3);
  const names = routeNames[request.preference];
  const routes = templates.map((_, index) => {
    const template = templates[(index + shift) % templates.length];
    const waypoints: Place[] = template.map(([east, north], pointIndex) => ({
      id: `demo-point-${index}-${pointIndex}`, name: `${pointNames[request.preference][pointIndex]}（示意）`,
      location: offset(east, north), address: '虚构的演示地点，不代表实际场所',
      ...(request.origin.city ? { city: request.origin.city } : {}),
    }));
    const minutes = Math.max(10, request.minutes + [-2, 6, -7][index]);
    const scenicPoints: Coordinate[] = [request.origin.location, ...waypoints.map((place) => place.location), request.origin.location];
    return {
      id: `demo-${request.origin.location.join('-')}-${request.mode}-${request.preference}-${request.minutes}-${request.seed}-${index}`, name: names[index],
      description: index === 0 ? '给自己一点没有目的地的时间。路过风景，再慢慢回到出发的地方。' : `经过${waypoints.map((place) => place.name).join('和')}，体验一段城市漫游。`,
      mode: request.mode, durationSeconds: minutes * 60, distanceMeters: Math.round(minutes / 60 * (walk ? 4300 : 26_000)),
      origin: request.origin, waypoints, polyline: illustrativeLine(scenicPoints, index),
      roads: walk ? ['休闲步道（示意）', '城市绿道（示意）'] : request.preference === 'elevated' ? ['高架道路（示意）', '城市大道（示意）'] : ['城市道路（示意）'],
      tags: ['回到起点', walk ? '城市散步' : '城市兜风', request.preference === 'park' ? '公园绿意' : request.preference === 'elevated' ? '高架偏好' : '沿途风景'],
      warnings: ['演示路线、坐标和指标仅用于体验交互，不代表可通行道路，也不能用于导航。', ...(request.preference === 'elevated' ? ['高架偏好仅是尝试，大路优先不保证驶上高架。'] : [])],
      source: 'demo' as const, matchScore: Math.max(0, Math.round(100 - Math.abs(minutes - request.minutes) / request.minutes * 100)),
    };
  });
  return { routes, source: 'demo', warnings: ['当前为路线演示，图形不代表真实道路；配置高德 Key 后，将搜索所选起点周边的真实途经点并按实际道路计算路线。'] };
}

import type { Place, WanderRoute } from '../../shared/types';

function assertLiveRoute(route: WanderRoute): void {
  if (route.source !== 'amap') {
    throw new Error('演示路线不能用于导航，请先接入高德并生成真实路线。');
  }
  if (route.waypoints.length === 0) {
    throw new Error('环线至少需要一个途经点。');
  }
}

function coordinate(place: Place, axis: 0 | 1): string {
  const value = place.location[axis];
  const limit = axis === 0 ? 180 : 90;
  if (!Number.isFinite(value) || Math.abs(value) > limit) {
    throw new Error('路线包含无效坐标，请重新规划。');
  }
  return Number(value.toFixed(6)).toString();
}

// The URI APIs use delimiters inside decoded parameter values as well as URL encoding.
function placeName(place: Place): string {
  return place.name.replace(/[|,]/g, ' ').trim() || '途经点';
}

/** The planner stores all coordinates in GCJ-02, in longitude/latitude order. */
export function buildAppRouteUrl(route: WanderRoute, platform: 'android' | 'ios'): string {
  assertLiveRoute(route);
  const url = new URL(platform === 'ios' ? 'iosamap://path' : 'amapuri://route/plan/');
  const origin = route.origin;
  url.search = new URLSearchParams({
    sourceApplication: 'city-wander',
    slon: coordinate(origin, 0),
    slat: coordinate(origin, 1),
    sname: placeName(origin),
    dlon: coordinate(origin, 0),
    dlat: coordinate(origin, 1),
    dname: placeName(origin),
    dev: '0',
    t: route.mode === 'driving' ? '0' : '2',
    vian: String(route.waypoints.length),
    vialons: route.waypoints.map((point) => coordinate(point, 0)).join('|'),
    vialats: route.waypoints.map((point) => coordinate(point, 1)).join('|'),
    vianames: route.waypoints.map(placeName).join('|'),
  }).toString();
  // Do not send `m`: current Android and iOS clients use the user's local preference.
  return url.toString();
}

export function routeLegs(route: WanderRoute): { from: Place; to: Place }[] {
  const points = [route.origin, ...route.waypoints, route.origin];
  return points.slice(0, -1).map((from, index) => ({ from, to: points[index + 1] }));
}

/** Web URI supports only one driving via point: hand off each complete leg explicitly. */
export function buildLegWebUrl(route: WanderRoute, index: number): string {
  assertLiveRoute(route);
  const legs = routeLegs(route);
  if (!Number.isInteger(index) || index < 0 || index >= legs.length) {
    throw new Error('请选择有效的路线分段。');
  }
  const { from, to } = legs[index];
  const point = (place: Place) => `${coordinate(place, 0)},${coordinate(place, 1)},${placeName(place)}`;
  const url = new URL('https://uri.amap.com/navigation');
  url.search = new URLSearchParams({
    from: point(from),
    to: point(to),
    mode: route.mode === 'driving' ? 'car' : 'walk',
    src: 'city-wander',
    callnative: '1',
  }).toString();
  return url.toString();
}

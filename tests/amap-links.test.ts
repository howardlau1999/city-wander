import { describe, expect, it } from 'vitest';
import type { WanderRoute } from '../shared/types';
import { buildAppRouteUrl, buildLegWebUrl, routeLegs } from '../src/lib/amap-links';

const route: WanderRoute = {
  id: 'real-loop',
  name: '杭州环线',
  description: '',
  mode: 'driving',
  durationSeconds: 3600,
  distanceMeters: 20000,
  origin: { id: 'origin', name: '起点 & 杭州', location: [120.15507, 30.274084] },
  waypoints: [
    { id: 'p1', name: '公园|北门', location: [120.14, 30.26] },
    { id: 'p2', name: '滨江,入口', location: [120.18, 30.22] },
    { id: 'p3', name: '返回方向', location: [120.19, 30.28] },
  ],
  polyline: [],
  roads: [],
  tags: [],
  warnings: [],
  source: 'amap',
  matchScore: 90,
};

describe('高德路线交接', () => {
  it.each(['android', 'ios'] as const)('保留 %s 的全部有序途经点及返回起点', (platform) => {
    const url = new URL(buildAppRouteUrl(route, platform));
    expect(url.protocol).toBe(platform === 'ios' ? 'iosamap:' : 'amapuri:');
    expect(url.host).toBe(platform === 'ios' ? 'path' : 'route');
    expect(url.searchParams.get('vian')).toBe('3');
    expect(url.searchParams.get('vialons')).toBe('120.14|120.18|120.19');
    expect(url.searchParams.get('vialats')).toBe('30.26|30.22|30.28');
    expect(url.searchParams.get('vianames')).toBe('公园 北门|滨江 入口|返回方向');
    expect(url.searchParams.get('slon')).toBe(url.searchParams.get('dlon'));
    expect(url.searchParams.get('slat')).toBe(url.searchParams.get('dlat'));
    expect(url.searchParams.get('slon')).toBe('120.15507');
    expect(url.searchParams.get('slat')).toBe('30.274084');
    expect(url.searchParams.get('dev')).toBe('0');
    expect(url.searchParams.get('t')).toBe('0');
    expect(url.searchParams.has('m')).toBe(false);
  });

  it('步行使用步行模式，Web 交接每一段且不丢返程', () => {
    const walk = { ...route, mode: 'walking' as const };
    expect(new URL(buildAppRouteUrl(walk, 'ios')).searchParams.get('t')).toBe('2');
    const legs = routeLegs(walk);
    expect(legs).toHaveLength(4);
    expect(legs[0].from).toEqual(route.origin);
    expect(legs[3].to).toEqual(route.origin);
    legs.forEach((leg, index) => {
      const url = new URL(buildLegWebUrl(walk, index));
      expect(url.origin).toBe('https://uri.amap.com');
      expect(url.searchParams.get('mode')).toBe('walk');
      expect(url.searchParams.get('from')?.split(',').slice(0, 2).map(Number)).toEqual(leg.from.location);
      expect(url.searchParams.get('to')?.split(',').slice(0, 2).map(Number)).toEqual(leg.to.location);
      expect(url.searchParams.get('callnative')).toBe('1');
      expect(url.searchParams.has('via')).toBe(false);
    });
  });

  it('拒绝演示数据导航和非法分段', () => {
    const demo = { ...route, source: 'demo' as const };
    expect(() => buildAppRouteUrl(demo, 'android')).toThrow('演示路线');
    expect(() => buildLegWebUrl(demo, 0)).toThrow('演示路线');
    for (const index of [-1, 0.5, 4, NaN]) {
      expect(() => buildLegWebUrl(route, index)).toThrow('有效的路线分段');
    }
  });

  it('拒绝非有限坐标和没有途经点的退化环线', () => {
    const invalid = { ...route, origin: { ...route.origin, location: [NaN, 30] as [number, number] } };
    expect(() => buildAppRouteUrl(invalid, 'android')).toThrow('无效坐标');
    expect(() => buildLegWebUrl(invalid, 0)).toThrow('无效坐标');
    expect(() => buildAppRouteUrl({ ...route, waypoints: [] }, 'android')).toThrow('至少需要');
  });
});

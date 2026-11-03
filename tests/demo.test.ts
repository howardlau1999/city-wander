import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Coordinate, Place, PlanRequest } from '../shared/types';
import { createDemoPlan } from '../src/lib/demo';
import MapView from '../src/components/MapView';

const chengdu: Place = {
  id: 'chengdu-origin', name: '成都出发点', location: [104.066, 30.572],
  city: { name: '成都市', adcode: '510100', center: [104.066, 30.572] },
};
const request: PlanRequest = { origin: chengdu, mode: 'driving', minutes: 60, preference: 'park', seed: 42 };

function kmApart(a: Coordinate, b: Coordinate) {
  const north = (b[1] - a[1]) * 111.32;
  const east = (b[0] - a[0]) * 111.32 * Math.cos(a[1] * Math.PI / 180);
  return Math.hypot(north, east);
}

describe('city-neutral illustrative routes', () => {
  it.each<Coordinate>([[104.066, 30.572], [116.407, 39.904], [87.617, 43.792]])('keeps distant-city loops near their actual requested origin %s,%s', (lng, lat) => {
    const origin = { ...chengdu, location: [lng, lat] as Coordinate };
    const plan = createDemoPlan({ ...request, origin });
    expect(plan.source).toBe('demo');
    expect(plan.routes).toHaveLength(3);
    for (const route of plan.routes) {
      expect(route.source).toBe('demo');
      expect(route.origin).toBe(origin);
      expect(route.polyline[0]).toEqual(origin.location);
      expect(route.polyline.at(-1)).toEqual(origin.location);
      expect(route.polyline.every(point => kmApart(origin.location, point) < 10)).toBe(true);
      expect(route.waypoints.every(place => place.name.includes('示意'))).toBe(true);
      expect(route.warnings.join('')).toContain('不能用于导航');
      expect(JSON.stringify(route)).not.toMatch(/杭州|钱塘江|秋石高架|钱江路|之江路/);
    }
  });

  it('uses smaller local geometry for a walk and keeps city metadata for saved routes', () => {
    const plan = createDemoPlan({ ...request, mode: 'walking' });
    expect(plan.routes.every(route => route.polyline.every(point => kmApart(chengdu.location, point) < 2))).toBe(true);
    expect(plan.routes[0].waypoints[0].city).toEqual(chengdu.city);
  });

  it('does not reuse a saved-route identity when switching city with the same seed', () => {
    const second = createDemoPlan({ ...request, origin: { ...chengdu, location: [121.4737, 31.2304] } });
    expect(createDemoPlan(request).routes[0].id).not.toBe(second.routes[0].id);
  });

  it('shows an honest empty preview without labeling the city center as a departure', () => {
    const html = renderToStaticMarkup(createElement(MapView, {
      routes: [], selectedId: null, onSelect() {}, origin: chengdu,
      originConfirmed: false, config: null, fitKey: 1,
    }));
    expect(html).toContain('成都市');
    expect(html).toContain('尚未生成路线');
    expect(html).toContain('无道路底图');
    expect(html).not.toContain('出发 · 返回');
    expect(html).not.toContain('杭州');
    expect(html).not.toContain('路线 01');
  });
});

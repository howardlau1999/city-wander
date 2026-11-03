export type Coordinate = [number, number];
export type TravelMode = 'driving' | 'walking';
export type Preference = 'surprise' | 'park' | 'waterfront' | 'elevated';
export interface Place { id: string; name: string; location: Coordinate; address?: string }
export interface PlanRequest {
  origin: Place;
  mode: TravelMode;
  minutes: number;
  preference: Preference;
  seed: number;
}
export interface WanderRoute {
  id: string;
  name: string;
  description: string;
  mode: TravelMode;
  durationSeconds: number;
  distanceMeters: number;
  origin: Place;
  waypoints: Place[];
  polyline: Coordinate[];
  roads: string[];
  tags: string[];
  warnings: string[];
  source: 'amap' | 'demo';
  matchScore: number;
}
export interface PlanResponse { routes: WanderRoute[]; warnings: string[]; source: 'amap' | 'demo' }
export interface AppConfig { liveRouting: boolean; jsKey: string; securityJsCode: string }

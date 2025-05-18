// src/utils/mapUtils.ts
import { LngLatBounds } from 'mapbox-gl';
import type { DensityDataPoint, DiversityDataPoint, TimeWindow, DataSourceType, GeoJsonProperties } from '../types';

export const MAX_API_LEVEL = 5;
export const MIN_API_LEVEL = 0; // Updated to match backend (0-5)

export const TIME_WINDOWS: TimeWindow[] = [
  { id: 0, name: "Last 7 days", color: "#FF0000" }, // Red
  { id: 1, name: "7-14 days ago", color: "#FFFF00" }, // Yellow
  { id: 2, name: "14-30 days ago", color: "#00FF00" }, // Green
  { id: 3, name: "30-90 days ago", color: "#0000FF" }, // Blue
];

// Corresponds to DIVERSITY_RADII in backend (src/grid.js)
export const DIVERSITY_RADIUS_OPTIONS = [
  { id: 0, label: 'Radius S (0.00001°)', value: 0.00001 },
  { id: 1, label: 'Radius M (0.000025°)', value: 0.000025 },
  { id: 2, label: 'Radius L (0.00005°)', value: 0.00005 },
  { id: 3, label: 'Radius XL (0.0001°)', value: 0.0001 },
];
export const NUM_DIVERSITY_RADIUS_GROUPS = DIVERSITY_RADIUS_OPTIONS.length;

export const DIVERSITY_SCORE_INFO = TIME_WINDOWS.length >= 4 ? [
  { score: 1, name: "Score 1 (Lowest Diversity)", color: "#0000FF" }, // Blue
  { score: 2, name: "Score 2", color: "#00FF00" }, // Green
  { score: 3, name: "Score 3", color: "#FFFF00" }, // Yellow
  { score: 4, name: "Score 4 (Highest Diversity)", color: "#FF0000" }, // Red
] : [
  { score: 1, name: "Score 1", color: "#0000FF" },
  { score: 2, name: "Score 2", color: "#00FF00" },
  { score: 3, name: "Score 3", color: "#FFFF00" },
].slice(0, TIME_WINDOWS.length);


export function mapboxZoomToApiLevel(mapboxZoom: number): number {
  let level: number;
  // Adjusted zoom-to-level mapping to allow level 0
  if (mapboxZoom < 5) level = 0;       // Zoom < 5: Level 0
  else if (mapboxZoom < 8) level = 1;  // Zoom 5-7.99: Level 1
  else if (mapboxZoom < 11) level = 2; // Zoom 8-10.99: Level 2
  else if (mapboxZoom < 14) level = 3; // Zoom 11-13.99: Level 3
  else if (mapboxZoom < 17) level = 4; // Zoom 14-16.99: Level 4
  else level = MAX_API_LEVEL;          // Zoom >= 17: Level 5

  // Ensure the level is within the defined MIN/MAX API_LEVEL bounds
  return Math.max(MIN_API_LEVEL, Math.min(level, MAX_API_LEVEL));
}

export function calculateCellPolygon(
  point: DensityDataPoint | DiversityDataPoint,
  apiLevel: number
): GeoJSON.Feature<GeoJSON.Polygon, GeoJsonProperties> {
  const { lon, lat } = point;
  // Ensure apiLevel used for calculation is at least MIN_API_LEVEL (0)
  const effectiveApiLevel = Math.max(MIN_API_LEVEL, apiLevel);
  const halfDelta = (1 / Math.pow(10, effectiveApiLevel)) / 2;

  const minLon = lon - halfDelta;
  const maxLon = lon + halfDelta;
  const minLat = lat - halfDelta;
  const maxLat = lat + halfDelta;

  const properties = 'density' in point ? { density: point.density } : { score: point.score };

  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [minLon, maxLat], [maxLon, maxLat],
          [maxLon, minLat], [minLon, minLat],
          [minLon, maxLat],
        ],
      ],
    },
    properties: properties,
  };
}

export function createHeatmapPoints(
  points: Array<DensityDataPoint | DiversityDataPoint>
): GeoJSON.Feature<GeoJSON.Point, GeoJsonProperties>[] {
  return points.map(point => {
    const properties = 'density' in point ? { density: point.density } : { score: point.score };
    return {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [point.lon, point.lat],
      },
      properties: properties,
    };
  });
}


export function getMapboxOpacityExpression(dataSource: DataSourceType): mapboxgl.Expression {
  const propertyName = dataSource === 'density' ? 'density' : 'score';
  const maxValue = dataSource === 'density' ? 255 : TIME_WINDOWS.length;

  return ['+', 0.3, ['*', ['/', ['get', propertyName], maxValue], 0.7]];
}

export function getBoundsFromMap(map: mapboxgl.Map): LngLatBounds | null {
  if (!map || !map.isStyleLoaded()) return null;
  try {
    return map.getBounds();
  } catch (e) {
    console.warn("Could not get map bounds:", e);
    return null;
  }
}

export function debounce<F extends (...args: any[]) => any>(func: F, waitFor: number) {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const debounced = (...args: Parameters<F>) => {
    if (timeout !== null) {
      clearTimeout(timeout);
      timeout = null;
    }
    timeout = setTimeout(() => func(...args), waitFor);
  };
  return debounced as (...args: Parameters<F>) => void;
}
import { LngLatBounds } from 'mapbox-gl';
import type { DiversityDataPoint, GeoJsonProperties } from '../types';

export const MAX_API_LEVEL = 5;
export const MIN_API_LEVEL = 0;

export const MAX_DIVERSITY_SCORE = 4;

export const DIVERSITY_RADIUS_OPTIONS = [
  { id: 0, label: 'Radius S (0.00001°)', value: 0.00001 },
  { id: 1, label: 'Radius M (0.000025°)', value: 0.000025 },
  { id: 2, label: 'Radius L (0.00005°)', value: 0.00005 },
  { id: 3, label: 'Radius XL (0.0001°)', value: 0.0001 },
];
export const NUM_DIVERSITY_RADIUS_GROUPS = DIVERSITY_RADIUS_OPTIONS.length;

export const DIVERSITY_SCORE_INFO = [
  { score: 1, name: "Low (Score = 1)", color: "#0000FF" },
  { score: 2, name: "Moderate (Score = 2)", color: "#00FF00" },
  { score: 3, name: "High (Score = 3)", color: "#FFFF00" },
  { score: 4, name: "Very High (Score = 4)", color: "#FF0000" },
];

export function mapboxZoomToApiLevel(mapboxZoom: number): number {
  let level: number;
  if (mapboxZoom < 3) level = 0;
  else if (mapboxZoom < 6) level = 1;
  else if (mapboxZoom < 9) level = 2;
  else if (mapboxZoom < 12) level = 3;
  else if (mapboxZoom < 14) level = 4;
  else level = MAX_API_LEVEL;

  return Math.max(MIN_API_LEVEL, Math.min(level, MAX_API_LEVEL));
}

export function calculateCellPolygon(
  point: DiversityDataPoint,
  apiLevel: number
): GeoJSON.Feature<GeoJSON.Polygon, GeoJsonProperties> {
  const { lon, lat } = point;
  const effectiveApiLevel = Math.max(MIN_API_LEVEL, apiLevel);
  const halfDelta = (1 / Math.pow(10, effectiveApiLevel)) / 2;

  const minLon = lon - halfDelta;
  const maxLon = lon + halfDelta;
  const minLat = lat - halfDelta;
  const maxLat = lat + halfDelta;

  const properties = { score: point.score };

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
  points: Array<DiversityDataPoint>
): GeoJSON.Feature<GeoJSON.Point, GeoJsonProperties>[] {
  return points.map(point => {
    const properties = { score: point.score };
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

export function getMapboxOpacityExpression(): mapboxgl.Expression {
  const propertyName = 'score';
  const maxValue = MAX_DIVERSITY_SCORE;
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
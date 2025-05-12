import { LngLatBounds } from 'mapbox-gl';
import type { DensityPoint, TimeWindow } from '../types';

export const MAX_API_LEVEL = 5;
export const MIN_API_LEVEL = 1; // New constant for minimum API level

export const TIME_WINDOWS: TimeWindow[] = [
  { id: 0, name: "Last 7 days", color: "#FF0000" },
  { id: 1, name: "7-14 days ago", color: "#FFFF00" },
  { id: 2, name: "14-30 days ago", color: "#00FF00" },
  { id: 3, name: "30-90 days ago", color: "#0000FF" },
];

export function mapboxZoomToApiLevel(mapboxZoom: number): number {
  let level: number;
  if (mapboxZoom < 4) level = 1; // Was 0, now 1
  else if (mapboxZoom < 7) level = 1;
  else if (mapboxZoom < 10) level = 2;
  else if (mapboxZoom < 13) level = 3;
  else if (mapboxZoom < 16) level = 4;
  else level = MAX_API_LEVEL; // Stays 5

  return Math.max(MIN_API_LEVEL, level); // Ensure it's at least MIN_API_LEVEL
}

// ... rest of the functions (calculateCellPolygon, createHeatmapPoints, etc.) remain the same
export function calculateCellPolygon(
  point: DensityPoint,
  apiLevel: number
): GeoJSON.Feature<GeoJSON.Polygon, { density: number }> {
  const { lon, lat, density } = point;
  // Ensure apiLevel is not less than MIN_API_LEVEL if it's passed directly
  const effectiveApiLevel = Math.max(MIN_API_LEVEL, apiLevel);
  const halfDelta = (1 / Math.pow(10, effectiveApiLevel)) / 2;

  const minLon = lon - halfDelta;
  const maxLon = lon + halfDelta;
  const minLat = lat - halfDelta;
  const maxLat = lat + halfDelta;

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
    properties: {
      density: density,
    },
  };
}

export function createHeatmapPoints(
  points: DensityPoint[]
): GeoJSON.Feature<GeoJSON.Point, { density: number }>[] {
  return points.map(point => ({
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [point.lon, point.lat],
    },
    properties: {
      density: point.density,
    },
  }));
}


export function getMapboxOpacityExpression(): mapboxgl.Expression {
  return ['+', 0.3, ['*', ['/', ['get', 'density'], 255], 0.7]];
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
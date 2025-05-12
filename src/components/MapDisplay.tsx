import React, { useEffect, useRef, useState } from 'react';
// Corrected imports for Mapbox GL types
import mapboxgl, {
  LngLatBounds,
  Map,
  ErrorEvent // Specifically for the 'error' event
  // MapboxEvent removed as it's deprecated
} from 'mapbox-gl';
import type { DensityApiResponse, DisplayMode, DensitySourceType } from '../types';
import {
  debounce,
  calculateCellPolygon,
  createHeatmapPoints,
  getMapboxOpacityExpression,
  TIME_WINDOWS,
} from '../utils/mapUtils';
import '../styles/MapDisplay.css';
import type { ExpressionSpecification } from 'mapbox-gl';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

// ... (rest of the constants and interface remain the same) ...
const HEATMAP_MAX_OPACITY = 0.85;
const HEATMAP_MIN_OPACITY = 0.40;

const BASE_RADIUS_ZOOM_STOPS: Record<number, number> = {
  3: 10,
  7: 15,
  9: 20,
  12: 25,
  15: 20,
  18: 15,
};

const DENSITY_TO_RADIUS_MULTIPLIER_STOPS: Array<[number, number]> = [
  [0, 0.6],
  [50, 0.8],
  [150, 1.0],
  [255, 1.5],
];

interface MapDisplayProps {
  selectedTimeWindows: Set<number>;
  onMapIdle: (map: Map) => void;
  currentApiLevel: number;
  currentBounds: LngLatBounds | null;
  displayMode: DisplayMode;
  densitySource: DensitySourceType;
  heatmapRadiusScale: number;
}


const MapDisplay: React.FC<MapDisplayProps> = ({
  selectedTimeWindows,
  onMapIdle,
  currentApiLevel,
  currentBounds,
  displayMode,
  densitySource,
  heatmapRadiusScale,
}) => {
  // ... (refs and state remain the same) ...
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isMapLoaded, setIsMapLoaded] = useState<boolean>(false);

  const heatmapRadiusScaleRef = useRef(heatmapRadiusScale);
  useEffect(() => {
    heatmapRadiusScaleRef.current = heatmapRadiusScale;
  }, [heatmapRadiusScale]);

  const onMapIdleRef = useRef(onMapIdle);
  useEffect(() => {
    onMapIdleRef.current = onMapIdle;
  }, [onMapIdle]);

  const hexToRgb = (hex: string): string => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '0,0,0';
  };

  const getHeatmapRadiusExpression = (ageBasedRadiusMultiplier: number): ExpressionSpecification => {
    const densityRadiusMultiplierExpression: ExpressionSpecification = [
      'interpolate',
      ['linear'],
      ['get', 'density'],
    ];
    DENSITY_TO_RADIUS_MULTIPLIER_STOPS.forEach(([density, multiplier]) => {
      densityRadiusMultiplierExpression.push(density, multiplier);
    });

    const radiusExpression: ExpressionSpecification = ['interpolate', ['linear'], ['zoom']];

    Object.entries(BASE_RADIUS_ZOOM_STOPS).forEach(([zoomStr, baseRadiusAtZoom]) => {
      const zoom = parseFloat(zoomStr);
      radiusExpression.push(
        zoom,
        [
          '*',
          heatmapRadiusScaleRef.current,
          ageBasedRadiusMultiplier,
          baseRadiusAtZoom,
          densityRadiusMultiplierExpression
        ]
      );
    });
    return radiusExpression;
  };

  useEffect(() => {
    if (!MAPBOX_TOKEN) {
      console.error("MapDisplay: Mapbox token is not set. Cannot initialize map.");
      return;
    }
    if (mapRef.current || !mapContainerRef.current) {
      return;
    }

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-98.5795, 39.8283],
      zoom: 3,
    });
    mapRef.current = map;

    // Correctly typed error handler using ErrorEvent
    const mapErrorHandler = (e: ErrorEvent) => {
      // ErrorEvent is guaranteed to have an 'error' property
      console.error('Mapbox GL Error:', e.error?.message || e.error);
    };
    map.on('error', mapErrorHandler);


    const handleLoad = () => {
      setIsMapLoaded(true);
      onMapIdleRef.current(map);

      const timeWindowsForLayering = [...TIME_WINDOWS].reverse();

      timeWindowsForLayering.forEach(tw => {
        const sourceId = `source-${tw.id}`;
        if (!map.getSource(sourceId)) {
          map.addSource(sourceId, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });
        }

        const fillLayerId = `fill-layer-${tw.id}`;
        if (!map.getLayer(fillLayerId)) {
          map.addLayer({
            id: fillLayerId,
            type: 'fill',
            source: sourceId,
            paint: {
              'fill-color': tw.color,
              'fill-opacity': getMapboxOpacityExpression(),
              'fill-outline-color': 'rgba(0,0,0,0.1)',
            },
            layout: { visibility: 'none' }
          });
        }

        const heatmapLayerId = `heatmap-layer-${tw.id}`;
        if (!map.getLayer(heatmapLayerId)) {
          const numTimeWindows = TIME_WINDOWS.length;
          const ageFactor = numTimeWindows > 1 ? tw.id / (numTimeWindows - 1) : 0;
          const ageBasedRadiusMultiplier = 0.7 + ageFactor * 0.6;
          const intensityMultiplier = 1.2 - ageFactor * 0.4;
          const radiusExpr = getHeatmapRadiusExpression(ageBasedRadiusMultiplier);

          map.addLayer({
            id: heatmapLayerId,
            type: 'heatmap',
            source: sourceId,
            maxzoom: 20,
            paint: {
              'heatmap-weight': [
                'interpolate', ['linear'], ['get', 'density'],
                0, 0, 1, 0.01, 255, 1
              ],
              'heatmap-intensity': [
                'interpolate', ['linear'], ['zoom'],
                3, Math.max(0.1, 1 * intensityMultiplier),
                7, Math.max(0.1, 1.5 * intensityMultiplier),
                9, Math.max(0.2, 2 * intensityMultiplier),
                12, Math.max(0.3, 3 * intensityMultiplier),
                15, Math.max(0.5, 5 * intensityMultiplier),
                18, Math.max(0.8, 8 * intensityMultiplier)
              ],
              'heatmap-color': [
                'interpolate', ['linear'], ['heatmap-density'],
                0, 'rgba(0,0,0,0)',
                0.05, `rgba(${hexToRgb(tw.color)}, 0.05)`,
                0.2, `rgba(${hexToRgb(tw.color)}, 0.2)`,
                0.4, `rgba(${hexToRgb(tw.color)}, 0.4)`,
                0.6, `rgba(${hexToRgb(tw.color)}, 0.6)`,
                0.8, `rgba(${hexToRgb(tw.color)}, 0.8)`,
                1, `rgba(${hexToRgb(tw.color)}, 1)`
              ],
              'heatmap-radius': radiusExpr,
              'heatmap-opacity': 0,
            }
          });
        }
      });
      updateLayerVisibility(map, displayMode, selectedTimeWindows);
    };

    const debouncedMapIdleHandler = debounce(() => {
      if (mapRef.current) onMapIdleRef.current(mapRef.current);
    }, 500);

    map.on('load', handleLoad);
    map.on('moveend', debouncedMapIdleHandler);
    map.on('zoomend', debouncedMapIdleHandler);

    return () => {
      map.off('load', handleLoad);
      map.off('moveend', debouncedMapIdleHandler);
      map.off('zoomend', debouncedMapIdleHandler);
      map.off('error', mapErrorHandler);
      if (mapRef.current) mapRef.current.remove();
      mapRef.current = null;
      setIsMapLoaded(false);
    };
  }, []);

  // ... (rest of the useEffects and updateLayerVisibility function remain the same) ...
  useEffect(() => {
    if (!isMapLoaded || !mapRef.current || displayMode !== 'heatmap') {
      return;
    }
    const map = mapRef.current;

    TIME_WINDOWS.forEach(tw => {
      const heatmapLayerId = `heatmap-layer-${tw.id}`;
      if (map.getLayer(heatmapLayerId)) {
        const numTimeWindows = TIME_WINDOWS.length;
        const ageFactor = numTimeWindows > 1 ? tw.id / (numTimeWindows - 1) : 0;
        const ageBasedRadiusMultiplier = 0.7 + ageFactor * 0.6;
        const newRadiusExpr = getHeatmapRadiusExpression(ageBasedRadiusMultiplier);
        map.setPaintProperty(heatmapLayerId, 'heatmap-radius', newRadiusExpr);
      }
    });
  }, [heatmapRadiusScale, isMapLoaded, displayMode]);


  const updateLayerVisibility = (
    map: Map,
    currentDisplayMode: DisplayMode,
    currentSelectedTimeWindows: Set<number>
  ) => {
    const numTimeWindows = TIME_WINDOWS.length;
    TIME_WINDOWS.forEach(tw => {
      const fillLayerId = `fill-layer-${tw.id}`;
      const heatmapLayerId = `heatmap-layer-${tw.id}`;
      const isSelected = currentSelectedTimeWindows.has(tw.id);

      let fillVisibility: 'visible' | 'none' = 'none';
      if (isSelected && currentDisplayMode === 'fill') {
        fillVisibility = 'visible';
      }
      if (map.getLayer(fillLayerId)) {
        map.setLayoutProperty(fillLayerId, 'visibility', fillVisibility);
      }

      let heatmapVisibility: 'visible' | 'none' = 'none';
      let heatmapOpacityValue = 0;
      if (isSelected && currentDisplayMode === 'heatmap') {
        heatmapVisibility = 'visible';
        if (numTimeWindows <= 1) heatmapOpacityValue = HEATMAP_MAX_OPACITY;
        else {
          const factor = tw.id / (numTimeWindows - 1);
          heatmapOpacityValue = HEATMAP_MAX_OPACITY - factor * (HEATMAP_MAX_OPACITY - HEATMAP_MIN_OPACITY);
        }
        heatmapOpacityValue = Math.max(numTimeWindows > 1 ? HEATMAP_MIN_OPACITY : HEATMAP_MAX_OPACITY, Math.min(heatmapOpacityValue, HEATMAP_MAX_OPACITY));
        if (numTimeWindows > 1) {
          if (tw.id === numTimeWindows - 1) heatmapOpacityValue = HEATMAP_MIN_OPACITY;
          if (tw.id === 0) heatmapOpacityValue = HEATMAP_MAX_OPACITY;
        }
      }
      if (map.getLayer(heatmapLayerId)) {
        map.setLayoutProperty(heatmapLayerId, 'visibility', heatmapVisibility);
        map.setPaintProperty(heatmapLayerId, 'heatmap-opacity', heatmapOpacityValue);
      }
    });
  };

  useEffect(() => {
    if (!isMapLoaded || !mapRef.current) return;
    updateLayerVisibility(mapRef.current, displayMode, selectedTimeWindows);
  }, [displayMode, selectedTimeWindows, isMapLoaded]);

  useEffect(() => {
    if (!isMapLoaded || !mapRef.current || !currentBounds) {
      return;
    }

    const map = mapRef.current;
    const activePromises: Promise<void>[] = [];
    let anyWindowSelectedAndVisible = false;

    TIME_WINDOWS.forEach((timeWindow) => {
      const sourceId = `source-${timeWindow.id}`;
      const isSelected = selectedTimeWindows.has(timeWindow.id);
      const isLayerVisibleForCurrentMode = (displayMode === 'fill' || displayMode === 'heatmap');

      if (!isSelected || !isLayerVisibleForCurrentMode) {
        const source = map.getSource(sourceId) as mapboxgl.GeoJSONSource;
        if (source?.setData) source.setData({ type: 'FeatureCollection', features: [] });
        return;
      }
      anyWindowSelectedAndVisible = true;

      const promise = (async () => {
        try {
          const params = new URLSearchParams();
          params.set('time_window_id', timeWindow.id.toString());
          params.set('level', currentApiLevel.toString());
          params.set('min_lon', currentBounds.getWest().toString());
          params.set('min_lat', currentBounds.getSouth().toString());
          params.set('max_lon', currentBounds.getEast().toString());
          params.set('max_lat', currentBounds.getNorth().toString());

          const apiEndpoint = densitySource === 'scaled' && displayMode === 'heatmap'
            ? '/api/density-scaled'
            : '/api/density';

          const response = await fetch(`${apiEndpoint}?${params.toString()}`);

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API Error (${apiEndpoint}): ${response.status} ${response.statusText} - ${errorText}`);
          }
          const data: DensityApiResponse = await response.json();

          let features: GeoJSON.Feature[] = [];
          if (displayMode === 'fill') {
            features = data.map(point => calculateCellPolygon(point, currentApiLevel));
          } else {
            features = createHeatmapPoints(data);
          }

          const newGeoJson: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
          const source = map.getSource(sourceId) as mapboxgl.GeoJSONSource;
          if (source?.setData) {
            source.setData(newGeoJson);
          }
        } catch (error) {
          const source = map.getSource(sourceId) as mapboxgl.GeoJSONSource;
          if (source?.setData) source.setData({ type: 'FeatureCollection', features: [] });
        }
      })();
      activePromises.push(promise);
    });

    if (anyWindowSelectedAndVisible && activePromises.length > 0) {
      setIsLoading(true);
      Promise.all(activePromises).finally(() => {
        setIsLoading(false);
      });
    } else {
      setIsLoading(false);
    }
  }, [selectedTimeWindows, currentApiLevel, currentBounds, isMapLoaded, displayMode, densitySource]);


  return (
    <div className="map-container-wrapper">
      {isLoading && <div className="loading-overlay">Loading Data...</div>}
      <div ref={mapContainerRef} className="map-container" />
    </div>
  );
};

export default MapDisplay;
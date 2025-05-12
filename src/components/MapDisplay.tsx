import React, { useEffect, useRef, useState } from 'react';
import mapboxgl, { LngLatBounds, Map } from 'mapbox-gl';
import type { DensityApiResponse, DisplayMode } from '../types';
import {
  debounce,
  calculateCellPolygon,
  createHeatmapPoints,
  getMapboxOpacityExpression,
  TIME_WINDOWS, // Import TIME_WINDOWS to access its length and properties
  // MIN_API_LEVEL, // Not directly used here, but currentApiLevel prop will respect it
} from '../utils/mapUtils';
import '../styles/MapDisplay.css';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

// Define opacity parameters for heatmap layers
const HEATMAP_MAX_OPACITY = 0.85; // Opacity for the newest time window
const HEATMAP_MIN_OPACITY = 0.40; // Opacity for the oldest time window

interface MapDisplayProps {
  selectedTimeWindows: Set<number>;
  onMapIdle: (map: Map) => void;
  currentApiLevel: number; // This will be >= MIN_API_LEVEL from App.tsx
  currentBounds: LngLatBounds | null;
  displayMode: DisplayMode;
}

const MapDisplay: React.FC<MapDisplayProps> = ({
  selectedTimeWindows,
  onMapIdle,
  currentApiLevel, // Will be >= 1
  currentBounds,
  displayMode,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isMapLoaded, setIsMapLoaded] = useState<boolean>(false);

  const onMapIdleRef = useRef(onMapIdle);
  useEffect(() => {
    onMapIdleRef.current = onMapIdle;
  }, [onMapIdle]);

  const hexToRgb = (hex: string): string => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '0,0,0';
  };


  // Effect for map initialization
  useEffect(() => {
    if (!MAPBOX_TOKEN) {
      console.error("Mapbox token is not set. Cannot initialize map.");
      // Optionally, set an error state to inform the user in the UI
      return;
    }
    if (mapRef.current || !mapContainerRef.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-98.5795, 39.8283],
      zoom: 3,
    });
    mapRef.current = map;

    const handleLoad = () => {
      setIsMapLoaded(true);
      onMapIdleRef.current(map);

      const timeWindowsForLayering = [...TIME_WINDOWS].reverse(); // Layers added from oldest to newest for correct overlap if needed

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
          map.addLayer({
            id: heatmapLayerId,
            type: 'heatmap',
            source: sourceId,
            maxzoom: 20,
            paint: {
              'heatmap-weight': [
                'interpolate',
                ['linear'],
                ['get', 'density'],
                0, 0,
                1, 0.1,
                255, 1
              ],
              'heatmap-intensity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                3, 1,
                7, 1.5,
                9, 2,
                12, 3,
                15, 5,
                18, 8
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
              'heatmap-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                3, 15,
                7, 20,
                9, 25,
                12, 30,
                15, 25,
                18, 20
              ],
              'heatmap-opacity': 0, // Initial: managed by visibility effect
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
      if (mapRef.current) mapRef.current.remove();
      mapRef.current = null;
      setIsMapLoaded(false);
    };
  }, []);


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

      if (map.getLayer(fillLayerId)) {
        map.setLayoutProperty(fillLayerId, 'visibility', (isSelected && currentDisplayMode === 'fill') ? 'visible' : 'none');
      }
      if (map.getLayer(heatmapLayerId)) {
        map.setLayoutProperty(heatmapLayerId, 'visibility', (isSelected && currentDisplayMode === 'heatmap') ? 'visible' : 'none');

        let heatmapOpacity = 0;
        if (isSelected && currentDisplayMode === 'heatmap') {
          if (numTimeWindows <= 1) {
            heatmapOpacity = HEATMAP_MAX_OPACITY;
          } else {
            // tw.id is 0 for newest, up to (numTimeWindows - 1) for oldest.
            // Calculate a factor from 0 (newest) to 1 (oldest).
            const factor = tw.id / (numTimeWindows - 1);
            // Interpolate opacity between MAX and MIN.
            heatmapOpacity = HEATMAP_MAX_OPACITY - factor * (HEATMAP_MAX_OPACITY - HEATMAP_MIN_OPACITY);
          }
          // Clamp to ensure opacity is within [MIN_OPACITY, MAX_OPACITY] range,
          // and also handle cases where MIN_OPACITY might be 0.
          heatmapOpacity = Math.max(
            numTimeWindows > 1 ? HEATMAP_MIN_OPACITY : HEATMAP_MAX_OPACITY, // ensure min is respected unless it's the only layer
            Math.min(heatmapOpacity, HEATMAP_MAX_OPACITY)
          );
          if (tw.id === (numTimeWindows - 1) && numTimeWindows > 1) heatmapOpacity = HEATMAP_MIN_OPACITY; // Explicitly set for oldest
          if (tw.id === 0 && numTimeWindows > 1) heatmapOpacity = HEATMAP_MAX_OPACITY; // Explicitly set for newest
        }
        map.setPaintProperty(heatmapLayerId, 'heatmap-opacity', heatmapOpacity);
      }
    });
  };

  useEffect(() => {
    if (!isMapLoaded || !mapRef.current) return;
    updateLayerVisibility(mapRef.current, displayMode, selectedTimeWindows);
  }, [displayMode, selectedTimeWindows, isMapLoaded]);

  // Data fetching effect
  useEffect(() => {
    if (!isMapLoaded || !mapRef.current || !currentBounds) {
      setIsLoading(false);
      return;
    }

    const map = mapRef.current;
    const activePromises: Promise<void>[] = [];

    TIME_WINDOWS.forEach((timeWindow) => {
      const sourceId = `source-${timeWindow.id}`;

      if (!selectedTimeWindows.has(timeWindow.id)) {
        const source = map.getSource(sourceId) as mapboxgl.GeoJSONSource;
        if (source && source.setData) {
          source.setData({ type: 'FeatureCollection', features: [] });
        }
        return;
      }

      const promise = (async () => {
        try {
          const params = new URLSearchParams();
          params.set('time_window_id', timeWindow.id.toString());
          params.set('level', currentApiLevel.toString());
          params.set('min_lon', currentBounds.getWest().toString());
          params.set('min_lat', currentBounds.getSouth().toString());
          params.set('max_lon', currentBounds.getEast().toString());
          params.set('max_lat', currentBounds.getNorth().toString());


          const response = await fetch(`/api/density?${params.toString()}`);
          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API Error: ${response.status} ${response.statusText} - ${errorText}`);
          }
          const data: DensityApiResponse = await response.json();

          let features: GeoJSON.Feature[] = [];
          if (displayMode === 'fill') {
            features = data.map(point => calculateCellPolygon(point, currentApiLevel));
          } else {
            features = createHeatmapPoints(data);
          }

          const newGeoJson: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features: features,
          };

          const source = map.getSource(sourceId) as mapboxgl.GeoJSONSource;
          if (source && source.setData) {
            source.setData(newGeoJson);
          }
        } catch (error) {
          console.error(`Failed to fetch data for TW ${timeWindow.id} (Level ${currentApiLevel}):`, error);
          const source = map.getSource(sourceId) as mapboxgl.GeoJSONSource;
          if (source && source.setData) source.setData({ type: 'FeatureCollection', features: [] });
        }
      })();
      activePromises.push(promise);
    });

    if (activePromises.length > 0) {
      setIsLoading(true);
      Promise.all(activePromises).finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, [selectedTimeWindows, currentApiLevel, currentBounds, isMapLoaded, displayMode]); // Removed mapRef from dependencies as it's stable

  return (
    <div className="map-container-wrapper">
      {isLoading && <div className="loading-overlay">Loading Data...</div>}
      <div ref={mapContainerRef} className="map-container" />
    </div>
  );
};

export default MapDisplay;
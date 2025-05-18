import React, { useEffect, useRef, useState } from 'react';
import mapboxgl, { LngLatBounds, Map, ErrorEvent, GeoJSONSource, type ExpressionSpecification } from 'mapbox-gl';
// Import the new type from types
import type { ApiDensityResponse, ApiDiversityResponse, DisplayMode, DataSourceType, DiversityHeatmapRenderMode } from '../types';
import {
  debounce,
  calculateCellPolygon,
  createHeatmapPoints,
  getMapboxOpacityExpression,
  TIME_WINDOWS,
  DIVERSITY_SCORE_INFO,
} from '../utils/mapUtils';
import '../styles/MapDisplay.css';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

const HEATMAP_RELATIVE_MAX_OPACITY = 0.85;
const HEATMAP_RELATIVE_MIN_OPACITY = 0.40;

const BASE_RADIUS_ZOOM_STOPS: Record<number, number> = { 3: 10, 7: 15, 9: 20, 12: 25, 15: 20, 18: 15 };
const DENSITY_VALUE_TO_RADIUS_MULTIPLIER_STOPS: Array<[number, number]> = [[0, 0.6], [50, 0.8], [150, 1.0], [255, 1.5]];
const SCORE_VALUE_TO_RADIUS_MULTIPLIER_STOPS: Array<[number, number]> = [
  [0, 0.6], [1, 0.8], [Math.ceil(TIME_WINDOWS.length / 2), 1.0], [TIME_WINDOWS.length, 1.5],
];

const errHandler = (e: ErrorEvent) => {
  console.error('Mapbox GL Error:', e.error?.message || e.error, e); // Log the full event for more details
};


interface MapDisplayProps {
  selectedTimeWindows: Set<number>;
  selectedDiversityScores: Set<number>;
  onMapIdle: (map: Map) => void;
  currentApiLevel: number;
  currentBounds: LngLatBounds | null;
  displayMode: DisplayMode;
  dataSource: DataSourceType;
  selectedRadiusGroupId: number;
  heatmapRadiusScale: number;
  heatmapOpacity: number;
  diversityHeatmapRenderMode: DiversityHeatmapRenderMode;
  initialCenter?: [number, number];
}

const MapDisplay: React.FC<MapDisplayProps> = ({
  selectedTimeWindows,
  selectedDiversityScores,
  onMapIdle,
  currentApiLevel,
  currentBounds,
  displayMode,
  dataSource,
  selectedRadiusGroupId,
  heatmapRadiusScale,
  heatmapOpacity,
  diversityHeatmapRenderMode,
  initialCenter,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isMapLoaded, setIsMapLoaded] = useState<boolean>(false);

  const heatmapRadiusScaleRef = useRef(heatmapRadiusScale);
  useEffect(() => { heatmapRadiusScaleRef.current = heatmapRadiusScale; }, [heatmapRadiusScale]);

  const heatmapOpacityRef = useRef(heatmapOpacity);
  useEffect(() => { heatmapOpacityRef.current = heatmapOpacity; }, [heatmapOpacity]);

  const onMapIdleRef = useRef(onMapIdle);
  useEffect(() => { onMapIdleRef.current = onMapIdle; }, [onMapIdle]);

  const hexToRgb = (hex: string): string => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '0,0,0';
  };

  const getHeatmapRadiusExpression = (ageBasedRadiusMultiplier: number, currentDataSource: DataSourceType): ExpressionSpecification => {
    const propertyName = currentDataSource === 'density' ? 'density' : 'score';
    const valueToRadiusStops = currentDataSource === 'density' ? DENSITY_VALUE_TO_RADIUS_MULTIPLIER_STOPS : SCORE_VALUE_TO_RADIUS_MULTIPLIER_STOPS;
    const valueRadiusMultiplierExpression: ExpressionSpecification = ['interpolate', ['linear'], ['get', propertyName]];
    valueToRadiusStops.forEach(([value, multiplier]) => valueRadiusMultiplierExpression.push(value, multiplier));
    const radiusExpression: ExpressionSpecification = ['interpolate', ['linear'], ['zoom']];
    Object.entries(BASE_RADIUS_ZOOM_STOPS).forEach(([zoomStr, baseRadiusAtZoom]) => {
      radiusExpression.push(parseFloat(zoomStr), ['*', heatmapRadiusScaleRef.current, ageBasedRadiusMultiplier, baseRadiusAtZoom, valueRadiusMultiplierExpression]);
    });
    return radiusExpression;
  };

  // Initial map setup
  useEffect(() => {
    if (!MAPBOX_TOKEN || mapRef.current || !mapContainerRef.current) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: initialCenter || [-98.5795, 39.8283],
      zoom: initialCenter ? 4 : 3, // Adjusted zoom: 4 if centered, 3 otherwise (continent view)
    });
    mapRef.current = map;
    map.on('error', errHandler);

    const handleLoad = () => {
      setIsMapLoaded(true);
      onMapIdleRef.current(map);

      // Density layers (per time window)
      [...TIME_WINDOWS].reverse().forEach(tw => {
        const sourceId = `source-density-${tw.id}`;
        if (!map.getSource(sourceId)) {
          map.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        }
        if (!map.getLayer(`fill-layer-density-${tw.id}`)) {
          map.addLayer({ id: `fill-layer-density-${tw.id}`, type: 'fill', source: sourceId, paint: { 'fill-color': tw.color, 'fill-opacity': 0, 'fill-outline-color': 'rgba(0,0,0,0.1)' }, layout: { visibility: 'none' } });
        }
        if (!map.getLayer(`heatmap-layer-density-${tw.id}`)) {
          map.addLayer({
            id: `heatmap-layer-density-${tw.id}`, type: 'heatmap', source: sourceId, maxzoom: 20,
            paint: {
              'heatmap-weight': 1, 'heatmap-intensity': 1,
              'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.05, `rgba(${hexToRgb(tw.color)},0.05)`, 0.2, `rgba(${hexToRgb(tw.color)},0.2)`, 0.4, `rgba(${hexToRgb(tw.color)},0.4)`, 0.6, `rgba(${hexToRgb(tw.color)},0.6)`, 0.8, `rgba(${hexToRgb(tw.color)},0.8)`, 1, `rgba(${hexToRgb(tw.color)},1)`],
              'heatmap-radius': 10, 'heatmap-opacity': 0,
            }, layout: { visibility: 'none' }
          });
        }
      });

      // Single source for all diversity data
      if (!map.getSource('source-diversity')) {
        map.addSource('source-diversity', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      }

      // Diversity Fill Layers (per-score)
      DIVERSITY_SCORE_INFO.forEach(dsi => {
        const score = dsi.score;
        const color = dsi.color;
        const fillLayerId = `fill-layer-diversity-${score}`;
        if (!map.getLayer(fillLayerId)) {
          map.addLayer({
            id: fillLayerId, type: 'fill', source: 'source-diversity',
            paint: { 'fill-color': color, 'fill-opacity': 0, 'fill-outline-color': 'rgba(0,0,0,0.1)' },
            layout: { visibility: 'none' }, filter: ['==', ['get', 'score'], score]
          });
        }
      });

      // Diversity Heatmap Layer (Stacked)
      const stackedHeatmapLayerId = 'heatmap-layer-diversity-stacked';
      if (!map.getLayer(stackedHeatmapLayerId)) {
        map.addLayer({
          id: stackedHeatmapLayerId, type: 'heatmap', source: 'source-diversity', maxzoom: 20,
          paint: {
            'heatmap-weight': ['interpolate', ['linear'], ['get', 'score'], 0, 0, 1, 0.25, 2, 0.5, 3, 0.75, TIME_WINDOWS.length, 1],
            'heatmap-intensity': 1,
            'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
              0, 'rgba(0,0,0,0)',
              0.25, DIVERSITY_SCORE_INFO.find(s => s.score === 1)?.color || '#0000FF',
              0.5, DIVERSITY_SCORE_INFO.find(s => s.score === 2)?.color || '#00FF00',
              0.75, DIVERSITY_SCORE_INFO.find(s => s.score === 3)?.color || '#FFFF00',
              1, DIVERSITY_SCORE_INFO.find(s => s.score === 4)?.color || '#FF0000'
            ],
            'heatmap-radius': 10, 'heatmap-opacity': 0,
          }, layout: { visibility: 'none' }
        });
      }

      // Diversity Heatmap Layers (Per-Score)
      DIVERSITY_SCORE_INFO.forEach(dsi => {
        const score = dsi.score;
        const color = dsi.color;
        const perScoreHeatmapLayerId = `heatmap-layer-diversity-per-score-${score}`;
        if (!map.getLayer(perScoreHeatmapLayerId)) {
          map.addLayer({
            id: perScoreHeatmapLayerId, type: 'heatmap', source: 'source-diversity', maxzoom: 20,
            paint: {
              'heatmap-weight': 1,
              'heatmap-intensity': 1,
              'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
                0, 'rgba(0,0,0,0)',
                0.1, `rgba(${hexToRgb(color)},0.1)`, 0.3, `rgba(${hexToRgb(color)},0.3)`,
                0.5, `rgba(${hexToRgb(color)},0.5)`, 0.7, `rgba(${hexToRgb(color)},0.7)`,
                1, `rgba(${hexToRgb(color)},1)`
              ],
              'heatmap-radius': 10, 'heatmap-opacity': 0,
            },
            layout: { visibility: 'none' }, filter: ['==', ['get', 'score'], score]
          });
        }
      });
    };

    const debouncedMapIdleHandler = debounce(() => { if (mapRef.current) onMapIdleRef.current(mapRef.current); }, 500);
    map.on('load', handleLoad);
    map.on('moveend', debouncedMapIdleHandler);
    map.on('zoomend', debouncedMapIdleHandler);

    return () => {
      map.off('load', handleLoad); map.off('moveend', debouncedMapIdleHandler); map.off('zoomend', debouncedMapIdleHandler); map.off('error', errHandler);
      if (mapRef.current) {
        const currentMap = mapRef.current;
        TIME_WINDOWS.forEach(tw => {
          if (currentMap.getLayer(`fill-layer-density-${tw.id}`)) currentMap.removeLayer(`fill-layer-density-${tw.id}`);
          if (currentMap.getLayer(`heatmap-layer-density-${tw.id}`)) currentMap.removeLayer(`heatmap-layer-density-${tw.id}`);
          if (currentMap.getSource(`source-density-${tw.id}`)) currentMap.removeSource(`source-density-${tw.id}`);
        });
        DIVERSITY_SCORE_INFO.forEach(dsi => {
          if (currentMap.getLayer(`fill-layer-diversity-${dsi.score}`)) currentMap.removeLayer(`fill-layer-diversity-${dsi.score}`);
          if (currentMap.getLayer(`heatmap-layer-diversity-per-score-${dsi.score}`)) currentMap.removeLayer(`heatmap-layer-diversity-per-score-${dsi.score}`);
        });
        if (currentMap.getLayer('heatmap-layer-diversity-stacked')) currentMap.removeLayer('heatmap-layer-diversity-stacked');
        if (currentMap.getSource('source-diversity')) currentMap.removeSource('source-diversity');
        currentMap.remove();
      }
      mapRef.current = null; setIsMapLoaded(false);
    };
  }, [initialCenter]);

  // Effect for updating layer visibility and paint properties
  useEffect(() => {
    if (!isMapLoaded || !mapRef.current) return;
    const map = mapRef.current;
    const numTimeWindows = TIME_WINDOWS.length;

    TIME_WINDOWS.forEach(tw => {
      if (map.getLayer(`fill-layer-density-${tw.id}`)) map.setLayoutProperty(`fill-layer-density-${tw.id}`, 'visibility', 'none');
      if (map.getLayer(`heatmap-layer-density-${tw.id}`)) map.setLayoutProperty(`heatmap-layer-density-${tw.id}`, 'visibility', 'none');
    });
    DIVERSITY_SCORE_INFO.forEach(dsi => {
      if (map.getLayer(`fill-layer-diversity-${dsi.score}`)) map.setLayoutProperty(`fill-layer-diversity-${dsi.score}`, 'visibility', 'none');
      if (map.getLayer(`heatmap-layer-diversity-per-score-${dsi.score}`)) map.setLayoutProperty(`heatmap-layer-diversity-per-score-${dsi.score}`, 'visibility', 'none');
    });
    if (map.getLayer('heatmap-layer-diversity-stacked')) map.setLayoutProperty('heatmap-layer-diversity-stacked', 'visibility', 'none');

    if (dataSource === 'density') {
      TIME_WINDOWS.forEach(tw => {
        const isSelected = selectedTimeWindows.has(tw.id);
        if (!isSelected) return;
        const fillLayerId = `fill-layer-density-${tw.id}`;
        const heatmapLayerId = `heatmap-layer-density-${tw.id}`;
        const fillVisible = displayMode === 'fill';
        const heatmapVisible = displayMode === 'heatmap';
        if (map.getLayer(fillLayerId)) map.setLayoutProperty(fillLayerId, 'visibility', fillVisible ? 'visible' : 'none');
        if (map.getLayer(heatmapLayerId)) map.setLayoutProperty(heatmapLayerId, 'visibility', heatmapVisible ? 'visible' : 'none');
        if (fillVisible && map.getLayer(fillLayerId)) {
          map.setPaintProperty(fillLayerId, 'fill-opacity', getMapboxOpacityExpression('density'));
        }
        if (heatmapVisible && map.getLayer(heatmapLayerId)) {
          let relativeOpacity = HEATMAP_RELATIVE_MAX_OPACITY;
          if (numTimeWindows > 1) {
            const factor = tw.id / (numTimeWindows - 1);
            relativeOpacity = HEATMAP_RELATIVE_MAX_OPACITY - factor * (HEATMAP_RELATIVE_MAX_OPACITY - HEATMAP_RELATIVE_MIN_OPACITY);
            relativeOpacity = Math.max(HEATMAP_RELATIVE_MIN_OPACITY, Math.min(relativeOpacity, HEATMAP_RELATIVE_MAX_OPACITY));
            if (tw.id === numTimeWindows - 1) relativeOpacity = HEATMAP_RELATIVE_MIN_OPACITY;
            if (tw.id === 0) relativeOpacity = HEATMAP_RELATIVE_MAX_OPACITY;
          }
          map.setPaintProperty(heatmapLayerId, 'heatmap-opacity', relativeOpacity * heatmapOpacityRef.current);
          map.setPaintProperty(heatmapLayerId, 'heatmap-weight', ['interpolate', ['linear'], ['get', 'density'], 0, 0, 1, 0.01, 255, 1]);
          const ageFactor = numTimeWindows > 1 ? tw.id / (numTimeWindows - 1) : 0;
          const ageRadiusMult = 0.7 + ageFactor * 0.6;
          const intensityMult = 1.2 - ageFactor * 0.4;
          map.setPaintProperty(heatmapLayerId, 'heatmap-radius', getHeatmapRadiusExpression(ageRadiusMult, 'density'));
          map.setPaintProperty(heatmapLayerId, 'heatmap-intensity', ['interpolate', ['linear'], ['zoom'], 3, Math.max(0.1, 1 * intensityMult), 7, Math.max(0.1, 1.5 * intensityMult), 9, Math.max(0.2, 2 * intensityMult), 12, Math.max(0.3, 3 * intensityMult), 15, Math.max(0.5, 5 * intensityMult), 18, Math.max(0.8, 8 * intensityMult)]);
        }
      });
    } else { // dataSource === 'diversity'
      if (displayMode === 'fill') {
        DIVERSITY_SCORE_INFO.forEach(dsi => {
          const scoreValue = dsi.score;
          const isSelected = selectedDiversityScores.has(scoreValue);
          const fillLayerId = `fill-layer-diversity-${scoreValue}`;
          if (map.getLayer(fillLayerId)) {
            map.setLayoutProperty(fillLayerId, 'visibility', isSelected ? 'visible' : 'none');
            if (isSelected) {
              map.setPaintProperty(fillLayerId, 'fill-opacity', getMapboxOpacityExpression('diversity'));
            }
          }
        });
      } else { // displayMode === 'heatmap'
        const scoresArray = Array.from(selectedDiversityScores);
        const diversityStackedFilter: ExpressionSpecification = scoresArray.length > 0
          ? ['in', ['get', 'score'], ['literal', scoresArray]]
          : ['boolean', false];

        if (diversityHeatmapRenderMode === 'stacked') {
          const stackedLayerId = 'heatmap-layer-diversity-stacked';
          if (map.getLayer(stackedLayerId)) {
            map.setLayoutProperty(stackedLayerId, 'visibility', 'visible');
            map.setFilter(stackedLayerId, diversityStackedFilter);
            map.setPaintProperty(stackedLayerId, 'heatmap-opacity', heatmapOpacityRef.current);
            map.setPaintProperty(stackedLayerId, 'heatmap-radius', getHeatmapRadiusExpression(1.0, 'diversity'));
            map.setPaintProperty(stackedLayerId, 'heatmap-intensity', ['interpolate', ['linear'], ['zoom'], 3, 1, 9, 1.5, 12, 2]);
          }
        } else { // diversityHeatmapRenderMode === 'perScore'
          DIVERSITY_SCORE_INFO.forEach(dsi => {
            const scoreValue = dsi.score;
            const isSelected = selectedDiversityScores.has(scoreValue);
            const perScoreLayerId = `heatmap-layer-diversity-per-score-${scoreValue}`;
            if (map.getLayer(perScoreLayerId)) {
              map.setLayoutProperty(perScoreLayerId, 'visibility', isSelected ? 'visible' : 'none');
              if (isSelected) {
                map.setPaintProperty(perScoreLayerId, 'heatmap-opacity', heatmapOpacityRef.current);
                map.setPaintProperty(perScoreLayerId, 'heatmap-radius', getHeatmapRadiusExpression(1.0, 'diversity'));
                map.setPaintProperty(perScoreLayerId, 'heatmap-intensity', ['interpolate', ['linear'], ['zoom'], 3, 1, 9, 1.5, 12, 2]);
              }
            }
          });
        }
      }
    }
  }, [isMapLoaded, displayMode, dataSource, selectedTimeWindows, selectedDiversityScores, heatmapRadiusScale, heatmapOpacity, diversityHeatmapRenderMode]);

  // Effect for fetching and updating data in sources
  useEffect(() => {
    if (!isMapLoaded || !mapRef.current || !currentBounds) return;
    const map = mapRef.current;
    const activePromises: Promise<void>[] = [];
    let anyDataToFetch = false;
    setIsLoading(true);

    if (dataSource === 'density') {
      const diversitySource = map.getSource('source-diversity') as GeoJSONSource;
      if (diversitySource?.setData) diversitySource.setData({ type: 'FeatureCollection', features: [] });
      TIME_WINDOWS.forEach((timeWindow) => {
        const sourceId = `source-density-${timeWindow.id}`;
        const source = map.getSource(sourceId) as GeoJSONSource;
        if (!selectedTimeWindows.has(timeWindow.id)) {
          if (source?.setData) source.setData({ type: 'FeatureCollection', features: [] });
          return;
        }
        anyDataToFetch = true;
        const promise = (async () => {
          try {
            const params = new URLSearchParams({ time_window_id: timeWindow.id.toString(), level: currentApiLevel.toString(), min_lon: currentBounds.getWest().toString(), min_lat: currentBounds.getSouth().toString(), max_lon: currentBounds.getEast().toString(), max_lat: currentBounds.getNorth().toString() });
            const response = await fetch(`/api/density?${params.toString()}`);
            if (!response.ok) throw new Error(`API Error (density): ${response.status} ${await response.text()}`);
            const data: ApiDensityResponse = await response.json();
            const features = displayMode === 'fill' ? data.map(p => calculateCellPolygon(p, currentApiLevel)) : createHeatmapPoints(data);
            if (source?.setData) source.setData({ type: 'FeatureCollection', features });
          } catch (error) {
            console.error(`Error fetching density for TW ${timeWindow.id}:`, error);
            if (source?.setData) source.setData({ type: 'FeatureCollection', features: [] });
          }
        })();
        activePromises.push(promise);
      });
    } else { // dataSource === 'diversity'
      TIME_WINDOWS.forEach(tw => {
        const densitySource = map.getSource(`source-density-${tw.id}`) as GeoJSONSource;
        if (densitySource?.setData) densitySource.setData({ type: 'FeatureCollection', features: [] });
      });
      anyDataToFetch = true;
      const sourceId = 'source-diversity';
      const source = map.getSource(sourceId) as GeoJSONSource;
      const promise = (async () => {
        try {
          const params = new URLSearchParams({ radius_group_id: selectedRadiusGroupId.toString(), level: currentApiLevel.toString(), min_lon: currentBounds.getWest().toString(), min_lat: currentBounds.getSouth().toString(), max_lon: currentBounds.getEast().toString(), max_lat: currentBounds.getNorth().toString() });
          const response = await fetch(`/api/diversity?${params.toString()}`);
          if (!response.ok) throw new Error(`API Error (diversity): ${response.status} ${await response.text()}`);
          const data: ApiDiversityResponse = await response.json();
          const features = displayMode === 'fill' ? data.map(p => calculateCellPolygon(p, currentApiLevel)) : createHeatmapPoints(data);
          if (source?.setData) source.setData({ type: 'FeatureCollection', features });
        } catch (error) {
          console.error(`Error fetching diversity data:`, error);
          if (source?.setData) source.setData({ type: 'FeatureCollection', features: [] });
        }
      })();
      activePromises.push(promise);
    }

    if (anyDataToFetch && activePromises.length > 0) {
      Promise.all(activePromises).finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, [selectedTimeWindows, selectedRadiusGroupId, currentApiLevel, currentBounds, isMapLoaded, displayMode, dataSource]);


  return (
    <div className="map-container-wrapper">
      {isLoading && <div className="loading-overlay">Loading Data...</div>}
      <div ref={mapContainerRef} className="map-container" />
    </div>
  );
};

export default MapDisplay;
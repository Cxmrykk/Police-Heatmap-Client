import React, { useEffect, useRef, useState } from 'react';
import mapboxgl, { LngLatBounds, Map, ErrorEvent, GeoJSONSource, type ExpressionSpecification } from 'mapbox-gl';
import type { ApiDiversityResponse, DisplayMode, DiversityHeatmapRenderMode } from '../types';
import {
  debounce,
  calculateCellPolygon,
  createHeatmapPoints,
  getMapboxOpacityExpression,
  DIVERSITY_SCORE_INFO,
  MAX_DIVERSITY_SCORE,
} from '../utils/mapUtils';
import '../styles/MapDisplay.css';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

const SCORE_VALUE_TO_RADIUS_MULTIPLIER_STOPS: Array<[number, number]> = [
  [0, 0.6], [1, 0.8], [Math.ceil(MAX_DIVERSITY_SCORE / 2), 1.0], [MAX_DIVERSITY_SCORE, 1.5],
];
const BASE_RADIUS_ZOOM_STOPS: Record<number, number> = { 3: 10, 7: 15, 9: 20, 12: 25, 15: 20, 18: 15 };

const errHandler = (e: ErrorEvent) => {
  console.error('Mapbox GL Error:', e.error?.message || e.error, e);
};

interface MapDisplayProps {
  selectedDiversityScores: Set<number>;
  onMapIdle: (map: Map) => void;
  currentApiLevel: number;
  currentBounds: LngLatBounds | null;
  displayMode: DisplayMode;
  selectedRadiusGroupId: number;
  heatmapRadiusScale: number;
  heatmapOpacity: number;
  diversityHeatmapRenderMode: DiversityHeatmapRenderMode;
  initialCenter?: [number, number];
}

const MapDisplay: React.FC<MapDisplayProps> = ({
  selectedDiversityScores,
  onMapIdle,
  currentApiLevel,
  currentBounds,
  displayMode,
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

  const getHeatmapRadiusExpression = (ageBasedRadiusMultiplier: number): ExpressionSpecification => {
    const propertyName = 'score';
    const valueToRadiusStops = SCORE_VALUE_TO_RADIUS_MULTIPLIER_STOPS;
    const valueRadiusMultiplierExpression: ExpressionSpecification = ['interpolate', ['linear'], ['get', propertyName]];
    valueToRadiusStops.forEach(([value, multiplier]) => valueRadiusMultiplierExpression.push(value, multiplier));
    const radiusExpression: ExpressionSpecification = ['interpolate', ['linear'], ['zoom']];
    Object.entries(BASE_RADIUS_ZOOM_STOPS).forEach(([zoomStr, baseRadiusAtZoom]) => {
      radiusExpression.push(parseFloat(zoomStr), ['*', heatmapRadiusScaleRef.current, ageBasedRadiusMultiplier, baseRadiusAtZoom, valueRadiusMultiplierExpression]);
    });
    return radiusExpression;
  };

  useEffect(() => {
    if (!MAPBOX_TOKEN || mapRef.current || !mapContainerRef.current) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: initialCenter || [-98.5795, 39.8283],
      zoom: initialCenter ? 4 : 3,
    });
    mapRef.current = map;
    map.on('error', errHandler);

    const handleLoad = () => {
      setIsMapLoaded(true);
      onMapIdleRef.current(map);

      if (!map.getSource('source-diversity')) {
        map.addSource('source-diversity', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      }

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

      const stackedHeatmapLayerId = 'heatmap-layer-diversity-stacked';
      if (!map.getLayer(stackedHeatmapLayerId)) {
        map.addLayer({
          id: stackedHeatmapLayerId, type: 'heatmap', source: 'source-diversity', maxzoom: 20,
          paint: {
            'heatmap-weight': ['interpolate', ['linear'], ['get', 'score'], 0, 0, 1, 0.25, 2, 0.5, 3, 0.75, MAX_DIVERSITY_SCORE, 1],
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

  useEffect(() => {
    if (!isMapLoaded || !mapRef.current) return;
    const map = mapRef.current;

    DIVERSITY_SCORE_INFO.forEach(dsi => {
      if (map.getLayer(`fill-layer-diversity-${dsi.score}`)) map.setLayoutProperty(`fill-layer-diversity-${dsi.score}`, 'visibility', 'none');
      if (map.getLayer(`heatmap-layer-diversity-per-score-${dsi.score}`)) map.setLayoutProperty(`heatmap-layer-diversity-per-score-${dsi.score}`, 'visibility', 'none');
    });
    if (map.getLayer('heatmap-layer-diversity-stacked')) map.setLayoutProperty('heatmap-layer-diversity-stacked', 'visibility', 'none');

    if (displayMode === 'fill') {
      DIVERSITY_SCORE_INFO.forEach(dsi => {
        const scoreValue = dsi.score;
        const isSelected = selectedDiversityScores.has(scoreValue);
        const fillLayerId = `fill-layer-diversity-${scoreValue}`;
        if (map.getLayer(fillLayerId)) {
          map.setLayoutProperty(fillLayerId, 'visibility', isSelected ? 'visible' : 'none');
          if (isSelected) {
            map.setPaintProperty(fillLayerId, 'fill-opacity', getMapboxOpacityExpression());
          }
        }
      });
    } else {
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
          map.setPaintProperty(stackedLayerId, 'heatmap-radius', getHeatmapRadiusExpression(1.0));
          map.setPaintProperty(stackedLayerId, 'heatmap-intensity', ['interpolate', ['linear'], ['zoom'], 3, 1, 9, 1.5, 12, 2]);
        }
      } else {
        DIVERSITY_SCORE_INFO.forEach(dsi => {
          const scoreValue = dsi.score;
          const isSelected = selectedDiversityScores.has(scoreValue);
          const perScoreLayerId = `heatmap-layer-diversity-per-score-${scoreValue}`;
          if (map.getLayer(perScoreLayerId)) {
            map.setLayoutProperty(perScoreLayerId, 'visibility', isSelected ? 'visible' : 'none');
            if (isSelected) {
              map.setPaintProperty(perScoreLayerId, 'heatmap-opacity', heatmapOpacityRef.current);
              map.setPaintProperty(perScoreLayerId, 'heatmap-radius', getHeatmapRadiusExpression(1.0));
              map.setPaintProperty(perScoreLayerId, 'heatmap-intensity', ['interpolate', ['linear'], ['zoom'], 3, 1, 9, 1.5, 12, 2]);
            }
          }
        });
      }
    }
  }, [isMapLoaded, displayMode, selectedDiversityScores, heatmapRadiusScale, heatmapOpacity, diversityHeatmapRenderMode]);

  useEffect(() => {
    if (!isMapLoaded || !mapRef.current || !currentBounds) return;
    const map = mapRef.current;
    setIsLoading(true);

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

    Promise.all([promise]).finally(() => setIsLoading(false));

  }, [selectedRadiusGroupId, currentApiLevel, currentBounds, isMapLoaded, displayMode]);


  return (
    <div className="map-container-wrapper">
      {isLoading && <div className="loading-overlay">Loading Data...</div>}
      <div ref={mapContainerRef} className="map-container" />
    </div>
  );
};

export default MapDisplay;
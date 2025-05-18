import { useState, useCallback, useEffect, useMemo } from 'react'; // Added useMemo
import { LngLatBounds, Map as MapboxMap } from 'mapbox-gl';
import MapDisplay from './components/MapDisplay';
import { TIME_WINDOWS, DIVERSITY_RADIUS_OPTIONS, DIVERSITY_SCORE_INFO, mapboxZoomToApiLevel, MIN_API_LEVEL, MAX_API_LEVEL } from './utils/mapUtils';
import type { DisplayMode, DataSourceType, DiversityHeatmapRenderMode, AppMetadata } from './types';
import './styles/App.css';

const DEFAULT_HEATMAP_OPACITY = 0.85;

function App() {
  const [selectedTimeWindows, setSelectedTimeWindows] = useState<Set<number>>(() => {
    const initialSelection = new Set<number>();
    if (TIME_WINDOWS.length > 0) {
      initialSelection.add(TIME_WINDOWS[0].id);
    }
    return initialSelection;
  });

  const [selectedDiversityScores, setSelectedDiversityScores] = useState<Set<number>>(() =>
    new Set(DIVERSITY_SCORE_INFO.map(dsi => dsi.score))
  );

  const [currentApiLevel, setCurrentApiLevel] = useState<number>(MIN_API_LEVEL);
  const [currentBounds, setCurrentBounds] = useState<LngLatBounds | null>(null);
  const [mapInstance, setMapInstance] = useState<MapboxMap | null>(null);

  const [displayMode, setDisplayMode] = useState<DisplayMode>('heatmap');
  const [dataSource, setDataSource] = useState<DataSourceType>('density');
  const [selectedRadiusGroupId, setSelectedRadiusGroupId] = useState<number>(0);
  const [heatmapRadiusScale, setHeatmapRadiusScale] = useState<number>(1.0);
  const [heatmapOpacity, setHeatmapOpacity] = useState<number>(DEFAULT_HEATMAP_OPACITY);
  const [diversityHeatmapMode, setDiversityHeatmapMode] = useState<DiversityHeatmapRenderMode>('stacked');

  const [manualPrecisionEnabled, setManualPrecisionEnabled] = useState<boolean>(false);
  const [manualPrecisionLevel, setManualPrecisionLevel] = useState<number>(MIN_API_LEVEL);
  const [autoCalculatedApiLevel, setAutoCalculatedApiLevel] = useState<number>(MIN_API_LEVEL);

  const [appMetadata, setAppMetadata] = useState<AppMetadata | null>(null);

  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const response = await fetch('/api/metadata');
        if (!response.ok) {
          if (response.status === 404) {
            console.warn("Metadata not found (404). Grid update might be pending.");
            setAppMetadata({});
            return;
          }
          throw new Error(`API Error (metadata): ${response.status} ${await response.text()}`);
        }
        const data: AppMetadata = await response.json();
        setAppMetadata(data);
      } catch (error) {
        console.error("Failed to fetch app metadata:", error);
        setAppMetadata({});
      }
    };
    fetchMetadata();
  }, []);

  const handleTimeWindowChange = (id: number) => {
    setSelectedTimeWindows(prev => {
      const newSelection = new Set(prev);
      if (newSelection.has(id)) newSelection.delete(id);
      else newSelection.add(id);
      return newSelection;
    });
  };

  const handleDiversityScoreChange = (score: number) => {
    setSelectedDiversityScores(prev => {
      const newSelection = new Set(prev);
      if (newSelection.has(score)) newSelection.delete(score);
      else newSelection.add(score);
      return newSelection;
    });
  };

  const handleDisplayModeChange = (mode: DisplayMode) => setDisplayMode(mode);
  const handleDataSourceChange = (source: DataSourceType) => setDataSource(source);
  const handleRadiusGroupChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedRadiusGroupId(parseInt(event.target.value, 10));
  };
  const handleHeatmapRadiusScaleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setHeatmapRadiusScale(parseFloat(event.target.value));
  };

  const handleHeatmapOpacityChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setHeatmapOpacity(parseFloat(event.target.value));
  };

  const handleDiversityHeatmapModeChange = (mode: DiversityHeatmapRenderMode) => {
    setDiversityHeatmapMode(mode);
  };

  const handleManualPrecisionToggle = () => {
    const nextEnabledState = !manualPrecisionEnabled;
    if (nextEnabledState) {
      setManualPrecisionLevel(autoCalculatedApiLevel);
    }
    setManualPrecisionEnabled(nextEnabledState);
  };

  const handleManualPrecisionChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setManualPrecisionLevel(parseInt(event.target.value, 10));
  };

  useEffect(() => {
    const newEffectiveApiLevel = manualPrecisionEnabled ? manualPrecisionLevel : autoCalculatedApiLevel;
    if (newEffectiveApiLevel !== currentApiLevel) {
      setCurrentApiLevel(newEffectiveApiLevel);
    }
  }, [manualPrecisionEnabled, manualPrecisionLevel, autoCalculatedApiLevel, currentApiLevel]);


  const handleMapIdle = useCallback((map: MapboxMap) => {
    setMapInstance(map);

    const newZoom = map.getZoom();
    const newAutoApiLevel = mapboxZoomToApiLevel(newZoom);

    if (newAutoApiLevel !== autoCalculatedApiLevel) {
      setAutoCalculatedApiLevel(newAutoApiLevel);
    }

    const newBounds = map.getBounds();
    if (!newBounds) return;

    const boundsChanged = !currentBounds ||
      Math.abs(newBounds.getWest() - currentBounds.getWest()) > 1e-4 ||
      Math.abs(newBounds.getSouth() - currentBounds.getSouth()) > 1e-4 ||
      Math.abs(newBounds.getEast() - currentBounds.getEast()) > 1e-4 ||
      Math.abs(newBounds.getNorth() - currentBounds.getNorth()) > 1e-4;

    if (boundsChanged) {
      setCurrentBounds(newBounds);
    }
  }, [autoCalculatedApiLevel, currentBounds]);

  useEffect(() => {
    if (mapInstance && !currentBounds) {
      const initialZoom = mapInstance.getZoom();
      const initialAutoLevel = mapboxZoomToApiLevel(initialZoom);
      setAutoCalculatedApiLevel(initialAutoLevel);
      setCurrentBounds(mapInstance.getBounds());
    }
  }, [mapInstance, currentBounds]);

  if (!import.meta.env.VITE_MAPBOX_TOKEN) {
    return <div className="error-message">Error: Mapbox token (VITE_MAPBOX_TOKEN) is not configured.</div>;
  }

  // Memoize initialMapCenter to prevent unnecessary re-renders of MapDisplay
  const initialMapCenter = useMemo<[number, number] | undefined>(() => {
    if (appMetadata?.center_longitude && appMetadata?.center_latitude) {
      return [parseFloat(appMetadata.center_longitude), parseFloat(appMetadata.center_latitude)];
    }
    return undefined;
  }, [appMetadata?.center_longitude, appMetadata?.center_latitude]);


  return (
    <div className="app-container">
      <div className="controls-panel">
        {dataSource === 'density' && (
          <div>
            <h3>Time Windows (Density):</h3>
            {TIME_WINDOWS.map(tw => (
              <label key={tw.id} className="control-item">
                <input type="checkbox" checked={selectedTimeWindows.has(tw.id)} onChange={() => handleTimeWindowChange(tw.id)} />
                <span style={{ display: 'inline-block', width: '12px', height: '12px', backgroundColor: tw.color, marginRight: '5px', border: '1px solid #555' }}></span>
                {tw.name}
              </label>
            ))}
          </div>
        )}

        {dataSource === 'diversity' && (
          <div>
            <h3>Diversity Scores:</h3>
            {DIVERSITY_SCORE_INFO.map(dsi => (
              <label key={dsi.score} className="control-item">
                <input type="checkbox" checked={selectedDiversityScores.has(dsi.score)} onChange={() => handleDiversityScoreChange(dsi.score)} />
                <span style={{ display: 'inline-block', width: '12px', height: '12px', backgroundColor: dsi.color, marginRight: '5px', border: '1px solid #555' }}></span>
                {dsi.name}
              </label>
            ))}
          </div>
        )}

        <div>
          <h3>Data Source:</h3>
          <label className="control-item"><input type="radio" name="dataSource" value="density" checked={dataSource === 'density'} onChange={() => handleDataSourceChange('density')} /> Density</label>
          <label className="control-item"><input type="radio" name="dataSource" value="diversity" checked={dataSource === 'diversity'} onChange={() => handleDataSourceChange('diversity')} /> Temporal Diversity</label>
        </div>

        {dataSource === 'diversity' && (
          <div>
            <h3>Diversity Radius:</h3>
            <select value={selectedRadiusGroupId} onChange={handleRadiusGroupChange} className="control-item control-select">
              {DIVERSITY_RADIUS_OPTIONS.map(opt => (<option key={opt.id} value={opt.id}>{opt.label}</option>))}
            </select>
          </div>
        )}

        <div>
          <h3>Precision Level (L{currentApiLevel}):</h3>
          <label className="control-item">
            <input type="checkbox" checked={manualPrecisionEnabled} onChange={handleManualPrecisionToggle} />
            Manual Override
          </label>
          <div className="control-item">
            <span>Level: ({manualPrecisionLevel})</span>
            <input
              type="range"
              min={MIN_API_LEVEL}
              max={MAX_API_LEVEL}
              step="1"
              value={manualPrecisionLevel}
              onChange={handleManualPrecisionChange}
              disabled={!manualPrecisionEnabled}
              style={{ width: '100px' }}
            />
          </div>
        </div>

        <div>
          <h3>Display Mode:</h3>
          <label className="control-item"><input type="radio" name="displayMode" value="fill" checked={displayMode === 'fill'} onChange={() => handleDisplayModeChange('fill')} /> Polygons</label>
          <label className="control-item"><input type="radio" name="displayMode" value="heatmap" checked={displayMode === 'heatmap'} onChange={() => handleDisplayModeChange('heatmap')} /> Heatmap</label>
        </div>

        {displayMode === 'heatmap' && (
          <div>
            <h3>Heatmap Settings:</h3>
            <div className="control-item">
              <span>Radius Scale: ({heatmapRadiusScale.toFixed(1)}x)</span>
              <input type="range" min="0.2" max="3.0" step="0.1" value={heatmapRadiusScale} onChange={handleHeatmapRadiusScaleChange} style={{ width: '100px' }} />
            </div>
            <div className="control-item">
              <span>Opacity: ({(heatmapOpacity * 100).toFixed(0)}%)</span>
              <input type="range" min="0.0" max="1.0" step="0.05" value={heatmapOpacity} onChange={handleHeatmapOpacityChange} style={{ width: '100px' }} />
            </div>

            {dataSource === 'diversity' && (
              <div style={{ marginTop: '10px' }}>
                <h4>Diversity Heatmap Style:</h4>
                <label className="control-item">
                  <input type="radio" name="diversityHeatmapMode" value="stacked" checked={diversityHeatmapMode === 'stacked'} onChange={() => handleDiversityHeatmapModeChange('stacked')} />
                  Stacked (Original)
                </label>
                <label className="control-item">
                  <input type="radio" name="diversityHeatmapMode" value="perScore" checked={diversityHeatmapMode === 'perScore'} onChange={() => handleDiversityHeatmapModeChange('perScore')} />
                  Per Score Layer
                </label>
              </div>
            )}
          </div>
        )}
      </div>
      <MapDisplay
        selectedTimeWindows={selectedTimeWindows}
        selectedDiversityScores={selectedDiversityScores}
        onMapIdle={handleMapIdle}
        currentApiLevel={currentApiLevel}
        currentBounds={currentBounds}
        displayMode={displayMode}
        dataSource={dataSource}
        selectedRadiusGroupId={selectedRadiusGroupId}
        heatmapRadiusScale={heatmapRadiusScale}
        heatmapOpacity={heatmapOpacity}
        diversityHeatmapRenderMode={diversityHeatmapMode}
        initialCenter={initialMapCenter}
      />
      {appMetadata && (Object.keys(appMetadata).length > 0 || appMetadata === null) && (
        <div className="metadata-overlay">
          {appMetadata.last_grid_update_timestamp ? (
            <p>Last Grid Update: {new Date(parseInt(appMetadata.last_grid_update_timestamp, 10)).toLocaleString()}</p>
          ) : appMetadata === null ? <p>Loading metadata...</p> : <p>Grid update time not available.</p>}
          {appMetadata.total_alerts_in_time_windows ? (
            <p>Total Alerts (in time windows): {appMetadata.total_alerts_in_time_windows}</p>
          ) : appMetadata !== null && <p>Total alerts data not available.</p>}
        </div>
      )}
    </div>
  );
}

export default App;
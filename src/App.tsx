import { useState, useCallback, useEffect } from 'react';
import { LngLatBounds, Map as MapboxMap } from 'mapbox-gl';
import MapDisplay from './components/MapDisplay';
import { TIME_WINDOWS, mapboxZoomToApiLevel, MIN_API_LEVEL } from './utils/mapUtils';
import type { DisplayMode, DensitySourceType } from './types';
import './styles/App.css';

function App() {
  const [selectedTimeWindows, setSelectedTimeWindows] = useState<Set<number>>(() => {
    const initialSelection = new Set<number>();
    if (TIME_WINDOWS.length > 0) {
      initialSelection.add(TIME_WINDOWS[0].id);
    }
    return initialSelection;
  });

  const [currentApiLevel, setCurrentApiLevel] = useState<number>(MIN_API_LEVEL);
  const [currentBounds, setCurrentBounds] = useState<LngLatBounds | null>(null);
  const [mapInstance, setMapInstance] = useState<MapboxMap | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('heatmap');
  const [densitySource, setDensitySource] = useState<DensitySourceType>('original');
  const [heatmapRadiusScale, setHeatmapRadiusScale] = useState<number>(1.0); // New state for radius scale

  const handleTimeWindowChange = (id: number) => {
    setSelectedTimeWindows(prev => {
      const newSelection = new Set(prev);
      if (newSelection.has(id)) {
        newSelection.delete(id);
      } else {
        newSelection.add(id);
      }
      return newSelection;
    });
  };

  const handleDisplayModeChange = (mode: DisplayMode) => {
    setDisplayMode(mode);
  };

  const handleDensitySourceChange = (source: DensitySourceType) => {
    setDensitySource(source);
  };

  const handleHeatmapRadiusScaleChange = (event: React.ChangeEvent<HTMLInputElement>) => { // New handler
    setHeatmapRadiusScale(parseFloat(event.target.value));
  };

  const handleMapIdle = useCallback((map: MapboxMap) => {
    setMapInstance(map);
    const newZoom = map.getZoom();
    const newApiLevel = mapboxZoomToApiLevel(newZoom);
    const newBounds = map.getBounds();

    if (!newBounds) return;

    const boundsChanged = (
      !currentBounds ||
      Math.abs(newBounds.getWest() - currentBounds.getWest()) > 0.0001 ||
      Math.abs(newBounds.getSouth() - currentBounds.getSouth()) > 0.0001 ||
      Math.abs(newBounds.getEast() - currentBounds.getEast()) > 0.0001 ||
      Math.abs(newBounds.getNorth() - currentBounds.getNorth()) > 0.0001
    );

    if (newApiLevel !== currentApiLevel || boundsChanged) {
      setCurrentApiLevel(newApiLevel);
      setCurrentBounds(newBounds);
    }
  }, [currentApiLevel, currentBounds]);

  useEffect(() => {
    if (mapInstance && !currentBounds) {
      const initialZoom = mapInstance.getZoom();
      setCurrentApiLevel(mapboxZoomToApiLevel(initialZoom));
      setCurrentBounds(mapInstance.getBounds());
    }
  }, [mapInstance, currentBounds]);

  if (!import.meta.env.VITE_MAPBOX_TOKEN) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: 'red', fontSize: '1.2em' }}>
        Error: Mapbox token (VITE_MAPBOX_TOKEN) is not configured.
      </div>
    );
  }

  return (
    <div className="app-container">
      <div className="controls-panel">
        <div>
          <h3>Time Windows:</h3>
          {TIME_WINDOWS.map(tw => (
            <label key={tw.id} className="control-item">
              <input
                type="checkbox"
                checked={selectedTimeWindows.has(tw.id)}
                onChange={() => handleTimeWindowChange(tw.id)}
              />
              <span style={{
                display: 'inline-block',
                width: '12px',
                height: '12px',
                backgroundColor: tw.color,
                marginRight: '5px',
                border: '1px solid #555'
              }}></span>
              {tw.name}
            </label>
          ))}
        </div>
        <div>
          <h3>Display Mode:</h3>
          <label className="control-item">
            <input
              type="radio"
              name="displayMode"
              value="fill"
              checked={displayMode === 'fill'}
              onChange={() => handleDisplayModeChange('fill')}
            /> Polygons
          </label>
          <label className="control-item">
            <input
              type="radio"
              name="displayMode"
              value="heatmap"
              checked={displayMode === 'heatmap'}
              onChange={() => handleDisplayModeChange('heatmap')}
            /> Heatmap
          </label>
        </div>
        {displayMode === 'heatmap' && (
          <>
            <div>
              <h3>Heatmap Density Source:</h3>
              <label className="control-item">
                <input
                  type="radio"
                  name="densitySource"
                  value="original"
                  checked={densitySource === 'original'}
                  onChange={() => handleDensitySourceChange('original')}
                /> Original
              </label>
              <label className="control-item">
                <input
                  type="radio"
                  name="densitySource"
                  value="scaled"
                  checked={densitySource === 'scaled'}
                  onChange={() => handleDensitySourceChange('scaled')}
                /> Scaled
              </label>
            </div>
            {/* New Control for Heatmap Radius Scale */}
            <div>
              <h3>Heatmap Radius Scale: ({heatmapRadiusScale.toFixed(1)}x)</h3>
              <input
                type="range"
                min="0.2"
                max="3.0"
                step="0.1"
                value={heatmapRadiusScale}
                onChange={handleHeatmapRadiusScaleChange}
                style={{ width: '100px' }}
              />
            </div>
          </>
        )}
      </div>
      <MapDisplay
        selectedTimeWindows={selectedTimeWindows}
        onMapIdle={handleMapIdle}
        currentApiLevel={currentApiLevel}
        currentBounds={currentBounds}
        displayMode={displayMode}
        densitySource={densitySource}
        heatmapRadiusScale={heatmapRadiusScale} // Pass the new state
      />
    </div>
  );
}

export default App;
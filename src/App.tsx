import { useState, useCallback, useEffect } from 'react';
import { LngLatBounds, Map as MapboxMap } from 'mapbox-gl';
import MapDisplay from './components/MapDisplay';
import { TIME_WINDOWS, mapboxZoomToApiLevel, MIN_API_LEVEL } from './utils/mapUtils'; // Import MIN_API_LEVEL
import type { DisplayMode } from './types';
import './styles/App.css';

function App() {
  const [selectedTimeWindows, setSelectedTimeWindows] = useState<Set<number>>(() => {
    // ... (no change)
    const initialSelection = new Set<number>();
    if (TIME_WINDOWS.length > 0) {
      initialSelection.add(TIME_WINDOWS[0].id);
    }
    return initialSelection;
  });

  // Initialize currentApiLevel respecting MIN_API_LEVEL
  const [currentApiLevel, setCurrentApiLevel] = useState<number>(MIN_API_LEVEL);
  const [currentBounds, setCurrentBounds] = useState<LngLatBounds | null>(null);
  const [mapInstance, setMapInstance] = useState<MapboxMap | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('fill');

  // ... handleTimeWindowChange, handleDisplayModeChange (no change) ...
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

  const handleMapIdle = useCallback((map: MapboxMap) => {
    setMapInstance(map);
    const newZoom = map.getZoom();
    // mapboxZoomToApiLevel will now respect MIN_API_LEVEL
    const newApiLevel = mapboxZoomToApiLevel(newZoom);
    const newBounds = map.getBounds();

    if (!newBounds) return;

    const boundsChanged = (
      !currentBounds ||
      newBounds.getWest() !== currentBounds.getWest() ||
      newBounds.getSouth() !== currentBounds.getSouth() ||
      newBounds.getEast() !== currentBounds.getEast() ||
      newBounds.getNorth() !== currentBounds.getNorth()
    );

    if (newApiLevel !== currentApiLevel || boundsChanged) {
      setCurrentApiLevel(newApiLevel); // This will be >= MIN_API_LEVEL
      setCurrentBounds(newBounds);
    }
  }, [currentApiLevel, currentBounds]);

  useEffect(() => {
    if (mapInstance && !currentBounds) {
      const initialZoom = mapInstance.getZoom();
      // mapboxZoomToApiLevel will ensure it's >= MIN_API_LEVEL
      setCurrentApiLevel(mapboxZoomToApiLevel(initialZoom));
      setCurrentBounds(mapInstance.getBounds());
    }
  }, [mapInstance, currentBounds]);

  // ... (rest of App.tsx, no further changes related to these points) ...
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
      </div>
      <MapDisplay
        selectedTimeWindows={selectedTimeWindows}
        onMapIdle={handleMapIdle}
        currentApiLevel={currentApiLevel}
        currentBounds={currentBounds}
        displayMode={displayMode}
      />
    </div>
  );
}

export default App;
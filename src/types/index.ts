export interface DataPointBase {
  lon: number;
  lat: number;
}

export interface DensityDataPoint extends DataPointBase {
  density: number; // Value from 0-255
}

export interface DiversityDataPoint extends DataPointBase {
  score: number; // Value from 1 to TIME_WINDOWS.length
}

export type ApiDensityResponse = DensityDataPoint[];
export type ApiDiversityResponse = DiversityDataPoint[];

export interface TimeWindow {
  id: number;
  name: string;
  color: string;
}

export type DisplayMode = 'fill' | 'heatmap';
export type DataSourceType = 'density' | 'diversity';

// New type for diversity heatmap rendering
export type DiversityHeatmapRenderMode = 'stacked' | 'perScore';

export interface GeoJsonProperties {
  density?: number; // Make optional as one will always be present
  score?: number;   // Make optional
}

// New type for application metadata
export interface AppMetadata {
  last_grid_update_timestamp?: string;
  center_longitude?: string;
  center_latitude?: string;
  total_alerts_in_time_windows?: string;
}
export interface DataPointBase {
  lon: number;
  lat: number;
}

export interface DiversityDataPoint extends DataPointBase {
  score: number;
}

export type ApiDiversityResponse = DiversityDataPoint[];

export type DisplayMode = 'fill' | 'heatmap';
export type DataSourceType = 'diversity';

export type DiversityHeatmapRenderMode = 'stacked' | 'perScore';

export interface GeoJsonProperties {
  score?: number;
}

export interface AppMetadata {
  last_grid_update_timestamp?: string;
  center_longitude?: string;
  center_latitude?: string;
  total_alerts_in_time_windows?: string;
}
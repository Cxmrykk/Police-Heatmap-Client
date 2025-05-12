export interface DensityPoint {
  lon: number;
  lat: number;
  density: number;
}

export type DensityApiResponse = DensityPoint[];

export interface TimeWindow {
  id: number;
  name: string;
  color: string;
}

export type DisplayMode = 'fill' | 'heatmap';

export type DensitySourceType = 'original' | 'scaled'; // New type
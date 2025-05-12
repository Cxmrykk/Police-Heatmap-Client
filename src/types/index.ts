export interface DensityPoint {
  lon: number;
  lat: number;
  density: number;
}

export type DensityApiResponse = DensityPoint[];

export interface TimeWindow {
  id: number;
  name: string;
  color: string; // This color will be used for fill, heatmap might use a gradient
}

export type DisplayMode = 'fill' | 'heatmap'; // New type
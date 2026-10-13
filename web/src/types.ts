export interface Parameters {
  master_db: number;
  left_db: number;
  right_db: number;
  balance: number;
  width: number;
  low_db: number;
  mid_db: number;
  high_db: number;
  bypass: boolean;
  limiter: boolean;
}
export const neutral: Parameters = {
  master_db: 0, left_db: 0, right_db: 0, balance: 0, width: 1,
  low_db: 0, mid_db: 0, high_db: 0, bypass: false, limiter: true,
};
export interface Asset {
  id: string;
  name: string;
  sample_rate: number;
  channels: number;
  frames: number;
  duration: number;
  peak: [number, number];
  rms: [number, number];
  correlation: number;
  waveform: [number, number, number, number][];
}
export interface Preset { id: string; name: string; parameters: Parameters; builtin: boolean }
export interface Project {
  id: string;
  name: string;
  asset_id: string;
  parameters: Parameters;
  loop_start: number;
  loop_end: number;
  loop_enabled: boolean;
}
export function time(seconds: number) {
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}.${Math.floor((seconds % 1) * 10)}`;
}
export function db(sample: number) { return sample > 0.000001 ? 20 * Math.log10(sample) : -120; }

// Human labels, display units and colour scales for CF parameter names.
const TEMP = [[-2, '#1e3a8a'], [5, '#2563eb'], [12, '#06b6d4'], [18, '#10b981'], [24, '#facc15'], [28, '#f97316'], [32, '#dc2626']];

export const PARAMETERS = {
  // combined view: NOAA reports "sea surface temperature", Argo and Copernicus "sea water temperature"
  sea_temperature: { label: 'Sea temperature (near surface)', short: 'Sea temp', unit: '°C', ramp: TEMP,
    combine: ['sea_surface_temperature', 'sea_water_temperature'] },
  sea_surface_temperature: { label: 'Sea surface temperature', short: 'SST', unit: '°C', ramp: TEMP },
  sea_water_temperature: { label: 'Sea water temperature', short: 'Water temp', unit: '°C', ramp: TEMP },
  sea_water_practical_salinity: { label: 'Salinity', short: 'Salinity', unit: 'PSU', ramp: [[30, '#a78bfa'], [33, '#3b82f6'], [35, '#06b6d4'], [36.5, '#10b981'], [38, '#facc15']] },
  sea_surface_wave_significant_height: { label: 'Significant wave height', short: 'Waves', unit: 'm', ramp: [[0, '#0ea5e9'], [1, '#06b6d4'], [2, '#10b981'], [4, '#facc15'], [6, '#f97316'], [9, '#dc2626']] },
  wind_speed: { label: 'Wind speed', short: 'Wind', unit: 'm/s', ramp: [[0, '#0ea5e9'], [5, '#10b981'], [10, '#facc15'], [17, '#f97316'], [25, '#dc2626']] },
  air_pressure_at_mean_sea_level: { label: 'Air pressure', short: 'Pressure', unit: 'hPa', ramp: [[970, '#dc2626'], [995, '#f97316'], [1010, '#10b981'], [1025, '#06b6d4'], [1040, '#2563eb']] },
  air_temperature: { label: 'Air temperature', short: 'Air temp', unit: '°C', ramp: TEMP },
  sea_water_speed: { label: 'Current speed', short: 'Current', unit: 'm/s', ramp: [[0, '#0ea5e9'], [0.3, '#10b981'], [0.8, '#facc15'], [1.5, '#dc2626']] },
  water_surface_height_above_reference_datum: { label: 'Sea level (tide gauge)', short: 'Sea level', unit: 'm', ramp: [[-2, '#2563eb'], [0, '#06b6d4'], [2, '#facc15'], [5, '#dc2626']] },
};

export const MAP_PARAMETERS = [
  'sea_temperature', 'sea_surface_wave_significant_height',
  'wind_speed', 'sea_water_practical_salinity', 'air_pressure_at_mean_sea_level', 'sea_water_speed',
];

const UNIT_LABELS = { Cel: '°C', 'm/s': 'm/s', m: 'm', s: 's', deg: '°', hPa: 'hPa', '1': '', '[nmi_i]': 'nmi', '%': '%', dbar: 'dbar', 'mg/m3': 'mg/m³' };

export function paramLabel(name) {
  if (PARAMETERS[name]) return PARAMETERS[name].label;
  const s = String(name).replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export function unitLabel(unit, name) {
  if (name === 'sea_water_practical_salinity') return 'PSU';
  return UNIT_LABELS[unit] ?? unit;
}
export function fmtValue(v) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '-';
  const n = Number(v);
  const a = Math.abs(n);
  return a >= 1000 ? n.toFixed(0) : a >= 100 ? n.toFixed(1) : n.toFixed(2).replace(/\.?0+$/, '');
}
export function fmtNumber(n) {
  return n === null || n === undefined ? '-' : Number(n).toLocaleString('en-US');
}
export function fmtAgo(t) {
  if (!t) return 'never';
  const s = Math.round((Date.now() - new Date(t).getTime()) / 1000);
  if (s < 60) return `${Math.max(s, 0)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
export function fmtTime(t) {
  return t ? new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '-';
}

export const SOURCE_COLORS = { ndbc: '#06b6d4', argo: '#8b5cf6', copernicus: '#10b981', obis: '#f59e0b' };
export const SOURCE_NAMES = { ndbc: 'NOAA NDBC', argo: 'Argo floats', copernicus: 'Copernicus Marine', obis: 'OBIS eDNA' };
export const PLATFORM_NAMES = {
  buoy_or_coastal_station: 'Buoy / coastal station', profiling_float: 'Profiling float', mooring: 'Mooring',
  drifting_buoy: 'Drifting buoy', tide_gauge: 'Tide gauge', ferrybox: 'Ferrybox', surface_drone: 'Sail drone', glider: 'Glider',
};
export const KINGDOM_COLORS = {
  Animalia: '#f97316', Chromista: '#10b981', Bacteria: '#06b6d4', Plantae: '#84cc16', Protozoa: '#a78bfa',
  Fungi: '#f472b6', Archaea: '#facc15', 'Biota incertae sedis': '#64748b',
};

// MapLibre colour expression for a ramp: grey when no value
export function rampExpression(ramp, prop = 'v') {
  const stops = ramp.flatMap(([v, c]) => [v, c]);
  return ['case', ['==', ['typeof', ['get', prop]], 'number'], ['interpolate', ['linear'], ['get', prop], ...stops], '#475569'];
}

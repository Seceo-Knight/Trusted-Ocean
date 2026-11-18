'use strict';
// First-pass automatic quality control: physical plausibility ranges.
// Flags follow the common oceanographic scheme: 1 = good, 4 = bad, 0 = not checked.
const RANGES = {
  sea_surface_temperature: [-2.5, 40],
  air_temperature: [-60, 60],
  dew_point_temperature: [-70, 40],
  air_pressure_at_mean_sea_level: [850, 1085],
  wind_speed: [0, 80],
  wind_speed_of_gust: [0, 110],
  wind_from_direction: [0, 360],
  sea_surface_wave_significant_height: [0, 30],
  sea_surface_wave_period_at_variance_spectral_density_maximum: [1, 40], // 0 s means "no reading"
  sea_surface_wave_mean_period: [1, 40],
  sea_surface_wave_from_direction: [0, 360],
  visibility_in_air: [0, 100],
  sea_water_temperature: [-2.5, 40],
  sea_water_practical_salinity: [2, 41],
  sea_water_pressure: [0, 12000],
  water_surface_height_above_reference_datum: [-20, 20],
  mass_concentration_of_chlorophyll_in_sea_water: [0, 100],
  sea_water_speed: [0, 10],
  direction_of_sea_water_velocity: [0, 360],
  relative_humidity: [0, 100],
};

function qcFlag(name, value) {
  const r = RANGES[name];
  if (!r) return 0;
  return value >= r[0] && value <= r[1] ? 1 : 4;
}

module.exports = { qcFlag, RANGES };

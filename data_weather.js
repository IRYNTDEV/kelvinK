// Real NASA POWER hourly air temperature for Ibadan, Nigeria (7.3341N,
// 3.881E), copied from ThermalSim5/data/ibadan_weather_hourly.csv — 72
// consecutive hours (2025-04-02 00:00 through 2025-04-04 23:00), degrees C.
const WEATHER_IBADAN_TEMP_C = [
  24.94,24.69,24.46,24.29,24.22,24.17,25.34,26.57,27.95,29.16,30.01,30.51,
  30.56,30.5,30.24,29.63,28.77,27.36,26.32,25.95,25.62,25.27,24.95,24.8,
  24.7,24.58,24.37,24.12,23.92,23.78,25.09,26.34,27.86,29.53,31.26,32.22,
  32.6,32.79,32.78,32.4,31.35,28.89,27.22,26.57,25.98,25.5,25.12,24.79,
  24.48,24.19,23.95,23.73,23.57,23.46,24.89,26.41,28.19,29.84,31.12,32.0,
  32.46,32.7,32.52,32.04,30.95,28.91,27.46,26.87,26.3,25.82,25.52,25.31
];

// Linear interpolation between hourly samples, wrapping around the 72h
// record (so a 24h or 49h run just replays the same 3 real days — same
// wrap behaviour as the original Weather.m's wrapTime()).
function realWeatherTemp(hour) {
  const n = WEATHER_IBADAN_TEMP_C.length;
  const h = ((hour % n) + n) % n;
  const i0 = Math.floor(h);
  const i1 = (i0 + 1) % n;
  const frac = h - i0;
  return WEATHER_IBADAN_TEMP_C[i0] * (1 - frac) + WEATHER_IBADAN_TEMP_C[i1] * frac;
}

// Synthetic diurnal sinusoid fallback, same formula as config.m's
// DEFAULT_DIURNAL_TEMPERATURE (Tmean=28, AT=5, tauT=9).
function syntheticWeatherTemp(hour) {
  const omega = 2 * Math.PI / 24;
  return 28 + 5 * Math.sin(omega * (hour - 9));
}

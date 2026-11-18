import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
// Tell MapLibre exactly where its background worker file is (needed with Vite dev and build)
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { feature, mesh } from 'topojson-client';
import countries from 'world-atlas/countries-50m.json';
import { colors } from '../theme';

// Self-contained base map: Natural Earth coastlines bundled in the app (public domain).
// No external tile server, no API key, works offline and behind client firewalls.
maplibregl.setWorkerUrl(workerUrl);

// Shapes crossing the 180° date line (Fiji, eastern Russia) jump from +180 to -180, which a
// map draws as a line across the whole world. Make each line/ring continuous instead.
function unwrapLine(coords) {
  let prev = null;
  return coords.map(([x, y]) => {
    let lon = x;
    if (prev !== null) { while (lon - prev > 180) lon -= 360; while (prev - lon > 180) lon += 360; }
    prev = lon;
    return [lon, y];
  });
}
function unwrapGeometry(g) {
  if (g.type === 'Polygon') return { ...g, coordinates: g.coordinates.map(unwrapLine) };
  if (g.type === 'MultiPolygon') return { ...g, coordinates: g.coordinates.map((p) => p.map(unwrapLine)) };
  if (g.type === 'LineString') return { ...g, coordinates: unwrapLine(g.coordinates) };
  if (g.type === 'MultiLineString') return { ...g, coordinates: g.coordinates.map(unwrapLine) };
  return g;
}
const landRaw = feature(countries, countries.objects.land);
const land = landRaw.type === 'FeatureCollection'
  ? { ...landRaw, features: landRaw.features.map((f) => ({ ...f, geometry: unwrapGeometry(f.geometry) })) }
  : { ...landRaw, geometry: unwrapGeometry(landRaw.geometry) };
const borders = unwrapGeometry(mesh(countries, countries.objects.countries, (a, b) => a !== b));

const BASE_STYLE = {
  version: 8,
  sources: {
    land: { type: 'geojson', data: land },
    borders: { type: 'geojson', data: borders },
  },
  layers: [
    { id: 'ocean', type: 'background', paint: { 'background-color': colors.ocean } },
    { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': colors.land } },
    { id: 'coast', type: 'line', source: 'land', paint: { 'line-color': colors.coast, 'line-width': 0.8 } },
    { id: 'borders', type: 'line', source: 'borders', paint: { 'line-color': colors.coast, 'line-width': 0.4, 'line-opacity': 0.6 } },
  ],
};

/**
 * layers: [{ id, data (GeoJSON FeatureCollection), color (expression or string), radius, strokeColor, visible }]
 * onSelect(feature) is called when a point is clicked.
 */
export default function OceanMap({ layers = [], center = [75, 10], zoom = 2.2, height = 520, onSelect, fitBounds }) {
  const box = useRef(null);
  const map = useRef(null);
  const ready = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const layersRef = useRef(layers);
  layersRef.current = layers;

  const sync = () => {
    const m = map.current;
    if (!m || !ready.current) return;
    for (const l of layersRef.current) {
      const src = m.getSource(l.id);
      if (src) src.setData(l.data);
      else {
        m.addSource(l.id, { type: 'geojson', data: l.data });
        m.addLayer({
          id: l.id,
          type: 'circle',
          source: l.id,
          paint: {
            'circle-radius': l.radiusExpr || ['interpolate', ['linear'], ['zoom'], 1, l.radius || 3, 6, (l.radius || 3) * 2.2],
            'circle-color': l.color,
            'circle-stroke-color': l.strokeColor || 'rgba(10,15,26,0.9)',
            'circle-stroke-width': 0.6,
            'circle-opacity': l.opacity || 0.92,
          },
        });
        m.on('click', l.id, (e) => { if (e.features && e.features[0] && onSelectRef.current) onSelectRef.current(e.features[0], l.id); });
        m.on('mouseenter', l.id, () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', l.id, () => { m.getCanvas().style.cursor = ''; });
      }
      m.setPaintProperty(l.id, 'circle-color', l.color);
      m.setLayoutProperty(l.id, 'visibility', l.visible === false ? 'none' : 'visible');
    }
  };

  useEffect(() => {
    const m = new maplibregl.Map({
      container: box.current,
      style: BASE_STYLE,
      center,
      zoom,
      minZoom: 1,
      maxZoom: 12,
      attributionControl: false,
      renderWorldCopies: true,
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Coastlines: Natural Earth' }));
    m.on('load', () => {
      ready.current = true;
      if (fitBounds) m.fitBounds(fitBounds, { padding: 20, duration: 0 });
      sync();
    });
    map.current = m;
    return () => { ready.current = false; m.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { sync(); });

  return <div ref={box} style={{ width: '100%', height, borderRadius: 12, overflow: 'hidden' }} />;
}

export function toFeatures(rows, lonKey = 'lon', latKey = 'lat', props = (r) => r) {
  return {
    type: 'FeatureCollection',
    features: rows
      .filter((r) => Number.isFinite(Number(r[lonKey])) && Number.isFinite(Number(r[latKey])))
      .map((r) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [Number(r[lonKey]), Number(r[latKey])] }, properties: props(r) })),
  };
}

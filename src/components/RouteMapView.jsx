import React, { useRef, useEffect, useState, useCallback } from 'react';

const TILE = 256;
const MIN_Z = 10;
const MAX_Z = 18;

function ll2px(lat, lng, z) {
  const n = 1 << z;
  const x = ((lng + 180) / 360) * n * TILE;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n * TILE;
  return { x, y };
}

function bestFit(coords, w, h, pad = 40) {
  const lats = coords.map(c => c.lat), lngs = coords.map(c => c.lng);
  const lo = Math.min(...lats), hi = Math.max(...lats);
  const lL = Math.min(...lngs), lR = Math.max(...lngs);
  let z = MAX_Z;
  for (let i = MAX_Z; i >= MIN_Z; i--) {
    const tl = ll2px(hi, lL, i), br = ll2px(lo, lR, i);
    if (br.x - tl.x <= w - pad * 2 && br.y - tl.y <= h - pad * 2) { z = i; break; }
  }
  const cLat = (lo + hi) / 2, cLng = (lL + lR) / 2;
  return { z, cp: ll2px(cLat, cLng, z), cLat, cLng };
}

// Basemap: OpenFreeMap's dark vector style rendered by MapLibre GL. Keyless,
// no account, CORS-open (the share stamp snapshots the WebGL canvas, so
// tiles must load untainted). CARTO started watermarking keyless raster
// requests in Oct 2026. MapLibre is ~800 KB, so it loads on first use.
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/dark';
const MAP_ATTRIBUTION = '© OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors';

let maplibrePromise = null;
function loadMapLibre() {
  if (!maplibrePromise) {
    maplibrePromise = Promise.all([
      import('maplibre-gl'),
      import('maplibre-gl/dist/maplibre-gl.css'),
    ]).then(([mod]) => mod.default ?? mod).catch(err => { maplibrePromise = null; throw err; });
  }
  return maplibrePromise;
}

function routeBounds(coords) {
  const lats = coords.map(c => c.lat), lngs = coords.map(c => c.lng);
  return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
}

// Glow + line + start/end dots, matching the old SVG overlay.
function addRoute(map, coords, color) {
  const line = coords.map(c => [c.lng, c.lat]);
  map.addSource('route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } } });
  map.addSource('route-ends', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { c: '#00FF94' }, geometry: { type: 'Point', coordinates: line[0] } },
        { type: 'Feature', properties: { c: color }, geometry: { type: 'Point', coordinates: line[line.length - 1] } },
      ],
    },
  });
  const layout = { 'line-cap': 'round', 'line-join': 'round' };
  map.addLayer({ id: 'route-glow', type: 'line', source: 'route', layout, paint: { 'line-color': color, 'line-width': 6, 'line-opacity': 0.35 } });
  map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout, paint: { 'line-color': color, 'line-width': 3 } });
  map.addLayer({
    id: 'route-ends', type: 'circle', source: 'route-ends',
    paint: { 'circle-radius': 6, 'circle-color': ['get', 'c'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
  });
}

// Mounts a MapLibre map in `ref` with the route drawn on it. Interactive maps
// pan, pinch-zoom and two-finger rotate (no tilt); `onRotate` gets the bearing.
function useRouteMap(ref, { coordinates, color, interactive, padding, enabled = true, mapRef, onRotate }) {
  useEffect(() => {
    if (!enabled || !ref.current || !coordinates || coordinates.length < 2) return;
    let map = null, cancelled = false;
    loadMapLibre().then(({ Map }) => {
      if (cancelled || !ref.current) return;
      map = new Map({
        container: ref.current,
        style: MAP_STYLE,
        bounds: routeBounds(coordinates),
        fitBoundsOptions: { padding, maxZoom: 17 },
        maxZoom: 19,
        interactive,
        attributionControl: false,
        maxPitch: 0,
        pitchWithRotate: false,
        touchPitch: false,
      });
      if (mapRef) mapRef.current = map;
      if (onRotate) map.on('rotate', () => onRotate(map.getBearing()));
      map.on('load', () => addRoute(map, coordinates, color));
    }).catch(() => {});
    return () => {
      cancelled = true;
      map?.remove();
      if (mapRef) mapRef.current = null;
    };
  }, [ref, coordinates, color, interactive, padding, enabled, mapRef, onRotate]);
}

// One-off render of the basemap (no route) for the share stamp. Uses the
// same center and zoom as bestFit so the stamp's SVG route overlay, which is
// projected with ll2px, lines up. MapLibre zoom z-1 == 256px-tile zoom z.
// Resolves to a canvas of width×height CSS px at `pixelRatio`, or null.
function snapshotBasemap({ cLat, cLng, z, width, height, pixelRatio }) {
  return loadMapLibre().then(({ Map }) => new Promise(resolve => {
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;pointer-events:none;`;
    document.body.appendChild(el);
    let map = null, done = false;
    const finish = (out) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      map?.remove();
      el.remove();
      resolve(out);
    };
    const timer = setTimeout(() => finish(null), 10000);
    map = new Map({
      container: el,
      style: MAP_STYLE,
      center: [cLng, cLat],
      zoom: z - 1,
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
      pixelRatio,
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    map.once('idle', () => {
      const src = map.getCanvas();
      const out = document.createElement('canvas');
      out.width = src.width;
      out.height = src.height;
      out.getContext('2d').drawImage(src, 0, 0);
      finish(out);
    });
    map.on('error', () => {}); // a missing tile shouldn't abort the snapshot
  })).catch(() => null);
}

const RouteMapView = ({ coordinates = [], color = '#00D1FF', height = 200 }) => {
  const previewRef = useRef(null);
  const fsRef = useRef(null);
  const fsMapRef = useRef(null);
  const [fs, setFs] = useState(false);
  const [bearing, setBearing] = useState(0);

  useRouteMap(previewRef, { coordinates, color, interactive: false, padding: 30 });
  useRouteMap(fsRef, { coordinates, color, interactive: true, padding: 60, enabled: fs, mapRef: fsMapRef, onRotate: setBearing });

  const openFs = useCallback(() => {
    setFs(true);
    document.body.style.overflow = 'hidden';
  }, []);

  const closeFs = useCallback(() => {
    setFs(false);
    setBearing(0);
    document.body.style.overflow = '';
  }, []);

  // Open in Apple Maps
  const openMaps = useCallback(() => {
    if (!coordinates?.length) return;
    const lats = coordinates.map(c => c.lat), lngs = coordinates.map(c => c.lng);
    const lat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const lng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
    window.location.href = `maps://?ll=${lat},${lng}&z=15`;
  }, [coordinates]);

  if (!coordinates || coordinates.length < 2) return null;

  return (
    <>
      {/* Inline preview — non-interactive, tap to expand */}
      <div
        onClick={openFs}
        style={{
          width: '100%', height, borderRadius: 12, overflow: 'hidden',
          position: 'relative', backgroundColor: '#1a1a2e', cursor: 'pointer',
        }}
      >
        <div ref={previewRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: 2, right: 6, fontSize: 8, color: 'rgba(255,255,255,0.3)', pointerEvents: 'none' }}>
          {MAP_ATTRIBUTION}
        </div>
        <div style={{
          position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: '50%',
          backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </div>
      </div>

      {/* Fullscreen interactive map — MapLibre handles pan and pinch-zoom */}
      {fs && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, backgroundColor: '#1a1a2e' }}>
          <div ref={fsRef} style={{ position: 'absolute', inset: 0 }} />

          {/* X to close map, compass (only once rotated) to reset north */}
          <div style={{
            position: 'absolute', top: 70, left: 0, right: 0, zIndex: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0 16px', pointerEvents: 'none',
          }}>
            <div
              onClick={(e) => { e.stopPropagation(); closeFs(); }}
              style={{
                width: 44, height: 44, borderRadius: '50%',
                backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(10px)',
                color: '#fff', fontSize: 22,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', pointerEvents: 'auto',
              }}
            >
              ×
            </div>
            {Math.abs(bearing) > 0.5 && (
              <div
                onClick={(e) => { e.stopPropagation(); fsMapRef.current?.resetNorth(); }}
                style={{
                  width: 44, height: 44, borderRadius: '50%',
                  backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(10px)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', pointerEvents: 'auto',
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" style={{ transform: `rotate(${-bearing}deg)` }}>
                  <polygon points="12,2 16,12 8,12" fill="#fff" />
                  <polygon points="12,22 16,12 8,12" fill="rgba(255,255,255,0.35)" />
                </svg>
              </div>
            )}
          </div>

          {/* Open in Maps button */}
          <div
            onClick={(e) => { e.stopPropagation(); openMaps(); }}
            style={{
              position: 'absolute', bottom: 50, left: '50%', zIndex: 10,
              transform: 'translateX(-50%)',
              padding: '10px 24px', borderRadius: 22,
              backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(12px)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: '#fff', fontSize: 15, fontWeight: 500, whiteSpace: 'nowrap',
              cursor: 'pointer',
            }}
          >
            Open in Maps
          </div>

          {/* Attribution */}
          <div style={{
            position: 'absolute', bottom: 16, right: 8, zIndex: 10,
            fontSize: 9, color: 'rgba(255,255,255,0.35)', pointerEvents: 'none',
          }}>
            {MAP_ATTRIBUTION}
          </div>
        </div>
      )}
    </>
  );
};

export { ll2px, bestFit, snapshotBasemap };
export default RouteMapView;

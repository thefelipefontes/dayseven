import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';

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

function makeTiles(coords, w, h, z, cp, dark, margin = 0) {
  const vl = cp.x - w / 2, vt = cp.y - h / 2;
  const txMin = Math.floor(vl / TILE) - margin, tyMin = Math.floor(vt / TILE) - margin;
  const txMax = Math.floor((vl + w) / TILE) + margin, tyMax = Math.floor((vt + h) / TILE) + margin;
  const maxT = (1 << z) - 1;
  const tiles = [];
  for (let ty = tyMin; ty <= tyMax; ty++) {
    for (let tx = txMin; tx <= txMax; tx++) {
      const wtx = ((tx % (maxT + 1)) + (maxT + 1)) % (maxT + 1);
      if (ty < 0 || ty > maxT) continue;
      const s = ['a', 'b', 'c', 'd'][(wtx + ty) % 4];
      const base = dark ? 'dark_all' : 'rastertiles/voyager';
      tiles.push({
        key: `${z}/${wtx}/${ty}`,
        left: tx * TILE - vl, top: ty * TILE - vt,
        url: `https://${s}.basemaps.cartocdn.com/${base}/${z}/${wtx}/${ty}@2x.png`,
      });
    }
  }
  const pts = coords.map(c => {
    const p = ll2px(c.lat, c.lng, z);
    return { x: p.x - vl, y: p.y - vt };
  });
  return { tiles, pts };
}

const RouteOverlay = ({ pts, w, h, color }) => {
  if (!pts || pts.length < 2) return null;
  const s = pts[0], e = pts[pts.length - 1];
  const d = pts.map(p => `${p.x},${p.y}`).join(' ');
  return (
    <svg width={w} height={h} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
      <polyline points={d} fill="none" stroke={color} strokeWidth="6" strokeOpacity="0.35" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={d} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={s.x} cy={s.y} r={6} fill="#00FF94" stroke="#fff" strokeWidth={2} />
      <circle cx={e.x} cy={e.y} r={6} fill={color} stroke="#fff" strokeWidth={2} />
    </svg>
  );
};

const TileLayer = ({ tiles }) => tiles.map(t => (
  <img key={t.key} src={t.url} alt="" draggable={false}
    style={{ position: 'absolute', left: t.left, top: t.top, width: TILE, height: TILE, pointerEvents: 'none' }} />
));

const RouteMapView = ({ coordinates = [], color = '#00D1FF', height = 200 }) => {
  const containerRef = useRef(null);
  const wrapperRef = useRef(null);
  const [cw, setCw] = useState(0);
  const [fs, setFs] = useState(false);
  const [fsZ, setFsZ] = useState(14);
  const [fsCp, setFsCp] = useState({ x: 0, y: 0 });
  const [dims, setDims] = useState({ w: 375, h: 700 });
  const touch = useRef({});
  const residualRef = useRef(1); // fractional scale between integer tile zoom levels

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(e => setCw(e[0].contentRect.width));
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Preview — dark tiles, no margin
  const preview = useMemo(() => {
    if (!coordinates?.length || coordinates.length < 2 || !cw) return null;
    const fit = bestFit(coordinates, cw, height);
    const { tiles, pts } = makeTiles(coordinates, cw, height, fit.z, fit.cp, true, 0);
    return { tiles, pts, W: cw, H: height };
  }, [coordinates, cw, height]);

  // Fullscreen — Voyager tiles with margin=3 so zoom-out has tile coverage
  const fsData = useMemo(() => {
    if (!fs || !coordinates?.length || coordinates.length < 2) return null;
    return makeTiles(coordinates, dims.w, dims.h, fsZ, fsCp, false, 3);
  }, [fs, coordinates, dims.w, dims.h, fsZ, fsCp]);

  const openFs = useCallback(() => {
    const w = window.innerWidth, h = window.innerHeight;
    setDims({ w, h });
    if (coordinates.length >= 2) {
      const fit = bestFit(coordinates, w, h, 60);
      setFsZ(fit.z);
      setFsCp(fit.cp);
    }
    residualRef.current = 1;
    setFs(true);
    document.body.style.overflow = 'hidden';
  }, [coordinates]);

  const closeFs = useCallback(() => {
    setFs(false);
    document.body.style.overflow = '';
    if (wrapperRef.current) {
      wrapperRef.current.style.transform = '';
      wrapperRef.current.style.transformOrigin = '';
    }
    touch.current = {};
    residualRef.current = 1;
  }, []);

  // --- Commit gesture: recalculate map state, keep fractional zoom via residual ---
  const commitGesture = useCallback((ts) => {
    const el = wrapperRef.current;
    const R = residualRef.current;
    if (ts.mode === 'pan') {
      const dx = ts.dx || 0, dy = ts.dy || 0;
      // Pan is in screen pixels; convert to world pixels by dividing by residual
      setFsCp(prev => ({ x: prev.x - dx / R, y: prev.y - dy / R }));
    } else if (ts.mode === 'pinch') {
      const gs = ts.scale || 1;
      const dmx = ts.dx || 0, dmy = ts.dy || 0;
      const baseR = ts.baseResidual ?? R;
      const baseZ = ts.baseZ ?? fsZ;
      const totalScale = baseR * gs;
      // Exact fractional zoom
      const exactZoom = Math.max(MIN_Z, Math.min(MAX_Z, baseZ + Math.log2(totalScale)));
      const newTileZ = Math.floor(exactZoom);
      const newResidual = Math.pow(2, exactZoom - newTileZ);
      // Figure out what world point is at viewport center after the visual transform
      const ox = ts.originX ?? dims.w / 2;
      const oy = ts.originY ?? dims.h / 2;
      const W = dims.w, H = dims.h;
      const cx = (W / 2 - dmx - ox) / (totalScale) + ox;
      const cy = (H / 2 - dmy - oy) / (totalScale) + oy;
      const baseCp = ts.baseCp ?? fsCp;
      // World coords at base tile zoom level
      const worldX = baseCp.x - W / 2 / baseR + cx / baseR;
      const worldY = baseCp.y - H / 2 / baseR + cy / baseR;
      // Scale world coords to new tile zoom level
      const factor = Math.pow(2, newTileZ - baseZ);
      residualRef.current = newResidual;
      setFsZ(newTileZ);
      setFsCp({ x: worldX * factor, y: worldY * factor });
    }
    if (el) {
      const nr = residualRef.current;
      const W = dims.w, H = dims.h;
      // Apply persistent residual scale from center of viewport
      const tx = W / 2 * (1 - nr);
      const ty = H / 2 * (1 - nr);
      el.style.transform = `translate(${tx}px,${ty}px) scale(${nr})`;
      el.style.transformOrigin = '0 0';
    }
  }, [dims, fsZ, fsCp]);

  const onTouchStart = useCallback((e) => {
    const t = e.touches;
    const ts = touch.current;
    const R = residualRef.current;
    if (t.length === 1 && ts.mode !== 'pinch') {
      ts.mode = 'pan';
      ts.startX = t[0].clientX;
      ts.startY = t[0].clientY;
      ts.dx = 0; ts.dy = 0;
    } else if (t.length >= 2) {
      // Commit pending pan
      if (ts.mode === 'pan' && (ts.dx || ts.dy)) {
        setFsCp(prev => ({ x: prev.x - (ts.dx || 0) / R, y: prev.y - (ts.dy || 0) / R }));
      }
      ts.mode = 'pinch';
      ts.baseDist = Math.hypot(t[1].clientX - t[0].clientX, t[1].clientY - t[0].clientY);
      ts.originX = (t[0].clientX + t[1].clientX) / 2;
      ts.originY = (t[0].clientY + t[1].clientY) / 2;
      ts.baseCp = { ...fsCp };
      ts.baseZ = fsZ;
      ts.baseResidual = R;
      ts.dx = 0; ts.dy = 0; ts.scale = 1;
      if (wrapperRef.current) {
        // Reset to just the residual scale from center
        const W = dims.w, H = dims.h;
        const tx = W / 2 * (1 - R);
        const ty = H / 2 * (1 - R);
        wrapperRef.current.style.transform = `translate(${tx}px,${ty}px) scale(${R})`;
        wrapperRef.current.style.transformOrigin = '0 0';
      }
    }
  }, [fsCp, fsZ, dims]);

  const onTouchMove = useCallback((e) => {
    e.preventDefault();
    const t = e.touches;
    const ts = touch.current;
    const el = wrapperRef.current;
    if (!el) return;

    const R = residualRef.current;
    if (ts.mode === 'pan' && t.length === 1) {
      const dx = t[0].clientX - ts.startX;
      const dy = t[0].clientY - ts.startY;
      ts.dx = dx; ts.dy = dy;
      // Compose pan on top of the persistent residual scale from center
      const W = dims.w, H = dims.h;
      const tx = W / 2 * (1 - R) + dx;
      const ty = H / 2 * (1 - R) + dy;
      el.style.transform = `translate(${tx}px,${ty}px) scale(${R})`;
      el.style.transformOrigin = '0 0';
    } else if (ts.mode === 'pinch' && t.length >= 2) {
      const dist = Math.hypot(t[1].clientX - t[0].clientX, t[1].clientY - t[0].clientY);
      const gs = dist / ts.baseDist;
      const mx = (t[0].clientX + t[1].clientX) / 2;
      const my = (t[0].clientY + t[1].clientY) / 2;
      const dmx = mx - ts.originX, dmy = my - ts.originY;
      ts.scale = gs; ts.dx = dmx; ts.dy = dmy;
      // Compose: residual scale from center + gesture scale from pinch origin + pan
      const baseR = ts.baseResidual ?? R;
      const totalScale = baseR * gs;
      const ox = ts.originX;
      const oy = ts.originY;
      const W = dims.w, H = dims.h;
      // Transform: first apply baseR from center, then apply gesture (scale gs from origin + translate)
      const tx = ox * (1 - gs) + gs * W / 2 * (1 - baseR) + dmx;
      const ty = oy * (1 - gs) + gs * H / 2 * (1 - baseR) + dmy;
      el.style.transform = `translate(${tx}px,${ty}px) scale(${totalScale})`;
      el.style.transformOrigin = '0 0';
    }
  }, [dims]);

  const onTouchEnd = useCallback((e) => {
    const ts = touch.current;
    if (e.touches.length === 0) {
      commitGesture(ts);
      touch.current = {};
    } else if (e.touches.length === 1 && ts.mode === 'pinch') {
      commitGesture(ts);
      touch.current = {
        mode: 'pan',
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        dx: 0, dy: 0,
      };
    }
  }, [commitGesture]);

  // Apply residual scale whenever fsData updates (new tiles loaded after commit)
  useEffect(() => {
    if (!fs || !wrapperRef.current) return;
    const R = residualRef.current;
    if (R !== 1) {
      const W = dims.w, H = dims.h;
      const tx = W / 2 * (1 - R);
      const ty = H / 2 * (1 - R);
      wrapperRef.current.style.transform = `translate(${tx}px,${ty}px) scale(${R})`;
      wrapperRef.current.style.transformOrigin = '0 0';
    }
  }, [fs, fsData, dims]);

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
      {/* Inline preview — dark tiles, tappable */}
      <div
        ref={containerRef}
        onClick={openFs}
        style={{
          width: '100%', height, borderRadius: 12, overflow: 'hidden',
          position: 'relative', backgroundColor: '#1a1a2e', cursor: 'pointer',
        }}
      >
        {preview && (
          <>
            <TileLayer tiles={preview.tiles} />
            <RouteOverlay pts={preview.pts} w={preview.W} h={preview.H} color={color} />
            <div style={{ position: 'absolute', bottom: 2, right: 6, fontSize: 8, color: 'rgba(255,255,255,0.3)', pointerEvents: 'none' }}>
              © OpenStreetMap
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
          </>
        )}
      </div>

      {/* Fullscreen interactive map */}
      {fs && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, backgroundColor: '#f2efe9' }}>
          {/* Map touch area — NO overflow:hidden so margin tiles stay visible during zoom */}
          <div
            style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            <div
              ref={wrapperRef}
              style={{ position: 'relative', width: dims.w, height: dims.h, willChange: 'transform' }}
            >
              {fsData && (
                <>
                  <TileLayer tiles={fsData.tiles} />
                  <RouteOverlay pts={fsData.pts} w={dims.w} h={dims.h} color={color} />
                </>
              )}
            </div>
          </div>

          {/* X to close map */}
          <div style={{
            position: 'absolute', top: 70, left: 0, right: 0, zIndex: 10,
            display: 'flex', alignItems: 'center',
            padding: '0 16px',
          }}>
            <div
              onTouchStart={(e) => { e.stopPropagation(); }}
              onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); closeFs(); }}
              onClick={(e) => { e.stopPropagation(); closeFs(); }}
              style={{
                width: 44, height: 44, borderRadius: '50%',
                backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(10px)',
                color: '#fff', fontSize: 22,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              ×
            </div>
          </div>

          {/* Open in Maps button */}
          <div
            onTouchStart={(e) => { e.stopPropagation(); }}
            onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); openMaps(); }}
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
            fontSize: 9, color: 'rgba(0,0,0,0.35)',
          }}>
            © OpenStreetMap
          </div>
        </div>
      )}
    </>
  );
};

export { ll2px, bestFit, makeTiles, RouteOverlay, TileLayer, TILE };
export default RouteMapView;

import React, { useMemo } from 'react';

const RouteMapView = ({ coordinates = [], color = '#FF9500', height = 180 }) => {
  const svgData = useMemo(() => {
    if (!coordinates || coordinates.length < 2) return null;

    const lats = coordinates.map(c => c.lat);
    const lngs = coordinates.map(c => c.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const latRange = maxLat - minLat || 0.001;
    const lngRange = maxLng - minLng || 0.001;

    const PAD = 20;
    const W = 320;
    const H = height;
    const innerW = W - PAD * 2;
    const innerH = H - PAD * 2;

    // Correct longitude distortion at this latitude
    const midLat = (minLat + maxLat) / 2;
    const cosLat = Math.cos((midLat * Math.PI) / 180);
    const correctedLngRange = lngRange * cosLat;

    // Scale to fit the larger dimension
    const scale = Math.min(
      innerW / (correctedLngRange || 0.001),
      innerH / (latRange || 0.001)
    );

    const toX = (lng) => PAD + ((lng - minLng) * cosLat * scale + (innerW - correctedLngRange * scale) / 2);
    const toY = (lat) => PAD + ((maxLat - lat) * scale + (innerH - latRange * scale) / 2);

    const points = coordinates
      .map(c => `${toX(c.lng).toFixed(1)},${toY(c.lat).toFixed(1)}`)
      .join(' ');

    const start = coordinates[0];
    const end = coordinates[coordinates.length - 1];

    return {
      points,
      W,
      H,
      startX: toX(start.lng),
      startY: toY(start.lat),
      endX: toX(end.lng),
      endY: toY(end.lat),
    };
  }, [coordinates, height]);

  if (!svgData || coordinates.length < 2) return null;

  const { points, W, H, startX, startY, endX, endY } = svgData;

  return (
    <div style={{ width: '100%', backgroundColor: '#111', borderRadius: 12, overflow: 'hidden' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height, display: 'block' }}
        aria-label="Workout route map"
      >
        {/* Glow layer */}
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeOpacity="0.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Main route line */}
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Start marker — green */}
        <circle cx={startX} cy={startY} r={5} fill="#00FF94" stroke="#111" strokeWidth={1.5} />
        {/* End marker — activity color */}
        <circle cx={endX} cy={endY} r={5} fill={color} stroke="#111" strokeWidth={1.5} />
      </svg>
    </div>
  );
};

export default RouteMapView;

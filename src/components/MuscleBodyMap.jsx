import React, { useMemo } from 'react';
import Body from 'react-muscle-highlighter';

// Map our muscle group names to react-muscle-highlighter slugs
const MUSCLE_MAP = {
  'Chest': ['chest'],
  'Back': ['upper-back', 'lower-back', 'trapezius'],
  'Shoulders': ['deltoids'],
  'Biceps': ['biceps'],
  'Triceps': ['triceps'],
  'Quads': ['quadriceps'],
  'Hamstrings': ['hamstring'],
  'Calves': ['calves'],
  'Glutes': ['gluteal'],
  'Adductors': ['adductors'],
  'Abs': ['abs', 'obliques'],
};

const MuscleBodyMap = ({ muscleData = {}, scale: scaleProp = 1, hideLabels = false }) => {
  const maxCount = useMemo(() => {
    const values = Object.values(muscleData);
    return values.length > 0 ? Math.max(...values) : 1;
  }, [muscleData]);

  const colors = useMemo(() => {
    const arr = [];
    for (let i = 1; i <= Math.max(maxCount, 1); i++) {
      // When there's only one intensity level, use full brightness
      const intensity = maxCount <= 1 ? 1.0 : 0.10 + 0.90 * ((i - 1) / (maxCount - 1));
      arr.push(`rgba(0, 255, 148, ${intensity.toFixed(2)})`);
    }
    return arr;
  }, [maxCount]);

  const data = useMemo(() => {
    const parts = [];
    Object.entries(muscleData).forEach(([name, count]) => {
      const slugs = MUSCLE_MAP[name] || [];
      slugs.forEach(slug => {
        parts.push({ slug, intensity: count });
      });
    });
    return parts;
  }, [muscleData]);

  // Hair is hidden; head is patched to a simple bald oval via patch-package
  const hiddenParts = ['hair'];

  return (
    <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-start', justifyContent: 'center', overflow: 'hidden' }}>
      <div style={{ flex: 1, textAlign: 'center' }}>
        <Body
          data={data}
          side="front"
          gender="male"
          colors={colors}
          scale={scaleProp}
          border="none"
          hiddenParts={hiddenParts}
          defaultFill="rgba(255,255,255,0.06)"
          defaultStroke="rgba(255,255,255,0.15)"
          defaultStrokeWidth={0.5}
        />
        {!hideLabels && <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.3)', marginTop: '-8px', letterSpacing: '1px' }}>FRONT</div>}
      </div>
      <div style={{ flex: 1, textAlign: 'center' }}>
        <Body
          data={data}
          side="back"
          gender="male"
          colors={colors}
          scale={scaleProp}
          border="none"
          hiddenParts={hiddenParts}
          defaultFill="rgba(255,255,255,0.06)"
          defaultStroke="rgba(255,255,255,0.15)"
          defaultStrokeWidth={0.5}
        />
        {!hideLabels && <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.3)', marginTop: '-8px', letterSpacing: '1px' }}>BACK</div>}
      </div>
    </div>
  );
};

export default MuscleBodyMap;

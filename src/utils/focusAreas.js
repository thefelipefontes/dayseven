export const FOCUS_AREA_GROUPS = {
  'Upper Body': ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps'],
  'Lower Body': ['Quads', 'Hamstrings', 'Glutes', 'Adductors', 'Calves'],
  'Core': ['Abs']
};
export const ALL_FOCUS_AREAS = Object.values(FOCUS_AREA_GROUPS).flat();

// Migrate old focus area names → new specific muscles
export const FOCUS_AREA_MIGRATION = {
  'Full Body': [...FOCUS_AREA_GROUPS['Upper Body'], ...FOCUS_AREA_GROUPS['Lower Body'], 'Abs'],
  'Upper': FOCUS_AREA_GROUPS['Upper Body'],
  'Lower': FOCUS_AREA_GROUPS['Lower Body'],
  'Legs': FOCUS_AREA_GROUPS['Lower Body'],
};
export const normalizeFocusAreas = (areas) => {
  if (!areas || areas.length === 0) return areas;
  const result = new Set();
  areas.forEach(a => {
    if (FOCUS_AREA_MIGRATION[a]) {
      FOCUS_AREA_MIGRATION[a].forEach(m => result.add(m));
    } else {
      result.add(a);
    }
  });
  return [...result];
};

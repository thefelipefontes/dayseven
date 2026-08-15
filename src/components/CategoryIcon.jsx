import React from 'react';
import { BicepsFlexed, Footprints } from 'lucide-react';
import { IconHeartbeat, IconSnowflake, IconFlame } from '@tabler/icons-react';

// The app's icon vocabulary: the three weekly-goal categories (was 💪 / ❤️ / 🧊) plus the two
// daily Apple Health metrics (was 👟 / 🔥).
//
// One mapping, one place. These marks appear on Home, Profile, the share cards, the weekly
// planner, Settings, and every stats modal — before this component each surface spelled the
// emoji out inline, which is how the app ended up with a flaming heart in eight files and a
// plain one in none.
//
// Note the icons come from two different packs and the packs disagree on the stroke prop:
// lucide (BicepsFlexed) takes `strokeWidth`, Tabler takes `stroke`. Passing either one by
// name would silently apply to two of the three and leave the odd one out at a different
// weight, so this component passes neither — both packs default to 2, which is what keeps
// the set visually matched. Change weight here only if you handle both names.

// Calories is a flame, which does overlap the 🔥 streak marker metaphorically — that overlap
// is accepted, not overlooked. Every alternative collides harder with something already in
// use: a bolt is the Challenges tab AND SectionIcon's `streak`; a pulse is SectionIcon's
// `activity`, which sits in the "Today's Activity" header directly above this very card. In
// practice the two flames read differently anyway — the streak is a full-color emoji, this is
// a monochrome line icon — and flame-for-calories is the convention users arrive with.
export const CATEGORY_ICONS = {
  lifts: BicepsFlexed,
  cardio: IconHeartbeat,
  recovery: IconSnowflake,
  steps: Footprints,
  calories: IconFlame,
};

export const CATEGORY_COLORS = {
  lifts: '#00FF94',
  cardio: '#FF9500',
  recovery: '#00D1FF',
  steps: '#BF5AF2',
  calories: '#FF9500',
};

// Aliases for the names the older surfaces use for the same things.
const ALIASES = {
  strength: 'lifts',
  lifting: 'lifts',
  lift: 'lifts',
  cardio: 'cardio',
  recovery: 'recovery',
  cals: 'calories',
  activeCalories: 'calories',
};

/**
 * @param {string} category  'lifts' | 'cardio' | 'recovery' | 'steps' | 'calories'
 *                           (plus 'strength'/'lifting'/'cals' aliases)
 * @param {number} [size]    px, defaults to 16 — matches the 14px label text it sits beside
 * @param {string} [color]   defaults to the category's ring color; pass '#fff' to mute it
 */
const CategoryIcon = ({ category, size = 16, color, className, style }) => {
  const key = ALIASES[category] || category;
  const Icon = CATEGORY_ICONS[key];
  if (!Icon) return null;
  return (
    <Icon
      size={size}
      color={color || CATEGORY_COLORS[key]}
      className={className}
      style={style}
    />
  );
};

export default CategoryIcon;

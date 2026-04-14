import React from 'react';
import { Dumbbell, BicepsFlexed } from 'lucide-react';
import {
  IconBarbell,
  IconRefresh,
  IconRun,
  IconBike,
  IconBallFootball,
  IconBallAmericanFootball,
  IconStairsUp,
  IconYoga,
  IconStretching,
  IconWalk,
  IconSnowflake,
  IconFlame,
  IconCirclePlus,
  // Icon picker - Fitness
  IconWeight,
  IconStretching2,
  // Icon picker - Cardio
  IconHeartbeat,
  IconTrendingUp,
  IconBolt,
  // Icon picker - Ball Sports
  IconBallVolleyball,
  IconPlayBasketball,
  IconGolf,
  IconBallTennis,
  IconBallBaseball,
  IconPingPong,
  IconCricket,
  // Icon picker - Target & Archery
  IconTarget,
  IconArcheryArrow,
  IconBow,
  // Icon picker - Water Sports
  IconSwimming,
  IconPool,
  IconWaterpolo,
  IconKayak,
  IconSailboat,
  IconFish,
  // Icon picker - Winter Sports
  IconMountain,
  IconSkiJumping,
  IconSnowboarding,
  IconAerialLift,
  // Icon picker - Combat
  IconKarate,
  IconSword,
  IconShield,
  IconFence,
  // Icon picker - Recovery
  IconHeart,
  IconDroplets,
  IconMassage,
  IconBone,
  // Icon picker - Other
  IconTrophy,
  IconMedal,
  IconStar,
  IconClock,
  IconJumpRope,
  // Uncategorized activity types (from Apple Health)
  IconMusic,
} from '@tabler/icons-react';

// ─── Custom SVG Icons (no Tabler equivalent) ───

/** Elliptical machine — person on elliptical with handles (matches SF Symbol figure.elliptical) */
const EllipticalIcon = ({ size = 24, color = 'currentColor', className = '', strokeWidth = 2 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    {/* Head */}
    <circle cx="11" cy="4" r="2" />
    {/* Body — slight lean forward */}
    <path d="M11 6l1 5" />
    {/* Left arm — gripping front handle */}
    <path d="M11 8l-3 0v-3" />
    {/* Right arm — gripping rear handle */}
    <path d="M12 9l4-1v-3" />
    {/* Front leg — extended forward on pedal */}
    <path d="M12 11l-4 6" />
    {/* Rear leg — extended back on pedal */}
    <path d="M12 11l4 4" />
    {/* Machine base */}
    <path d="M6 20l4-3" />
    <path d="M18 20l-2-5" />
    <path d="M5 20h14" />
  </svg>
);

// ─── Category Colors ───

const CATEGORY_COLORS = {
  strength: '#00FF94',
  cardio: '#FF9500',
  recovery: '#00D1FF',
  hybrid: '#C4B5FD',
  other: '#9CA3AF',
  uncategorized: '#FFC800',
};

// ─── Activity type → icon + category mapping ───
// NOTE: 'strength' category uses 'lifting' internally for countToward (see functions/index.js)
// Flattened strength types (Weightlifting, Bodyweight, Circuit) are now top-level entries.
// 'Strength Training' is kept as a fallback for old saved activities.
const ICON_MAP = {
  // Strength (flattened — these appear directly in the activity selector)
  'Weightlifting':       { Icon: Dumbbell, category: 'strength' },
  'Bodyweight':          { Icon: BicepsFlexed, category: 'strength' },  // Keep Lucide
  'Circuit':             { Icon: IconRefresh, category: 'strength' },
  'Strength Training':   { Icon: Dumbbell, category: 'strength' }, // Fallback for old data
  // Cardio
  'Running':             { Icon: IconRun, category: 'cardio' },
  'Cycle':               { Icon: IconBike, category: 'cardio' },
  'Sports':              { Icon: IconBallFootball, category: 'cardio' },  // Fallback for old data / custom "Other" sports
  // Team / competitive sports (auto-categorized as cardio)
  'Basketball':          { Icon: IconPlayBasketball, category: 'cardio' },
  'Soccer':              { Icon: IconBallFootball, category: 'cardio' },
  'Football':            { Icon: IconBallAmericanFootball, category: 'cardio' },
  'Tennis':              { Icon: IconBallTennis, category: 'cardio' },
  'Golf':                { Icon: IconGolf, category: 'cardio' },
  'Badminton':           { Icon: IconBallTennis, category: 'cardio' },
  'Boxing':              { Icon: IconKarate, category: 'cardio' },
  'Martial Arts':        { Icon: IconKarate, category: 'cardio' },
  'Baseball':            { Icon: IconBallBaseball, category: 'cardio' },
  'Volleyball':          { Icon: IconBallVolleyball, category: 'cardio' },
  'Hockey':              { Icon: IconBallFootball, category: 'cardio' },
  'Lacrosse':            { Icon: IconBallFootball, category: 'cardio' },
  'Rugby':               { Icon: IconBallAmericanFootball, category: 'cardio' },
  'Softball':            { Icon: IconBallBaseball, category: 'cardio' },
  'Squash':              { Icon: IconBallTennis, category: 'cardio' },
  'Table Tennis':        { Icon: IconPingPong, category: 'cardio' },
  'Racquetball':         { Icon: IconBallTennis, category: 'cardio' },
  'Handball':            { Icon: IconBallVolleyball, category: 'cardio' },
  'Pickleball':          { Icon: IconPingPong, category: 'cardio' },
  'Cricket':             { Icon: IconCricket, category: 'cardio' },
  'Australian Football': { Icon: IconBallAmericanFootball, category: 'cardio' },
  'Wrestling':           { Icon: IconKarate, category: 'cardio' },
  'Fencing':             { Icon: IconFence, category: 'cardio' },
  'Curling':             { Icon: IconTarget, category: 'cardio' },
  'Bowling':             { Icon: IconTarget, category: 'cardio' },
  'Stair Climbing':      { Icon: IconStairsUp, category: 'cardio' },
  'Elliptical':          { Icon: EllipticalIcon, category: 'cardio' },  // Keep custom
  // Hybrid
  'Yoga':                { Icon: IconYoga, category: 'hybrid' },
  'Pilates':             { Icon: IconStretching, category: 'hybrid' },
  'Walking':             { Icon: IconWalk, category: 'hybrid' },
  // Recovery
  'Cold Plunge':         { Icon: IconSnowflake, category: 'recovery' },
  'Sauna':               { Icon: IconFlame, category: 'recovery' },
  'Contrast Therapy':    { Icon: IconDroplets, category: 'recovery' },
  'Massage':             { Icon: IconMassage, category: 'recovery' },
  'Chiropractic':        { Icon: IconBone, category: 'recovery' },
  // Uncategorized (from Apple Health — user needs to assign a goal category)
  'Swimming':            { Icon: IconSwimming, category: 'other' },
  'Hiking':              { Icon: IconMountain, category: 'other' },
  'Dance':               { Icon: IconMusic, category: 'other' },
  'Rowing':              { Icon: IconKayak, category: 'cardio' },
  'Ski Trainer':         { Icon: IconSkiJumping, category: 'cardio' },
  'Cooldown':            { Icon: IconSnowflake, category: 'other' },
  // Combat / martial arts
  'Kickboxing':          { Icon: IconKarate, category: 'other' },
  // Mind & body
  'Tai Chi':             { Icon: IconYoga, category: 'other' },
  'Barre':               { Icon: IconStretching2, category: 'other' },
  'Gymnastics':          { Icon: IconStretching2, category: 'other' },
  // Auto-categorized cardio (from Apple Health — specific icon, counts as cardio)
  'Track & Field':       { Icon: IconRun, category: 'cardio' },
  'Jump Rope':           { Icon: IconJumpRope, category: 'cardio' },
  'Downhill Skiing':     { Icon: IconSkiJumping, category: 'cardio' },
  'Cross Country Skiing': { Icon: IconSkiJumping, category: 'cardio' },
  'Snowboarding':        { Icon: IconSnowboarding, category: 'cardio' },
  'Skating':             { Icon: IconSnowflake, category: 'cardio' },
  'Surfing':             { Icon: IconPool, category: 'cardio' },
  'Water Polo':          { Icon: IconWaterpolo, category: 'cardio' },
  'Paddle Sports':       { Icon: IconKayak, category: 'cardio' },
  // Outdoor / adventure
  'Climbing':            { Icon: IconMountain, category: 'other' },
  'Archery':             { Icon: IconArcheryArrow, category: 'other' },
  'Equestrian':          { Icon: IconTrophy, category: 'other' },
  'Hunting':             { Icon: IconTarget, category: 'other' },
  // Winter sports
  'Snow Sports':         { Icon: IconSnowflake, category: 'other' },
  // Water sports
  'Sailing':             { Icon: IconSailboat, category: 'other' },
  'Fishing':             { Icon: IconFish, category: 'other' },
  'Water Fitness':       { Icon: IconSwimming, category: 'other' },
  'Water Sports':        { Icon: IconPool, category: 'other' },
  // Cardio / general
  'Step Training':       { Icon: IconStairsUp, category: 'other' },
  'Mixed Cardio':        { Icon: IconHeartbeat, category: 'other' },
  'Triathlon':           { Icon: IconSwimming, category: 'other' },
  'Fitness Gaming':      { Icon: IconBolt, category: 'other' },
  'Play':                { Icon: IconBolt, category: 'other' },
  // Other
  'Other':               { Icon: IconCirclePlus, category: 'other' },
};

// Sport subtype → Tabler icon mapping (for type='Sports' activities)
const SPORT_SUBTYPE_ICON_MAP = {
  'Basketball':          IconPlayBasketball,
  'Soccer':              IconBallFootball,
  'Football':            IconBallAmericanFootball,
  'Tennis':              IconBallTennis,
  'Golf':                IconGolf,
  'Badminton':           IconBallTennis,
  'Boxing':              IconKarate,
  'Martial Arts':        IconKarate,
  'Volleyball':          IconBallVolleyball,
  'Hockey':              IconBallFootball,
  'Lacrosse':            IconBallFootball,
  'Rugby':               IconBallAmericanFootball,
  'Softball':            IconBallBaseball,
  'Squash':              IconBallTennis,
  'Table Tennis':        IconPingPong,
  'Racquetball':         IconBallTennis,
  'Handball':            IconBallVolleyball,
  'Pickleball':          IconPingPong,
  'Cricket':             IconCricket,
  'Australian Football': IconBallAmericanFootball,
  'Wrestling':           IconKarate,
  'Fencing':             IconFence,
  'Curling':             IconTarget,
  'Bowling':             IconTarget,
};

// Strength training subtype icons (kept for backwards compat with old data that has strengthType field)
const STRENGTH_TYPE_ICONS = {
  'Weightlifting': Dumbbell,
  'Bodyweight':    BicepsFlexed,
  'Circuit':       IconRefresh,
};

// ─── Icon Picker Options (for "Other" custom activities) ───
// Sports & fitness focused icon set, organized by category with labels
const ICON_PICKER_CATEGORIES = [
  {
    label: 'Fitness',
    icons: [
      { name: 'Dumbbell', Icon: Dumbbell },
      { name: 'BicepsFlexed', Icon: BicepsFlexed },
      { name: 'IconBarbell', Icon: IconBarbell },
      { name: 'IconWeight', Icon: IconWeight },
      { name: 'IconStretching2', Icon: IconStretching2 },
      { name: 'IconRefresh', Icon: IconRefresh },
      { name: 'IconJumpRope', Icon: IconJumpRope },
    ],
  },
  {
    label: 'Cardio',
    icons: [
      { name: 'IconBike', Icon: IconBike },
      { name: 'IconWalk', Icon: IconWalk },
      { name: 'IconHeartbeat', Icon: IconHeartbeat },
      { name: 'IconTrendingUp', Icon: IconTrendingUp },
      { name: 'IconBolt', Icon: IconBolt },
    ],
  },
  {
    label: 'Ball Sports',
    icons: [
      { name: 'IconBallVolleyball', Icon: IconBallVolleyball },
      { name: 'IconPlayBasketball', Icon: IconPlayBasketball },
      { name: 'IconBallFootball', Icon: IconBallFootball },
      { name: 'IconGolf', Icon: IconGolf },
      { name: 'IconBallTennis', Icon: IconBallTennis },
      { name: 'IconBallBaseball', Icon: IconBallBaseball },
      { name: 'IconPingPong', Icon: IconPingPong },
      { name: 'IconCricket', Icon: IconCricket },
    ],
  },
  {
    label: 'Target & Archery',
    icons: [
      { name: 'IconTarget', Icon: IconTarget },
      { name: 'IconArcheryArrow', Icon: IconArcheryArrow },
      { name: 'IconBow', Icon: IconBow },
    ],
  },
  {
    label: 'Water Sports',
    icons: [
      { name: 'IconSwimming', Icon: IconSwimming },
      { name: 'IconPool', Icon: IconPool },
      { name: 'IconWaterpolo', Icon: IconWaterpolo },
      { name: 'IconKayak', Icon: IconKayak },
      { name: 'IconSailboat', Icon: IconSailboat },
      { name: 'IconFish', Icon: IconFish },
    ],
  },
  {
    label: 'Winter Sports',
    icons: [
      { name: 'IconSnowflake', Icon: IconSnowflake },
      { name: 'IconMountain', Icon: IconMountain },
      { name: 'IconSkiJumping', Icon: IconSkiJumping },
      { name: 'IconSnowboarding', Icon: IconSnowboarding },
      { name: 'IconAerialLift', Icon: IconAerialLift },
    ],
  },
  {
    label: 'Combat',
    icons: [
      { name: 'IconKarate', Icon: IconKarate },
      { name: 'IconSword', Icon: IconSword },
      { name: 'IconShield', Icon: IconShield },
      { name: 'IconFence', Icon: IconFence },
    ],
  },
  {
    label: 'Recovery',
    icons: [
      { name: 'IconFlame', Icon: IconFlame },
      { name: 'IconHeart', Icon: IconHeart },
      { name: 'IconDroplets', Icon: IconDroplets },
      { name: 'IconMassage', Icon: IconMassage },
      { name: 'IconBone', Icon: IconBone },
    ],
  },
  {
    label: 'Other',
    icons: [
      { name: 'IconTrophy', Icon: IconTrophy },
      { name: 'IconMedal', Icon: IconMedal },
      { name: 'IconStar', Icon: IconStar },
      { name: 'IconClock', Icon: IconClock },
      { name: 'IconCirclePlus', Icon: IconCirclePlus },
    ],
  },
];

// Flat list of all icons (for backwards compat + ICON_NAME_MAP)
const ICON_PICKER_OPTIONS = ICON_PICKER_CATEGORIES.flatMap(cat => cat.icons);

// Map from icon name string → component (for rendering saved customIcon values)
const ICON_NAME_MAP = {};
ICON_PICKER_OPTIONS.forEach(opt => {
  ICON_NAME_MAP[opt.name] = opt.Icon;
});

// Backwards compat: old Lucide icon names → new Tabler components
const LEGACY_ICON_NAMES = {
  'Dumbbell': IconBarbell,
  'Weight': IconWeight,
  'PersonStanding': IconStretching2,
  'RefreshCw': IconRefresh,
  'Bike': IconBike,
  'Footprints': IconWalk,
  'HeartPulse': IconHeartbeat,
  'TrendingUp': IconTrendingUp,
  'Zap': IconBolt,
  'Volleyball': IconBallVolleyball,
  'Dribbble': IconPlayBasketball,
  'Goal': IconBallFootball,
  'Club': IconGolf,
  'Target': IconTarget,
  'BowArrow': IconArcheryArrow,
  'SwimmerIcon': IconSwimming,
  'Waves': IconPool,
  'WavesLadder': IconWaterpolo,
  'Kayak': IconKayak,
  'Sailboat': IconSailboat,
  'Fish': IconFish,
  'Snowflake': IconSnowflake,
  'MountainSnow': IconMountain,
  'SkiingIcon': IconSkiJumping,
  'SnowboardIcon': IconSnowboarding,
  'CableCar': IconAerialLift,
  'MartialArtsIcon': IconKarate,
  'Swords': IconSword,
  'Shield': IconShield,
  'Fence': IconFence,
  'Mountain': IconMountain,
  'Flame': IconFlame,
  'Heart': IconHeart,
  'Droplets': IconDroplets,
  'Trophy': IconTrophy,
  'Medal': IconMedal,
  'Star': IconStar,
  'Timer': IconClock,
  'CirclePlus': IconCirclePlus,
  'IconHeartbeat': IconHeartbeat,
};
Object.entries(LEGACY_ICON_NAMES).forEach(([name, Icon]) => {
  if (!ICON_NAME_MAP[name]) ICON_NAME_MAP[name] = Icon;
});

/**
 * Renders an icon for the given activity type, colored by category.
 *
 * @param {string} type - Activity type (e.g., 'Running', 'Weightlifting', 'Strength Training')
 * @param {string} [strengthType] - Strength subtype (for old data with type='Strength Training')
 * @param {number} [size=18] - Icon size in pixels
 * @param {string} [color] - Override color (bypasses category color)
 * @param {string} [className] - Additional CSS classes
 * @param {string} [customEmoji] - Custom emoji override (for old "Other" activities)
 * @param {string} [customIcon] - Custom icon name (for new "Other" activities, e.g., 'IconBarbell')
 * @param {string} [subtype] - Activity subtype (e.g., 'Basketball' for Sports)
 * @param {string} [sportEmoji] - Sport emoji fallback (for unmapped "Sports" subtypes)
 */
export default function ActivityIcon({ type, strengthType, subtype, size = 18, color, className = '', customEmoji, customIcon, sportEmoji }) {
  // Custom icon for "Other" activities OR uncategorized Apple Health types (e.g., Tai Chi, Dance)
  // For types without a built-in ICON_MAP entry, use customIcon if provided
  const hasBuiltInIcon = ICON_MAP[type];
  if (customIcon && ICON_NAME_MAP[customIcon] && (type === 'Other' || !hasBuiltInIcon)) {
    const CustomIconComponent = ICON_NAME_MAP[customIcon];
    // Uncategorized Apple Health types default to yellow; manual "Other" stays grey
    const defaultColor = (type === 'Other') ? CATEGORY_COLORS.other : CATEGORY_COLORS.uncategorized;
    return (
      <CustomIconComponent
        size={size}
        color={color || defaultColor}
        className={className}
        strokeWidth={2}
      />
    );
  }

  // Sports with Tabler icon mapping — render icon instead of emoji
  if (type === 'Sports' && subtype && SPORT_SUBTYPE_ICON_MAP[subtype]) {
    const SportIcon = SPORT_SUBTYPE_ICON_MAP[subtype];
    return <SportIcon size={size} color={color || CATEGORY_COLORS.cardio} className={className} strokeWidth={2} />;
  }

  // Custom emoji (old "Other" activities) or unmapped sport emoji — render as emoji span
  if ((type === 'Other' && customEmoji) || (type === 'Sports' && sportEmoji)) {
    const emoji = customEmoji || sportEmoji;
    return <span className={className} style={{ fontSize: size }}>{emoji}</span>;
  }

  // If type is 'Strength Training' with a strengthType, use the subtype icon
  if (type === 'Strength Training' && strengthType && STRENGTH_TYPE_ICONS[strengthType]) {
    const SubIcon = STRENGTH_TYPE_ICONS[strengthType];
    return (
      <SubIcon
        size={size}
        color={color || CATEGORY_COLORS.strength}
        className={className}
        strokeWidth={2}
      />
    );
  }

  const mapping = ICON_MAP[type];
  if (!mapping) {
    // Fallback for unknown/uncategorized types — heartbeat pulse icon in yellow
    return (
      <IconHeartbeat
        size={size}
        color={color || CATEGORY_COLORS.uncategorized}
        className={className}
        strokeWidth={2}
      />
    );
  }

  const { Icon, category } = mapping;
  return (
    <Icon
      size={size}
      color={color || CATEGORY_COLORS[category]}
      className={className}
      strokeWidth={2}
    />
  );
}

// Export maps for external use
export { CATEGORY_COLORS, ICON_MAP, STRENGTH_TYPE_ICONS, ICON_PICKER_OPTIONS, ICON_PICKER_CATEGORIES, ICON_NAME_MAP };

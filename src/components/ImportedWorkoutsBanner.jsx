import React, { useState } from 'react';
import { triggerHaptic, ImpactStyle } from '../utils/haptics';

// What the banner calls each kind of workout ("2 walks saved…").
const NOUNS = [
  [/walk/i, 'walk'],
  [/run/i, 'run'],
  [/cycl|bike|ride/i, 'ride'],
  [/swim/i, 'swim'],
  [/hik/i, 'hike'],
  [/strength|weight/i, 'lift'],
  [/yoga/i, 'yoga session'],
  [/pilates/i, 'Pilates session'],
];
const nounOf = (activity) => NOUNS.find(([pattern]) => pattern.test(activity.type || ''))?.[1] || 'workout';
const phrase = (noun, n) => `${n} ${n === 1 ? noun : `${noun}s`}`;

// "2 walks", "1 walk and 1 run", or "3 workouts" past two kinds.
export const importedSummary = (imported) => {
  const counts = imported.reduce((acc, a) => {
    const noun = nounOf(a);
    acc[noun] = (acc[noun] || 0) + 1;
    return acc;
  }, {});
  const kinds = Object.entries(counts);
  const summary = kinds.length === 1 ? phrase(...kinds[0])
    : kinds.length === 2 ? `${phrase(...kinds[0])} and ${phrase(...kinds[1])}`
    : phrase('workout', imported.length);
  return { summary, hasWalks: Boolean(counts.walk) };
};

const rowLabel = (a) => [
  a.type,
  a.duration ? `${a.duration} min` : null,
  a.date ? new Date(`${a.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' }) : null,
].filter(Boolean).join(' · ');

// After onboarding, the first sync saves the rest of this week's Apple Health workouts
// (the ones not linked on the first-week screen). This names them; a tap opens the one,
// or lists them to open when there's more than one.
export default function ImportedWorkoutsBanner({ imported, onOpen, onDismiss }) {
  const [expanded, setExpanded] = useState(false);
  if (!imported?.length) return null;
  const { summary, hasWalks } = importedSummary(imported);
  const single = imported.length === 1 ? imported[0] : null;

  return (
    <div className="mb-3">
      <div
        role="button"
        onClick={() => {
          triggerHaptic(ImpactStyle.Light);
          if (single) onOpen(single);
          else setExpanded((open) => !open);
        }}
        className="w-full p-3 rounded-xl flex items-center gap-3 cursor-pointer"
        style={{ backgroundColor: 'rgba(0,255,148,0.1)', border: '1px solid rgba(0,255,148,0.3)' }}
      >
        <span className="text-lg">✅</span>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold" style={{ color: '#00FF94' }}>
            {summary} saved from Apple Health
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
            {[
              hasWalks ? "Walks don't fill a ring" : null,
              single ? 'Tap to see it' : (expanded ? 'Tap to hide' : 'Tap to see them'),
            ].filter(Boolean).join(' · ')}
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDismiss?.();
          }}
          aria-label="Dismiss"
          className="p-1 rounded-full"
          style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      {!single && expanded && (
        <div className="space-y-2 mt-2">
          {imported.map((a) => (
            <div
              key={a.id}
              role="button"
              onClick={() => { triggerHaptic(ImpactStyle.Light); onOpen(a); }}
              className="w-full px-3 py-2.5 rounded-xl flex items-center gap-3 cursor-pointer"
              style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <div className="flex-1 min-w-0 text-xs text-white truncate">{rowLabel(a)}</div>
              <svg className="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

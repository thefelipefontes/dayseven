import React, { useEffect, useState, useMemo } from 'react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { applyChallengeIntent, describeMatchRule } from '../services/challengeService';

const triggerHaptic = async (style = ImpactStyle.Light) => {
  try { await Haptics.impact({ style }); } catch {
    if (navigator.vibrate) navigator.vibrate(10);
  }
};

const CATEGORY_COLOR = {
  lifting: '#00FF94',
  cardio: '#FF9500',
  recovery: '#00D1FF',
};

/**
 * Modal shown after a logged activity matched 2+ active challenges and the cloud
 * function deferred fulfillment. Lets the user pick one or more to apply.
 *
 * Props:
 *  - isOpen: boolean
 *  - onClose: () => void
 *  - activity: the activity object (must have .id and .type)
 *  - candidateChallenges: array of challenge docs the activity matched
 *  - friendsByUid: { uid: { displayName, photoURL } } for sender labels
 *  - onApplied: (results) => void   // called after successful apply (parent shows toast)
 */
export default function ChallengeMatchChooser({ isOpen, onClose, activity, candidateChallenges = [], friendsByUid = {}, onApplied }) {
  const [selected, setSelected] = useState(new Set());
  const [submitting, setSubmitting] = useState(false);

  // Default-select all candidates whenever the modal opens with new candidates,
  // so the cheap "apply to all" path is one tap and the picky path is a tap-to-deselect.
  useEffect(() => {
    if (isOpen) {
      setSelected(new Set(candidateChallenges.map(c => c.id)));
      setSubmitting(false);
    }
  }, [isOpen, candidateChallenges]);

  const toggle = (id) => {
    triggerHaptic(ImpactStyle.Light);
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleApply = async () => {
    if (submitting || selected.size === 0 || !activity?.id) return;
    setSubmitting(true);
    triggerHaptic(ImpactStyle.Medium);
    const result = await applyChallengeIntent(activity.id, Array.from(selected));
    setSubmitting(false);
    onApplied?.(result);
    onClose?.();
  };

  const activityLabel = useMemo(() => {
    if (!activity) return 'workout';
    return activity.type || 'workout';
  }, [activity]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl p-5 pb-8"
        style={{ backgroundColor: '#0c0c0e', border: '1px solid rgba(255,255,255,0.08)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4">
          <h2 className="text-white text-lg font-semibold">Pick a challenge to fulfill</h2>
          <p className="text-gray-500 text-sm mt-0.5">
            Your {activityLabel} matches {candidateChallenges.length} active challenges. Choose one or more.
          </p>
        </div>

        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {candidateChallenges.map((c) => {
            const isSelected = selected.has(c.id);
            const senderName = friendsByUid[c.challengerUid]?.displayName
              || friendsByUid[c.challengerUid]?.username
              || c.challengerName
              || 'Friend';
            const ruleLabel = describeMatchRule(c.matchRule);
            const cat = c.matchRule?.category;
            const color = CATEGORY_COLOR[cat] || '#888';
            return (
              <button
                key={c.id}
                onClick={() => toggle(c.id)}
                className="w-full flex items-center gap-3 p-3 rounded-xl text-left"
                style={{
                  backgroundColor: isSelected ? `${color}1A` : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${isSelected ? color : 'rgba(255,255,255,0.08)'}`,
                }}
              >
                <div
                  className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
                  style={{
                    backgroundColor: isSelected ? color : 'transparent',
                    border: `1.5px solid ${isSelected ? color : 'rgba(255,255,255,0.3)'}`,
                  }}
                >
                  {isSelected && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6.5L4.5 9L10 3" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{senderName}</p>
                  <p className="text-gray-500 text-xs truncate">{ruleLabel}{c.title ? ` · ${c.title}` : ''}</p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex gap-2 mt-5">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-zinc-800 text-gray-300"
            disabled={submitting}
          >
            Not now
          </button>
          <button
            onClick={handleApply}
            disabled={submitting || selected.size === 0}
            className="flex-1 py-2.5 rounded-lg text-sm font-semibold"
            style={{
              backgroundColor: '#FFD60A',
              color: 'black',
              opacity: (submitting || selected.size === 0) ? 0.5 : 1,
            }}
          >
            {submitting ? 'Applying…' : `Apply to ${selected.size}`}
          </button>
        </div>
      </div>
    </div>
  );
}

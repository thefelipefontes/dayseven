// Pre-signup onboarding flow: Welcome → Survey → Results → goals → Streak pages →
// Schedule → HK pre-screen → Workout Linking → Notification pre-screen. State persists to localStorage
// at every step so a reload mid-flow doesn't wipe answers; the final write
// to Firestore happens post-signup in finalizeOnboardingFlow.

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Capacitor } from '@capacitor/core';
import { fetchHealthKitWorkouts, fetchDailyHealthRange, requestHealthKitAuthorization, getHealthConnectionStatus, openHealthSettings } from './services/healthService';
import { requestNotificationPermission } from './services/notificationService';
import WeeklyPlanner from './WeeklyPlanner';
import ShieldLadder from './components/ShieldLadder';
import CategoryIcon from './components/CategoryIcon';
import ActivityIcon from './components/ActivityIcon';
import { WeekHead, GoalRows, GoalRowsMini } from './components/GoalCard';
import { CARD_SURFACE, GOLD, NUM, hexToRgb } from './utils/designTokens';
import { judgeWeek } from './utils/weekGoals';
import { SHIELD_MIN_PERCENT } from './utils/streakShield';

// ============================================================================
// Brand + style helpers
// ============================================================================

export const RING_COLORS = {
  strength: '#00FF94',
  cardio: '#FF9500',
  steps: '#BF5AF2',
  recovery: '#00D1FF',
};

// The third ring is weekly Steps (stepsPerDay × 7) — it counts toward winning the week;
// Recovery is a bonus with its own streak (utils/weekGoals).
const weekStepsGoalOf = (weeklyGoals) => (weeklyGoals?.stepsPerDay || 10000) * 7;
// Rows for components/GoalCard: { key, done, goal } for Strength, Cardio and weekly Steps.
const goalRowsOf = (weeklyGoals, done = {}) => ([
  { key: 'lifts', done: done.strength || 0, goal: weeklyGoals?.strength || 0 },
  { key: 'cardio', done: done.cardio || 0, goal: weeklyGoals?.cardio || 0 },
  { key: 'steps', done: done.steps || 0, goal: weekStepsGoalOf(weeklyGoals) },
]);
// The week's progress the way Home counts it: each goal's share, capped at the goal, averaged.
const weekPercentOf = (rows) => {
  const part = (r) => (r.goal > 0 ? Math.min(1, r.done / r.goal) : 1);
  return Math.round((rows.reduce((a, r) => a + part(r), 0) / rows.length) * 100);
};
const formatStepsK = (n) => `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;

const pressProps = {
  onTouchStart: (e) => { e.currentTarget.style.transform = 'scale(0.95)'; },
  onTouchEnd: (e) => { e.currentTarget.style.transform = 'scale(1)'; },
  onMouseDown: (e) => { e.currentTarget.style.transform = 'scale(0.95)'; },
  onMouseUp: (e) => { e.currentTarget.style.transform = 'scale(1)'; },
  onMouseLeave: (e) => { e.currentTarget.style.transform = 'scale(1)'; },
};

// Primary CTAs are white with black text (Nov 2026 redesign: green now means Strength).
const CTA_BG = '#FFFFFF';
const ctaPressProps = (enabled, base = CTA_BG, pressed = '#D4D4D4') => ({
  onTouchStart: (e) => { if (enabled) { e.currentTarget.style.transform = 'scale(0.97)'; e.currentTarget.style.backgroundColor = pressed; } },
  onTouchEnd:   (e) => { if (enabled) { e.currentTarget.style.transform = 'scale(1)';    e.currentTarget.style.backgroundColor = base; } },
  onMouseDown:  (e) => { if (enabled) { e.currentTarget.style.transform = 'scale(0.97)'; e.currentTarget.style.backgroundColor = pressed; } },
  onMouseUp:    (e) => { if (enabled) { e.currentTarget.style.transform = 'scale(1)';    e.currentTarget.style.backgroundColor = base; } },
  onMouseLeave: (e) => { if (enabled) { e.currentTarget.style.transform = 'scale(1)';    e.currentTarget.style.backgroundColor = base; } },
});

// ============================================================================
// Survey question definitions
// ============================================================================

const Q1_ORIGIN = [
  { value: 'lifter_adding_cardio',  emoji: '🏋️', label: 'I lift but want to add cardio' },
  { value: 'runner_adding_muscle',  emoji: '🏃', label: 'I run but want to build muscle' },
  { value: 'already_hybrid',        emoji: '🔁', label: 'I already do both — I need accountability' },
  { value: 'starting_from_scratch', emoji: '🌱', label: "I'm starting from scratch" },
];

const Q2_OBSTACLE = [
  { value: 'consistency',    emoji: '📅', label: 'Staying consistent week to week' },
  { value: 'prioritization', emoji: '🧭', label: 'Knowing what to prioritize' },
  { value: 'time',           emoji: '⏱️', label: 'Fitting training into a busy schedule' },
  { value: 'all',            emoji: '🤷', label: 'Honestly, all of the above' },
];

const Q3_DAYS = [
  { value: '1_2',        emoji: '🌙', label: '1–2 days' },
  { value: '3_4',        emoji: '☀️', label: '3–4 days' },
  { value: '5_plus',     emoji: '🔥', label: '5 or more' },
  { value: 'barely_any', emoji: '💤', label: 'Barely any' },
];

const Q4_GOAL = [
  { value: 'physique',    emoji: '💪', label: 'A physique that looks athletic' },
  { value: 'performance', emoji: '⚡', label: 'Performance — engine and strength' },
  { value: 'both',        emoji: '🎯', label: "Both. That's the whole point." },
];


// ============================================================================
// Goal computation (spec formula)
// ============================================================================

// Product spec:
//   - No plan ever exceeds 4 strength / 3 cardio / 2 recovery.
//   - Per-origin default (assumes Q3 = 3–4 days):
//       starting_from_scratch → 3 / 1 / 2  (beginner — less cardio so steps
//                                            and walks naturally fill the gap)
//       everything else       → 3 / 2 / 2  (the optimum for most people)
//   - Only `already_hybrid` + 5+ days/week gets the +1 strength bump to 4/2/2.
//   - Low-volume users (Q3 = 1–2 or barely_any) drop strength and cardio by 1
//     to floor; barely_any also drops recovery to 1 so week one is achievable.
//   - Q2 (obstacle) and Q4 (physique/performance/both) are collected for
//     analytics + future personalization but don't influence the recommendation
//     today — Q1 + Q3 are the only signals that meaningfully change the plan.
//   - The recovery goal is capped at 2 (it's a bonus); there's no recovery question.
export function computeWeeklyGoals({ origin = null, daysPerWeek } = {}) {
  // Per-origin defaults (the 3–4 days case).
  let strength, cardio, recoveryGoal;
  if (origin === 'starting_from_scratch') {
    strength = 3; cardio = 1; recoveryGoal = 2;
  } else {
    // lifter_adding_cardio, runner_adding_muscle, already_hybrid, or unknown
    strength = 3; cardio = 2; recoveryGoal = 2;
  }

  // Q3 — Days per week
  if (daysPerWeek === '5_plus' && origin === 'already_hybrid') {
    // The only segment that earns the bump: someone who self-identifies as
    // hybrid AND trains 5+ days/week already.
    strength = 4;
  }
  if (daysPerWeek === '1_2' || daysPerWeek === 'barely_any') {
    strength = Math.max(2, strength - 1);
    cardio = Math.max(1, cardio - 1);
  }
  if (daysPerWeek === 'barely_any') {
    // Truly low-activity start — let recovery start at 1 so they can build
    // momentum without immediately failing the recovery goal.
    recoveryGoal = Math.max(1, recoveryGoal - 1);
  }

  // Hard product caps — never exceed these regardless of answers.
  strength = Math.min(4, strength);
  cardio = Math.min(3, cardio);
  recoveryGoal = Math.min(2, recoveryGoal);

  return { strength, cardio, recovery: recoveryGoal };
}

// ============================================================================
// Personalized copy matrices (spec)
// ============================================================================

const ORIGIN_MESSAGE = {
  lifter_adding_cardio:  "You've built the foundation. Now you're adding the engine. This is what a complete week looks like.",
  runner_adding_muscle:  "You already have the engine. Now you build the frame to match.",
  already_hybrid:        "You already know the lifestyle. You just need something that holds you to it.",
  starting_from_scratch: "Everyone starts somewhere. The ones who last don't start harder — they start smarter. Small weeks compound into something serious.",
};

const ORIGIN_TIMEFRAME = {
  lifter_adding_cardio:  "In 8 weeks, your lifts will feel easier and your conditioning will catch up. That's what adding the engine does.",
  runner_adding_muscle:  "In 8 weeks, you'll be stronger, more built, and running faster than you were when you were only running.",
  already_hybrid:        "In 4 weeks, you'll know exactly what a complete week looks like — and you won't want to settle for anything less.",
  starting_from_scratch: "In 6 weeks, you'll have built a streak worth protecting. That's when it stops feeling like effort and starts feeling like identity.",
};

function primaryOrigin(origin) {
  // Tolerate legacy array shape from older localStorage payloads.
  const value = Array.isArray(origin) ? origin[0] : origin;
  const known = ['lifter_adding_cardio', 'runner_adding_muscle', 'already_hybrid', 'starting_from_scratch'];
  return known.includes(value) ? value : 'already_hybrid';
}


// ============================================================================
// Credit card labels (spec — labels vary by survey answers)
// ============================================================================

// Credit labels mirror how the activity is actually named in the app once
// logged — so a strength credit reads "Weightlifting" the same way a real
// strength session would appear in the feed.
function strengthCreditLabel(origin) {
  if (origin === 'starting_from_scratch') return 'Bodyweight';
  return 'Weightlifting';
}

function cardioCreditLabel(origin) {
  if (origin === 'lifter_adding_cardio') return 'Cycling';
  return 'Running';
}

// Map a credit ring → activity-shaped fields so it integrates with the
// existing weeklyProgress derivation (countToward drives ring category).
// Labels now match the actual in-app activity names ("Weightlifting",
// "Cycling", "Yoga") so credits feel like real entries.
function buildCreditActivity({ ring, label, dateStr }) {
  const base = {
    id: `credit_${ring}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    source: 'onboarding_credit',
    date: dateStr,
    time: '12:00 PM',
    duration: 0,
    subtype: 'Starting Credit',
    creditLabel: label,
  };
  if (ring === 'strength') {
    // label: "Weightlifting" | "Bodyweight"
    return { ...base, type: 'Strength Training', strengthType: label, countToward: 'lifting' };
  }
  if (ring === 'cardio') {
    // label: "Running" | "Cycling" — internal type for cycling is 'Cycle'.
    return { ...base, type: label === 'Cycling' ? 'Cycle' : 'Running', countToward: 'cardio' };
  }
  // recovery — label IS the type ("Cold Plunge" | "Yoga").
  return { ...base, type: label, countToward: 'recovery' };
}

// Horizontal chip selector for adjusting a single goal.
function GoalChips({ color, value, options, onChange, formatLabel }) {
  return (
    <div
      className="flex gap-2 overflow-x-auto pb-2 -mx-6 px-6"
      style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', msOverflowStyle: 'none', touchAction: 'pan-x' }}
    >
      {options.map((opt) => {
        const active = value === opt;
        return (
          <div
            key={opt}
            onClick={() => onChange(opt)}
            className="py-2.5 rounded-xl text-center border-2 flex-shrink-0 px-4 min-w-[60px] cursor-pointer select-none"
            style={{
              backgroundColor: active ? `${color}25` : 'rgba(255,255,255,0.05)',
              borderColor: active ? color : 'transparent',
            }}
          >
            <span className="font-bold" style={{ color: active ? color : 'white' }}>
              {formatLabel ? formatLabel(opt) : opt}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Welcome screen
// ============================================================================

function WelcomeScreen({ onGetStarted, onSignIn }) {
  return (
    <div className="min-h-screen bg-black flex flex-col">
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="text-center">
          <img src="/icon-transparent.png" alt="" className="h-20 mx-auto mb-2" />
          <img src="/wordmark.png" alt="Day Seven" className="h-12 mx-auto mb-2" />
          <p className="text-gray-400 text-xl leading-relaxed">
            Win the week,<br />not the day.
          </p>
        </div>
      </div>
      <div className="fixed bottom-0 left-0 right-0 p-6 pb-12" style={{ background: 'linear-gradient(to top, #000 80%, transparent)' }}>
        <button
          onClick={onGetStarted}
          className="w-full py-4 rounded-xl font-bold text-lg transition-all duration-150"
          style={{ backgroundColor: CTA_BG, color: 'black' }}
          {...ctaPressProps(true)}
        >
          Get Started
        </button>
        <button onClick={onSignIn} className="w-full mt-3 py-3 text-gray-400 text-sm font-medium">
          I already have an account
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Survey screen — 5 questions per spec
// ============================================================================

function SurveyScreen({ initialAnswers, onComplete, onBack, initialStep = 1 }) {
  const TOTAL_STEPS = 4;
  const [step, setStep] = useState(initialStep);
  const [direction, setDirection] = useState('forward');
  // Q1 origin is single-select — the four options are mutually exclusive
  // identities ("I lift but want cardio" vs "starting from scratch"). Despite
  // the spec marking it multi-select, all downstream usage (message matrix,
  // timeframe matrix, credit labels) picks a single value anyway.
  // Migration: if initialAnswers.origin is a legacy array, take the first.
  const initialOrigin = Array.isArray(initialAnswers?.origin)
    ? (initialAnswers.origin[0] || null)
    : (initialAnswers?.origin || null);
  const [origin, setOrigin] = useState(initialOrigin);
  const [obstacle, setObstacle] = useState(initialAnswers?.obstacle || null);
  const [daysPerWeek, setDaysPerWeek] = useState(initialAnswers?.daysPerWeek || null);
  const [goal, setGoal] = useState(initialAnswers?.goal || null);

  const canContinue = (() => {
    switch (step) {
      case 1: return origin !== null;
      case 2: return obstacle !== null;
      case 3: return daysPerWeek !== null;
      case 4: return goal !== null;
      default: return false;
    }
  })();

  const isLast = step === TOTAL_STEPS;
  const goNext = () => { setDirection('forward'); setStep(s => s + 1); };
  const goBackInternal = () => {
    if (step === 1) { onBack?.(); return; }
    setDirection('back');
    setStep(s => s - 1);
  };

  const handleSubmit = () => {
    onComplete({ origin, obstacle, daysPerWeek, goal });
  };

  const renderOptionRow = ({ key, emoji, label, selected, onTap }) => (
    <button
      key={key}
      onClick={onTap}
      className="w-full p-4 rounded-2xl text-left transition-all duration-200 border-2 flex items-center gap-4"
      style={{
        backgroundColor: selected ? 'rgba(0,255,148,0.1)' : 'rgba(255,255,255,0.04)',
        borderColor: selected ? '#00FF94' : 'rgba(255,255,255,0.08)',
        transform: 'scale(1)',
      }}
      {...pressProps}
    >
      <span className="text-2xl flex-shrink-0">{emoji}</span>
      <span className="font-semibold text-[15px]" style={{ color: selected ? '#00FF94' : 'white' }}>
        {label}
      </span>
    </button>
  );

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <div className="space-y-3">
            <h2 className="text-2xl font-bold mb-1">What brought you here?</h2>
            <p className="text-gray-500 text-sm mb-6">Pick the one that fits best — we'll tune your week around it.</p>
            {Q1_ORIGIN.map(opt => renderOptionRow({
              key: opt.value,
              emoji: opt.emoji,
              label: opt.label,
              selected: origin === opt.value,
              onTap: () => setOrigin(opt.value),
            }))}
          </div>
        );
      case 2:
        return (
          <div className="space-y-3">
            <h2 className="text-2xl font-bold mb-1">What's been your biggest obstacle?</h2>
            <p className="text-gray-500 text-sm mb-6">Helps us focus the right goal.</p>
            {Q2_OBSTACLE.map(opt => renderOptionRow({
              key: opt.value,
              emoji: opt.emoji,
              label: opt.label,
              selected: obstacle === opt.value,
              onTap: () => setObstacle(opt.value),
            }))}
          </div>
        );
      case 3:
        return (
          <div className="space-y-3">
            <h2 className="text-2xl font-bold mb-1">How many days a week are you training right now?</h2>
            <p className="text-gray-500 text-sm mb-6">No judgment — this sets a realistic baseline.</p>
            {Q3_DAYS.map(opt => renderOptionRow({
              key: opt.value,
              emoji: opt.emoji,
              label: opt.label,
              selected: daysPerWeek === opt.value,
              onTap: () => setDaysPerWeek(opt.value),
            }))}
          </div>
        );
      case 4:
        return (
          <div className="space-y-3">
            <h2 className="text-2xl font-bold mb-1">What are you building toward?</h2>
            <p className="text-gray-500 text-sm mb-6">Engine, aesthetics, or both. All valid.</p>
            {Q4_GOAL.map(opt => renderOptionRow({
              key: opt.value,
              emoji: opt.emoji,
              label: opt.label,
              selected: goal === opt.value,
              onTap: () => setGoal(opt.value),
            }))}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black text-white flex flex-col overflow-hidden" style={{ overscrollBehavior: 'none', touchAction: 'pan-y' }}>
      <div className="flex-shrink-0 px-6 pb-2" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
        <div className="flex items-center justify-between mb-5">
          <button
            onClick={goBackInternal}
            className="text-gray-400 flex items-center gap-1 transition-all duration-150 px-2 py-1 rounded-lg -ml-2"
            {...pressProps}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            <span className="text-sm">Back</span>
          </button>
          <div />
        </div>
        <div className="flex gap-1.5 mb-2">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
              className="h-1 flex-1 rounded-full transition-all duration-300"
              style={{ backgroundColor: i < step ? '#00FF94' : 'rgba(255,255,255,0.1)' }}
            />
          ))}
        </div>
      </div>

      <div
        key={step}
        className="flex-1 px-6 py-4 pb-32 overflow-y-auto"
        style={{
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          animation: `${direction === 'forward' ? 'slideInRight' : 'slideInLeft'} 0.3s ease-out`,
        }}
      >
        {renderStep()}
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-6 pb-12" style={{ background: 'linear-gradient(to top, #000 80%, transparent)' }}>
        <button
          onClick={isLast ? handleSubmit : goNext}
          disabled={!canContinue}
          className="w-full py-4 rounded-xl font-bold text-lg transition-all duration-150"
          style={{
            backgroundColor: canContinue ? CTA_BG : 'rgba(255,255,255,0.1)',
            color: canContinue ? 'black' : 'rgba(255,255,255,0.3)',
          }}
          {...ctaPressProps(canContinue)}
        >
          {isLast ? 'See My Plan' : 'Continue'}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Results screen — personalized message + the week's goals as Home's card
// ============================================================================

const STRENGTH_OPTIONS = [2, 3, 4, 5];
const CARDIO_OPTIONS = [1, 2, 3, 4];
// 0 = no recovery goal (Recovery off: no bonus streak or rows)
const RECOVERY_OPTIONS = [0, 1, 2, 3];
const STEPS_OPTIONS = [6000, 8000, 10000, 12000, 15000];

// Results hero — pure conviction moment. Personalized message + timeframe +
// animated rings + closing line. No editors competing for attention; the
// user customizes goals on the next screen.
function ResultsScreen({ answers, weeklyGoals, onContinue, onBack }) {
  const originKey = primaryOrigin(answers.origin);
  const message = ORIGIN_MESSAGE[originKey];
  const timeframe = ORIGIN_TIMEFRAME[originKey];

  return (
    <div className="fixed inset-0 z-50 bg-black text-white flex flex-col overflow-hidden">
      {/* Back to the last survey question (answers are kept) */}
      <div className="flex-shrink-0 px-6 pb-2" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
        <button
          onClick={onBack}
          className="text-gray-400 flex items-center gap-1 transition-all duration-150 px-2 py-1 rounded-lg -ml-2"
          {...pressProps}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span className="text-sm">Back</span>
        </button>
      </div>
      {/* Outer scroll container — overflow-y-auto so very tall messages still
          fit on small devices. Inner flex column with min-height 100% +
          justify-center centers content vertically when it fits, and falls
          back to natural top-anchored scroll when it doesn't. */}
      <div className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div
          className="px-6 flex flex-col justify-center items-stretch"
          style={{
            minHeight: '100%',
            paddingTop: 16,
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 140px)',
          }}
        >
          <div className="max-w-md mx-auto w-full">
            {/* Header first, so it reads as our suggestion (editable next), not a verdict */}
            <h2 className="text-[28px] font-bold leading-tight mb-4" style={{ letterSpacing: '-0.5px' }}>Here's the week<br />we suggest for you.</h2>
            <p className="text-[16px] text-gray-300 leading-snug mb-5 font-medium">
              {message}
            </p>
            <p className="text-[15px] leading-relaxed mb-7 text-gray-400">
              {timeframe}
            </p>

            {/* The Home card with nothing done yet: an empty slot per session, one bar for steps */}
            <div className="p-5" style={CARD_SURFACE}>
              <GoalRows rows={goalRowsOf(weeklyGoals)} goalOnly />
            </div>

            {/* Suggestion caption — derived from the survey answers, changeable on the next screen. */}
            <p className="text-center text-[12px] text-gray-500 flex items-center justify-center gap-1.5 mt-4">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              Based on your answers · you can change these next
            </p>
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-6 pb-12" style={{ background: 'linear-gradient(to top, #000 80%, transparent)' }}>
        <button
          onClick={onContinue}
          className="w-full py-4 rounded-xl font-bold text-lg transition-all duration-150"
          style={{ backgroundColor: CTA_BG, color: 'black' }}
          {...ctaPressProps(true)}
        >
          Review &amp; edit my goals
        </button>
      </div>
    </div>
  );
}

// Customize screen — editable weekly goal chips with a live one-line preview of the
// goal rows, so each tap visibly adds or removes a block.
function CustomizeWeekScreen({ weeklyGoals, onUpdateGoals, onBack, onContinue }) {
  const setField = (key, value) => onUpdateGoals({ ...weeklyGoals, [key]: value });
  return (
    <div className="fixed inset-0 z-50 bg-black text-white flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-6 pb-2" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
        <button
          onClick={onBack}
          className="text-gray-400 flex items-center gap-1 transition-all duration-150 px-2 py-1 rounded-lg -ml-2 mb-3"
          {...pressProps}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span className="text-sm">Back</span>
        </button>
      </div>

      <div className="flex-1 px-6 pb-32 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="max-w-md mx-auto">
          <h2 className="text-2xl font-bold mb-2">Make it yours.</h2>
          <p className="text-gray-400 text-[14px] leading-relaxed mb-6">
            Suggested from your answers — change anything that doesn't fit.
          </p>

          {/* Live preview: one-line goal rows, so picking 4 strength shows 4 blocks */}
          <div className="mb-7" style={{ ...CARD_SURFACE, padding: '17px 18px' }}>
            <GoalRowsMini rows={goalRowsOf(weeklyGoals)} goalOnly />
          </div>

          <div className="mb-5">
            <div className="flex items-center gap-2 mb-2">
              <CategoryIcon category="lifts" size={16} />
              <label className="text-[14px] font-semibold">Strength sessions / week</label>
            </div>
            <GoalChips
              color={RING_COLORS.strength}
              value={weeklyGoals.strength}
              options={STRENGTH_OPTIONS}
              onChange={(v) => setField('strength', v)}
            />
          </div>

          <div className="mb-5">
            <div className="flex items-center gap-2 mb-2">
              <CategoryIcon category="cardio" size={16} />
              <label className="text-[14px] font-semibold">Cardio sessions / week</label>
            </div>
            <GoalChips
              color={RING_COLORS.cardio}
              value={weeklyGoals.cardio}
              options={CARDIO_OPTIONS}
              onChange={(v) => setField('cardio', v)}
            />
          </div>

          <div className="mb-5">
            <div className="flex items-center gap-2 mb-2">
              <CategoryIcon category="recovery" size={16} />
              <label className="text-[14px] font-semibold">Recovery sessions / week</label>
              <span className="text-[9px] font-bold tracking-wider uppercase px-1.5 py-[1px] rounded-full" style={{ backgroundColor: 'rgba(0,209,255,0.12)', color: RING_COLORS.recovery }}>Bonus</span>
            </div>
            {/* What counts as recovery, so the number means something */}
            <div className="flex flex-wrap gap-1.5 mb-2 ml-4">
              {['🧖 Sauna', '🧊 Cold plunge', '🧘 Yoga', '🤸 Stretching', '💆 Massage'].map(t => (
                <span key={t} className="text-[11px] px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(0,209,255,0.08)', color: '#9adcee' }}>{t}</span>
              ))}
            </div>
            <p className="text-xs text-gray-500 mb-3 ml-4">Its own streak — it doesn't count toward winning the week. Your steps goal is on the next screen.</p>
            <GoalChips
              color={RING_COLORS.recovery}
              value={weeklyGoals.recovery}
              options={RECOVERY_OPTIONS}
              formatLabel={(v) => (v === 0 ? 'None' : `${v}`)}
              onChange={(v) => setField('recovery', v)}
            />
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-6 pb-12" style={{ background: 'linear-gradient(to top, #000 80%, transparent)' }}>
        <button
          onClick={onContinue}
          className="w-full py-4 rounded-xl font-bold text-lg transition-all duration-150"
          style={{ backgroundColor: CTA_BG, color: 'black' }}
          {...ctaPressProps(true)}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Steps screen — the weekly steps goal (the third ring). No calorie target: calories burned
// is tracked as a stat, not set as a goal.
// ============================================================================

function DailyTargetsScreen({ weeklyGoals, onUpdateGoals, distanceUnit, onUpdateDistanceUnit, onContinue, onBack }) {
  const setField = (key, value) => onUpdateGoals({ ...weeklyGoals, [key]: value });
  const unit = distanceUnit === 'km' ? 'km' : 'mi';
  return (
    <div className="fixed inset-0 z-50 bg-black text-white flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-6 pb-2" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
        <button
          onClick={onBack}
          className="text-gray-400 flex items-center gap-1 transition-all duration-150 px-2 py-1 rounded-lg -ml-2 mb-3"
          {...pressProps}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span className="text-sm">Back</span>
        </button>
      </div>

      <div className="flex-1 px-6 pb-32 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="max-w-md mx-auto">
          <h2 className="text-2xl font-bold mb-2">Set your steps.</h2>
          <p className="text-gray-400 text-[14px] leading-relaxed mb-3">
            Your step target for the week.
          </p>
          <div className="rounded-xl p-3 mb-7 flex items-start gap-2" style={{ backgroundColor: 'rgba(0,209,255,0.08)', border: '1px solid rgba(0,209,255,0.2)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00D1FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: 1, flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p className="text-[12px] leading-snug" style={{ color: '#E0F7FF' }}>
              Steps are your third goal and count across the whole week — a slow day just means a bigger one later.
            </p>
          </div>

          <div className="mb-7">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: RING_COLORS.steps }} />
              <label className="text-[14px] font-semibold">Steps / week</label>
            </div>
            <p className="text-xs mb-3 ml-4 font-medium" style={{ color: RING_COLORS.steps }}>{weeklyGoals.stepsPerDay * 7 / 1000}k ≈ {weeklyGoals.stepsPerDay / 1000}k a day</p>
            <GoalChips
              color={RING_COLORS.steps}
              value={weeklyGoals.stepsPerDay}
              options={STEPS_OPTIONS}
              onChange={(v) => setField('stepsPerDay', v)}
              formatLabel={(v) => `${v * 7 / 1000}k`}
            />
          </div>


          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#FFFFFF' }} />
              <label className="text-[14px] font-semibold">Distance unit</label>
            </div>
            <p className="text-xs text-gray-500 mb-3 ml-4">Used for runs, rides, and any activity with distance.</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'mi', label: 'Miles', sub: 'mi' },
                { value: 'km', label: 'Kilometers', sub: 'km' },
              ].map((opt) => {
                const active = unit === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => onUpdateDistanceUnit?.(opt.value)}
                    className="py-3 px-3 rounded-xl text-left transition-all duration-150"
                    style={{
                      backgroundColor: active ? 'rgba(0,255,148,0.14)' : 'rgba(255,255,255,0.05)',
                      border: active ? '1px solid rgba(0,255,148,0.55)' : '1px solid transparent',
                    }}
                    {...pressProps}
                  >
                    <div className="text-[14px] font-semibold" style={{ color: active ? '#00FF94' : 'white' }}>{opt.label}</div>
                    <div className="text-[11px] text-gray-500 mt-0.5">{opt.sub}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-6 pb-12" style={{ background: 'linear-gradient(to top, #000 80%, transparent)' }}>
        <button
          onClick={onContinue}
          className="w-full py-4 rounded-xl font-bold text-lg transition-all duration-150"
          style={{ backgroundColor: CTA_BG, color: 'black' }}
          {...ctaPressProps(true)}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Streak pages — right after the goals are set, two pages explain how a week
// counts: win it and the Winning Streak grows; fall short but reach 70% of it,
// with at least half of each goal, and the Streak Shield holds the streak
// (utils/streakShield). Both use the goals the person just picked.
// ============================================================================

function StreakPage({ page, title, subtitle, cta, onBack, onContinue, children }) {
  return (
    <div className="fixed inset-0 z-50 bg-black text-white flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-6 pb-2 flex items-center" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
        <button
          onClick={onBack}
          className="text-gray-400 flex items-center gap-1 transition-all duration-150 px-2 py-1 rounded-lg -ml-2 mb-3"
          {...pressProps}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span className="text-sm">Back</span>
        </button>
        <div className="ml-auto mb-3 flex items-center gap-1.5">
          {[1, 2].map((n) => (
            <span key={n} className="block h-1.5 rounded-full transition-all duration-300" style={{ width: n === page ? 18 : 6, backgroundColor: n === page ? '#fff' : '#333' }} />
          ))}
        </div>
      </div>

      <div className="flex-1 px-6 pb-32 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="max-w-md mx-auto">
          <h2 className="text-2xl font-bold mb-2">{title}</h2>
          <p className="text-gray-400 text-[14px] leading-relaxed mb-5">{subtitle}</p>
          {children}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-6 pb-12" style={{ background: 'linear-gradient(to top, #000 80%, transparent)' }}>
        <button
          onClick={onContinue}
          className="w-full py-4 rounded-xl font-bold text-lg transition-all duration-150"
          style={{ backgroundColor: CTA_BG, color: 'black' }}
          {...ctaPressProps(true)}
        >
          {cta}
        </button>
      </div>
    </div>
  );
}

function StreakWinScreen({ weeklyGoals, onBack, onContinue }) {
  const stepsGoal = weekStepsGoalOf(weeklyGoals);
  return (
    <StreakPage
      page={1}
      title="Win the week"
      subtitle="Hit all three goals in the same week to win it. Win weeks in a row and your Winning Streak grows."
      cta="Next"
      onBack={onBack}
      onContinue={onContinue}
    >
      {/* A won week, drawn as Home will show it: gold 100%, every goal filled and checked.
          The "2 days to spare" is illustrative. */}
      <div className="mb-3" style={{ ...CARD_SURFACE, padding: '18px 18px 20px' }}>
        <WeekHead pct={100} won right={2} rightLabel="days to spare" />
        <GoalRows rows={goalRowsOf(weeklyGoals, { strength: weeklyGoals.strength, cardio: weeklyGoals.cardio, steps: stepsGoal })} />
      </div>

      {/* The Winning Streak: one gold block per week won, an outline for the next */}
      <div className="mb-4" style={{ ...CARD_SURFACE, padding: '16px 18px 17px' }}>
        <div className="flex items-end justify-between">
          <div className="flex items-baseline" style={{ gap: 7 }}>
            <span style={{ fontSize: 15, lineHeight: 1 }}>🔥</span>
            {/* The week % above is this screen's one big number, so the streak is at text size */}
            <span style={{ ...NUM.value, color: GOLD }}>4</span>
            <span style={{ ...NUM.valueSmall, color: 'rgba(255,215,0,0.85)' }}>weeks</span>
          </div>
          <span className="uppercase" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', color: 'rgba(255,215,0,0.9)' }}>Winning streak</span>
        </div>
        <div className="flex" style={{ gap: 6, marginTop: 14 }}>
          {[1, 2, 3, 4].map((n) => <i key={n} className="flex-1 block" style={{ height: 12, borderRadius: 6, backgroundColor: GOLD }} />)}
          <i className="flex-1 block" style={{ height: 12, borderRadius: 6, boxShadow: 'inset 0 0 0 1.5px rgba(255,215,0,0.35)' }} />
        </div>
        <p className="text-gray-400" style={{ fontSize: 12.5, marginTop: 11 }}>Four weeks won in a row.</p>
      </div>

      {weeklyGoals.recovery > 0 && (
        <p className="text-xs text-gray-500 leading-relaxed">
          Recovery is a bonus. It has its own streak, but it doesn't count toward winning the week.
        </p>
      )}
    </StreakPage>
  );
}

// A week that holds but isn't won, in the person's own goals: Strength done, Cardio at
// half (rounded up), Steps at about three quarters. Judged by the app's own week rules
// so the example can't disagree with what the app will do.
function streakHoldExample(weeklyGoals) {
  const stepsGoal = weekStepsGoalOf(weeklyGoals);
  const counts = { lifts: weeklyGoals.strength, cardio: Math.ceil(weeklyGoals.cardio / 2), recovery: 0 };
  const weekSteps = Math.round((stepsGoal * 0.76) / 1000) * 1000;
  const judged = judgeWeek(
    counts,
    { lifts: weeklyGoals.strength, cardio: weeklyGoals.cardio, recovery: weeklyGoals.recovery, stepsPerDay: weeklyGoals.stepsPerDay },
    { weekSteps, required: ['lifts', 'cardio', 'steps'] }
  );
  return { counts, weekSteps, stepsGoal, percent: judged.percent };
}

function StreakShieldScreen({ weeklyGoals, onBack, onContinue }) {
  const ex = useMemo(() => streakHoldExample(weeklyGoals), [weeklyGoals]);
  return (
    <StreakPage
      page={2}
      title="Your Streak Shield"
      subtitle={`Some weeks don't go to plan. Get to ${SHIELD_MIN_PERCENT}% of your week and your streak holds instead of resetting.`}
      cta="Got it"
      onBack={onBack}
      onContinue={onContinue}
    >
      {/* An example week that holds: past the line, every goal at least half done */}
      <div className="mb-3" style={{ ...CARD_SURFACE, padding: '18px 18px 20px' }}>
        <WeekHead pct={ex.percent} label="This week" right={`${SHIELD_MIN_PERCENT}%`} rightLabel="holds the streak" />
        <GoalRows rows={goalRowsOf(weeklyGoals, { strength: ex.counts.lifts, cardio: ex.counts.cardio, steps: ex.weekSteps })} />
      </div>

      <ShieldLadder />
    </StreakPage>
  );
}

// ============================================================================
// Weekly schedule step — pre-fill a sensible default from the user's goals so
// even a skipper leaves with a plan, then let them drag/tap to adjust.
// ============================================================================

// Seed a starting plan from the user's goals. Interleave categories so
// consecutive sessions differ (strength → cardio → recovery → …), then place
// them on days spread evenly across the week (rest days interspersed).
// `limit` caps how many sessions get pre-placed — the rest are left in the
// tray for the user to drag, so onboarding teaches the interaction.
function distributeSessions(goals, limit) {
  const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const plan = { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] };
  const pools = [
    { c: 'strength', n: goals?.liftsPerWeek || 0 },
    { c: 'cardio', n: goals?.cardioPerWeek || 0 },
    { c: 'recovery', n: goals?.recoveryPerWeek || 0 },
  ];
  // Round-robin across categories → [S, C, R, S, C, R, S, ...]
  const all = [];
  let any = true;
  while (any) {
    any = false;
    for (const p of pools) {
      if (p.n > 0) { all.push(p.c); p.n--; any = true; }
    }
  }
  const sessions = typeof limit === 'number' ? all.slice(0, limit) : all;
  const total = sessions.length;
  if (total === 0) return plan;
  // Place the interleaved sessions on evenly-spread day slots (in calendar
  // order), so adjacent training days carry different categories.
  const used = new Set();
  sessions.forEach((cat, i) => {
    let idx = Math.round((i * 7) / total) % 7;
    if (used.size < 7) {
      while (used.has(idx)) idx = (idx + 1) % 7; // no doubling up until every day is used
      used.add(idx);
    }
    plan[dayKeys[idx]].push(cat);
  });
  return plan;
}

function ScheduleScreen({ goals, initialPlan, onChange, onBack, onContinue, onSkip }) {
  // The plan handed to WeeklyPlanner. Fixed once on mount so its internal state
  // seeds from a stable value; edits flow back up through onChange.
  const seedRef = useRef(null);
  if (!seedRef.current) {
    seedRef.current = initialPlan
      || { repeatWeekly: true, template: distributeSessions(goals, 2), weeks: {} };
  }
  // Make sure the parent has the (default) plan even if the user never drags.
  useEffect(() => { if (!initialPlan) onChange(seedRef.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 z-50 bg-black text-white flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-6 pb-2" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
        <button
          onClick={onBack}
          className="text-gray-400 flex items-center gap-1 transition-all duration-150 px-2 py-1 rounded-lg -ml-2 mb-3"
          {...pressProps}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span className="text-sm">Back</span>
        </button>
      </div>

      <div className="flex-1 pb-52 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="max-w-md mx-auto px-2">
          <div className="px-4">
            <h2 className="text-2xl font-bold mb-2">Plan your week.</h2>
            <p className="text-gray-400 text-[14px] leading-relaxed mb-4">
              Drag your sessions onto the days you'll actually train, or let us build the week for you. Tap any session to pick a workout (e.g. Cardio → Run). You can change it anytime on the Plan tab.
            </p>
          </div>
          <WeeklyPlanner
            goals={goals}
            activities={[]}
            weeklyPlan={seedRef.current}
            onSave={onChange}
            // "Build my week for me": lays out a full Sunday–Saturday week from the goals
            // (rest between lifting days) and makes it the repeating week, with Undo.
            showSuggest
            suggestWholeWeek
            initiallyExpanded
          />
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-6 pb-12" style={{ background: 'linear-gradient(to top, #000 80%, transparent)' }}>
        <button
          onClick={onContinue}
          className="w-full py-4 rounded-xl font-bold text-lg transition-all duration-150"
          style={{ backgroundColor: CTA_BG, color: 'black' }}
          {...ctaPressProps(true)}
        >
          Continue
        </button>
        <button
          onClick={onSkip}
          className="w-full py-3 mt-1 text-gray-400 text-sm font-medium transition-all duration-150"
          {...pressProps}
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// HealthKit permission pre-screen
// ============================================================================

// Per App Review guidance: once this explanation is on screen the only way
// forward is the system HealthKit sheet. No "later" button — declining is
// something the user does in Apple's prompt, not in ours.
// Also used by App.jsx for returning users whose HealthKit permission was reset by a
// reinstall or a restore to a new phone. Note the shape: one CTA and no skip. The Aug 2026
// App Review rejection was for letting users past this screen without the prompt firing,
// so the only way out is the iOS dialog itself — which still dismisses this either way,
// granted or denied, so nobody is trapped here.
export function HKPrescreen({ onConnected, title, body, cta }) {
  const [requesting, setRequesting] = useState(false);
  const handleConnect = async () => {
    if (requesting) return;
    setRequesting(true);
    try {
      // Force the native call even if a stale cache flag says we're already
      // authorized — without this, a prior install's localStorage entry can
      // short-circuit the prompt and the screen feels like it does nothing.
      const granted = Capacitor.isNativePlatform() ? await requestHealthKitAuthorization(true) : false;
      onConnected(granted);
    } catch (e) {
      onConnected(false);
    } finally {
      setRequesting(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black text-white flex flex-col overflow-hidden">
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-md w-full text-center">
          <div className="w-20 h-20 rounded-3xl mx-auto mb-6 flex items-center justify-center" style={{ backgroundColor: 'rgba(255,69,87,0.12)' }}>
            <svg width="42" height="42" viewBox="0 0 24 24" fill="none">
              <path d="M12 21C12 21 4 14 4 8.5C4 5.46243 6.46243 3 9.5 3C11.0367 3 12.4118 3.5825 13.4 4.55C14.3882 3.5825 15.7633 3 17.3 3C20.3376 3 22.8 5.46243 22.8 8.5C22.8 9.55225 22.5 10.5612 22 11.5" stroke="#FF4557" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h2 className="text-2xl font-bold mb-3">
            {title || "dayseven works best when it knows what you've already done."}
          </h2>
          <p className="text-gray-400 text-[15px] leading-relaxed">
            {body || 'Connect Apple Health to automatically log workouts toward your week — no manual entry needed.'}
          </p>
        </div>
      </div>
      <div className="fixed bottom-0 left-0 right-0 p-6 pb-12" style={{ background: 'linear-gradient(to top, #000 80%, transparent)' }}>
        <button
          onClick={handleConnect}
          disabled={requesting}
          className="w-full py-4 rounded-xl font-bold text-lg transition-all duration-150"
          style={{ backgroundColor: CTA_BG, color: 'black', opacity: requesting ? 0.6 : 1 }}
          {...ctaPressProps(!requesting)}
        >
          {requesting ? 'Connecting…' : (cta || 'Connect Apple Health')}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Workout Linking screen
// ============================================================================

function isInCurrentWeek(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  return d >= startOfWeek && d <= today;
}

function activityRing(activity) {
  if (activity.countToward === 'lifting') return 'strength';
  if (activity.countToward === 'cardio') return 'cardio';
  if (activity.countToward === 'recovery') return 'recovery';
  if (activity.type === 'Strength Training') return 'strength';
  // Not Walking: a walk counts toward no goal in the app (utils/activityCategory).
  if (['Running','Cycle','Sports','Stair Climbing','Elliptical','Rowing','Hiking','Swimming'].includes(activity.type)) return 'cardio';
  if (['Cold Plunge','Sauna','Contrast Therapy','Massage','Chiropractic','Yoga','Pilates'].includes(activity.type)) return 'recovery';
  return null;
}

function LinkingScreen({ weeklyGoals, hkAuthorized, answers, initialLinked, initialCredits, onContinue }) {
  const [hkWorkouts, setHkWorkouts] = useState([]);
  const [loadingHK, setLoadingHK] = useState(hkAuthorized && Capacitor.isNativePlatform());
  // linkedIds: Set of activity IDs currently linked
  const [linkedIds, setLinkedIds] = useState(() => new Set((initialLinked || []).map(a => a.id)));
  const [claimedCreditIds, setClaimedCreditIds] = useState(() => new Set((initialCredits || []).map(c => c.id)));
  // Whether to explain the empty list, and a counter that re-runs the fetch
  // below when access comes back on.
  const [healthBlocked, setHealthBlocked] = useState(false);
  const [hkRefresh, setHkRefresh] = useState(0);
  const wasBlockedRef = useRef(false);

  // Fetch this week's HK workouts (auto-pulls 7 days, filter to current week)
  useEffect(() => {
    let cancelled = false;
    if (!hkAuthorized || !Capacitor.isNativePlatform()) {
      setLoadingHK(false);
      return () => { cancelled = true; };
    }
    (async () => {
      try {
        const workouts = await fetchHealthKitWorkouts(7);
        if (cancelled) return;
        // No walks: they don't fill a ring, and offering one made it look like a cardio
        // session.
        const weekOnly = (workouts || []).filter(w => isInCurrentWeek(w.date) && w.type !== 'Walking');
        setHkWorkouts(weekOnly);
      } catch (e) {
        if (!cancelled) setHkWorkouts([]);
      } finally {
        if (!cancelled) setLoadingHK(false);
      }
    })();
    return () => { cancelled = true; };
  }, [hkAuthorized, hkRefresh]);

  // Re-checked on foreground so a user who leaves for Settings and grants
  // access comes back to a clean screen with their workouts loaded.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const status = await getHealthConnectionStatus();
      if (cancelled) return;
      const blocked = status === 'denied' || status === 'unasked';
      // Access just came back on — pull the workouts we couldn't see before.
      if (wasBlockedRef.current && !blocked) setHkRefresh(n => n + 1);
      wasBlockedRef.current = blocked;
      setHealthBlocked(blocked);
    };
    check();
    document.addEventListener('visibilitychange', check);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', check); };
  }, []);

  // This week's steps so far (Sunday → today) for the Steps ring. Needs Apple Health; without
  // it the ring reads 0 and the line under the rings explains where steps come from.
  const [weekSteps, setWeekSteps] = useState(0);
  useEffect(() => {
    let cancelled = false;
    if (!hkAuthorized || !Capacitor.isNativePlatform()) return () => { cancelled = true; };
    (async () => {
      const today = new Date();
      const sunday = new Date(today);
      sunday.setDate(today.getDate() - today.getDay());
      const byDay = await fetchDailyHealthRange(sunday, today);
      if (!cancelled && byDay) setWeekSteps(Object.values(byDay).reduce((sum, d) => sum + (d.steps || 0), 0));
    })();
    return () => { cancelled = true; };
  }, [hkAuthorized, hkRefresh]);
  const weekStepsGoal = weekStepsGoalOf(weeklyGoals);

  // Build the credit pool based on what's needed AFTER counting linked HK workouts.
  // We compute the *full* credit pool (max possible), then cap by what's claimed.
  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }, []);

  // Real ring counts based on linked HK workouts
  const linkedActivities = useMemo(
    () => hkWorkouts.filter(w => linkedIds.has(w.id)),
    [hkWorkouts, linkedIds]
  );
  const realCounts = useMemo(() => {
    const c = { strength: 0, cardio: 0, recovery: 0 };
    for (const a of linkedActivities) {
      const r = activityRing(a);
      if (r) c[r] += 1;
    }
    return c;
  }, [linkedActivities]);

  // Always offer exactly one credit per ring — simpler than the 50%-floor
  // formula and works the same regardless of goal size. Labels still vary by
  // survey answers (e.g. "Zone 2 Session" for a lifter adding cardio).
  const creditPool = useMemo(() => ([
    { id: 'credit_strength', ring: 'strength', label: strengthCreditLabel(answers.origin) },
    { id: 'credit_cardio',   ring: 'cardio',   label: cardioCreditLabel(answers.origin) },
    // No Recovery credit: Recovery is a bonus now, and the third ring (Steps) fills from
    // Apple Health rather than from a claimed session.
  ]), [answers.origin]);

  // No per-ring rationing anymore — show all three credits so the user can
  // pick whichever feels honest.
  const visibleCredits = creditPool;

  const ringTotals = useMemo(() => {
    const c = { ...realCounts };
    for (const id of claimedCreditIds) {
      const credit = creditPool.find(x => x.id === id);
      if (credit) c[credit.ring] += 1;
    }
    return c;
  }, [realCounts, claimedCreditIds, creditPool]);

  const ringProgress = (ring) => {
    const goal = weeklyGoals[ring];
    if (!goal) return 0;
    return Math.min(1, ringTotals[ring] / goal);
  };

  const toggleLink = (workoutId) => {
    setLinkedIds(prev => {
      const next = new Set(prev);
      if (next.has(workoutId)) next.delete(workoutId); else next.add(workoutId);
      return next;
    });
  };

  const toggleCredit = (creditId) => {
    setClaimedCreditIds(prev => {
      const next = new Set(prev);
      if (next.has(creditId)) next.delete(creditId); else next.add(creditId);
      return next;
    });
  };

  const handleContinue = () => {
    // Resolve linkedWorkouts: HK activity objects the user tapped
    const linkedWorkouts = linkedActivities.map(a => ({ ...a }));
    // Resolve onboarding credits: full activity-shaped objects with source flag
    const credits = creditPool
      .filter(c => claimedCreditIds.has(c.id))
      .map(c => buildCreditActivity({ ring: c.ring, label: c.label, dateStr: todayStr }));
    onContinue({ linkedWorkouts, onboardingCredits: credits, weekSteps });
  };

  const hasAnyHK = hkWorkouts.length > 0;
  const hasAnyCredit = visibleCredits.length > 0;

  // Aggregate progress across the three rings (Strength, Cardio, Steps) — the average of
  // each ring's fill, same as Home's Week Progress.
  const totalPct = ((ringProgress('strength') + ringProgress('cardio') + Math.min(1, weekSteps / weekStepsGoal)) / 3) * 100;
  // Days left including today, through Saturday (same as Home).
  const daysLeft = 7 - new Date().getDay();

  return (
    <div className="fixed inset-0 z-50 bg-black text-white flex flex-col overflow-hidden">
      {/* Sticky header: the week so far */}
      <div className="flex-shrink-0 px-6 pb-4" style={{ backgroundColor: '#000', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
        <h2 className="text-2xl font-bold mb-1">Let's build your first week.</h2>
        <p className="text-gray-500 text-sm mb-4">Tap any sessions below to count them toward this week.</p>
        {/* A small Home card: tapping a workout below fills a block right here. The big
            number replaces the old green Week progress bar, as on Home. */}
        <div style={{ ...CARD_SURFACE, padding: '16px 18px' }}>
          <WeekHead pct={totalPct} right={daysLeft} rightLabel={daysLeft === 1 ? 'day left' : 'days left'} compact mb={14} pb={14} />
          <GoalRowsMini rows={goalRowsOf(weeklyGoals, { strength: ringTotals.strength, cardio: ringTotals.cardio, steps: weekSteps })} />
          <p className="text-gray-500 flex items-center gap-1.5" style={{ fontSize: 11.5, marginTop: 13 }}>
            <CategoryIcon category="steps" size={12} color="#6b7280" />
            {hkAuthorized ? 'Steps fill in from Apple Health.' : 'Steps fill in once Apple Health is connected.'}
          </p>
        </div>
      </div>

      {/* Scrollable card list */}
      <div className="flex-1 px-6 py-5 pb-32 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        {loadingHK && (
          <div className="text-center text-gray-500 text-sm py-6">Reading from Apple Health…</div>
        )}

        {/* Nothing came back and Health access is off — say so here, where the
            workouts should have been, rather than interrupting with a dialog. */}
        {!loadingHK && !hasAnyHK && healthBlocked && (
          <div className="mb-6 rounded-2xl p-4" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
            <p className="text-sm text-white mb-1">Apple Health isn't connected.</p>
            <p className="text-[13px] text-gray-400 leading-relaxed mb-3">
              We can't see your workouts, so nothing will auto-log. You can turn it on any time — in Health, tap your profile photo → Apps (under Privacy) → DaySeven → Turn On All. This screen still works without it.
            </p>
            <button
              onClick={() => openHealthSettings()}
              className="text-[13px] font-semibold flex items-center gap-1"
              style={{ color: '#fff' }}
            >
              Open Health
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        )}

        {hasAnyHK && (
          <div className="mb-6">
            <h3 className="uppercase mb-3" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', color: '#8a8a8a' }}>This week from Apple Health</h3>
            <div className="space-y-2">
              {hkWorkouts.map(w => {
                const ring = activityRing(w);
                const color = ring ? RING_COLORS[ring] : '#777';
                const rgb = hexToRgb(color);
                const linked = linkedIds.has(w.id);
                return (
                  <button
                    key={w.id}
                    onClick={() => toggleLink(w.id)}
                    className="w-full p-4 rounded-2xl text-left transition-all duration-200 border-2 flex items-center gap-3"
                    style={{
                      backgroundColor: linked ? `rgba(${rgb},0.07)` : 'rgba(255,255,255,0.04)',
                      borderColor: linked ? `rgba(${rgb},0.55)` : 'rgba(255,255,255,0.06)',
                      transform: 'scale(1)',
                    }}
                    {...pressProps}
                  >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `rgba(${rgb},0.14)` }}>
                      <ActivityIcon type={w.type} subtype={w.subtype} strengthType={w.strengthType} countToward={w.countToward} size={20} color={color} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-[15px] text-white truncate">
                        {w.type}{w.subtype && w.subtype !== w.type ? ` · ${w.subtype}` : ''}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {w.duration ? `${w.duration} min` : ''}{w.duration && w.date ? ' · ' : ''}{w.date ? new Date(w.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''}
                      </div>
                    </div>
                    <span
                      className="w-6 h-6 rounded-full border-2 flex-shrink-0 flex items-center justify-center"
                      style={{ borderColor: linked ? color : 'rgba(255,255,255,0.25)', backgroundColor: linked ? color : 'transparent' }}
                    >
                      {linked && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {hasAnyCredit && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-1">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ddd" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2z" />
              </svg>
              <h3 className="uppercase" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', color: '#ddd' }}>You've earned this</h3>
            </div>
            <p className="text-xs text-gray-500 mb-3">A starting credit for making it through. Tap each one to claim — they count toward your first week's streak.</p>
            <div className="space-y-2">
              {visibleCredits.map(c => {
                const color = RING_COLORS[c.ring];
                const rgb = hexToRgb(color);
                const claimed = claimedCreditIds.has(c.id);
                const sample = buildCreditActivity({ ring: c.ring, label: c.label, dateStr: todayStr });
                return (
                  <button
                    key={c.id}
                    onClick={() => toggleCredit(c.id)}
                    className="w-full p-4 rounded-2xl text-left transition-all duration-200 flex items-center gap-3"
                    style={{
                      backgroundColor: claimed ? `rgba(${rgb},0.07)` : 'rgba(255,255,255,0.025)',
                      border: claimed ? `2px solid rgba(${rgb},0.55)` : '1px dashed rgba(255,255,255,0.18)',
                      transform: 'scale(1)',
                    }}
                    {...pressProps}
                  >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `rgba(${rgb},0.14)` }}>
                      <ActivityIcon type={sample.type} strengthType={sample.strengthType} countToward={sample.countToward} size={20} color={color} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-[15px] text-white">
                        {c.label}
                      </div>
                      <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500 mt-0.5">
                        Starting Credit
                      </div>
                    </div>
                    <span
                      className="w-6 h-6 rounded-full border-2 flex-shrink-0 flex items-center justify-center"
                      style={{ borderColor: claimed ? color : 'rgba(255,255,255,0.25)', backgroundColor: claimed ? color : 'transparent' }}
                    >
                      {claimed && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {!loadingHK && !hasAnyHK && !hasAnyCredit && (
          <div className="text-center text-gray-500 text-sm py-12">
            You're already at your weekly target. Tap continue.
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-6 pb-12" style={{ background: 'linear-gradient(to top, #000 80%, transparent)' }}>
        <button
          onClick={handleContinue}
          className="w-full py-4 rounded-xl font-bold text-lg transition-all duration-150"
          style={{ backgroundColor: CTA_BG, color: 'black' }}
          {...ctaPressProps(true)}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Celebrate screen — the "already on your way" moment between the linking
// screen and the notification ask. Recaps the week so far + what's left to
// complete the first hybrid week. Always shows with positive framing, even
// when the user claimed zero credits / linked nothing.
// ============================================================================

function CelebrateScreen({ weeklyGoals, linkedWorkouts, onboardingCredits, weekSteps = 0, onContinue }) {
  const totals = useMemo(() => {
    const c = { strength: 0, cardio: 0, recovery: 0 };
    for (const a of [...(linkedWorkouts || []), ...(onboardingCredits || [])]) {
      const r = activityRing(a);
      if (r) c[r] += 1;
    }
    return c;
  }, [linkedWorkouts, onboardingCredits]);

  const weekStepsGoal = weekStepsGoalOf(weeklyGoals);
  const remaining = {
    strength: Math.max(0, (weeklyGoals.strength || 0) - totals.strength),
    cardio:   Math.max(0, (weeklyGoals.cardio   || 0) - totals.cardio),
    steps:    Math.max(0, weekStepsGoal - weekSteps),
  };
  const allDone = remaining.strength === 0 && remaining.cardio === 0 && remaining.steps === 0;

  // Their first look at the real Home card, with what they've already done filled in.
  const rows = goalRowsOf(weeklyGoals, { strength: totals.strength, cardio: totals.cardio, steps: weekSteps });
  const daysLeft = 7 - new Date().getDay();

  const headline = allDone ? 'First week — locked in.' : 'Already on your way.';
  const subhead = allDone
    ? "Every session from here compounds. Now make it real."
    : "Here's what's left to complete your first full week.";

  return (
    <div className="fixed inset-0 z-50 bg-black text-white flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div
          className="px-6 flex flex-col justify-center items-stretch"
          style={{
            minHeight: '100%',
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 32px)',
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 140px)',
          }}
        >
          <div className="max-w-md mx-auto w-full">
            <h2 className="text-[26px] font-bold mb-3 leading-tight">{headline}</h2>
            <p className="text-[15px] leading-relaxed mb-7 text-gray-400">{subhead}</p>

            {/* What's left sits under each goal; a finished goal shows its check instead */}
            <div className="p-5" style={CARD_SURFACE}>
              <WeekHead
                pct={allDone ? 100 : weekPercentOf(rows)}
                won={allDone}
                right={daysLeft}
                rightLabel={allDone ? (daysLeft === 1 ? 'day to spare' : 'days to spare') : (daysLeft === 1 ? 'day left' : 'days left')}
              />
              <GoalRows
                rows={rows}
                caption={(r) => (r.done >= r.goal ? null : r.key === 'steps'
                  ? <><b className="text-white font-bold">{formatStepsK(r.goal - r.done)}</b> steps to go</>
                  : <><b className="text-white font-bold">{r.goal - r.done}</b> more</>)}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-6 pb-12" style={{ background: 'linear-gradient(to top, #000 80%, transparent)' }}>
        <button
          onClick={onContinue}
          className="w-full py-4 rounded-xl font-bold text-lg transition-all duration-150"
          style={{ backgroundColor: CTA_BG, color: 'black' }}
          {...ctaPressProps(true)}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Notification permission pre-screen
// ============================================================================

function NotifPrescreen({ onEnabled, onSkip, submitting = false }) {
  const [requesting, setRequesting] = useState(false);
  const handleEnable = async () => {
    if (requesting || submitting) return;
    setRequesting(true);
    try {
      const result = Capacitor.isNativePlatform() ? await requestNotificationPermission() : { granted: false };
      onEnabled(!!result?.granted);
    } catch (e) {
      onEnabled(false);
    } finally {
      setRequesting(false);
    }
  };
  // `submitting` covers the gap after the user responds (granted or skipped)
  // while we wait for the paywall to present. Disables both buttons so a
  // second tap can't fire the paywall twice.
  const busy = requesting || submitting;
  return (
    <div className="fixed inset-0 z-50 bg-black text-white flex flex-col overflow-hidden">
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-md w-full text-center">
          <h2 className="text-2xl font-bold mb-3">Don't let your week slip.</h2>
          <p className="text-gray-400 text-[15px] leading-relaxed mb-8">
            Enable notifications and dayseven will remind you when a goal is still open — before the week closes.
          </p>

          {/* Mock notification preview */}
          <div className="rounded-2xl p-4 mx-auto max-w-sm text-left" style={{ backgroundColor: 'rgba(255,255,255,0.06)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex items-center gap-2 mb-1.5">
              <img src="/icon-transparent.png" alt="" className="w-5 h-5 rounded" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">dayseven</span>
              <span className="text-[11px] text-gray-500 ml-auto">now</span>
            </div>
            <p className="text-[14px] text-white">
              Your strength goal is still open. 2 days left.
            </p>
          </div>
        </div>
      </div>
      <div className="fixed bottom-0 left-0 right-0 p-6 pb-12" style={{ background: 'linear-gradient(to top, #000 80%, transparent)' }}>
        <button
          onClick={handleEnable}
          disabled={busy}
          className="w-full py-4 rounded-xl font-bold text-lg transition-all duration-150"
          style={{ backgroundColor: CTA_BG, color: 'black', opacity: busy ? 0.6 : 1 }}
          {...ctaPressProps(!busy)}
        >
          {requesting ? 'Requesting…' : submitting ? 'Loading…' : 'Turn on Notifications'}
        </button>
        <button
          onClick={() => { if (!busy) onSkip(); }}
          disabled={busy}
          className="w-full mt-3 py-3 text-gray-400 text-sm font-medium"
          style={{ opacity: busy ? 0.4 : 1 }}
        >
          No thanks
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Main flow component
// ============================================================================
//
// Steps: 'welcome' → 'survey' → 'results' → 'customize' → 'daily-targets' →
//        'schedule' → 'hk' → 'linking' → 'celebrate' → 'notif' → done
// On done(), parent (App.jsx) marks pre-signup complete and renders Login.
// localStorage shape stored in 'preSignupOnboarding' (when done):
//   {
//     goals: { liftsPerWeek, cardioPerWeek, recoveryPerWeek, stepsPerDay, caloriesPerDay },
//     extra: { origin, obstacle, daysPerWeek, goal, recovery },
//     linkedWorkouts: [...activities with source:'healthkit'...],
//     onboardingCredits: [...activities with source:'onboarding_credit'...],
//     done: true,
//     savedAt: ISO timestamp
//   }

const DEFAULT_STEPS = 10000;
const DEFAULT_CALORIES = 500;

// Build the full editable goals object — survey-derived ring counts plus
// sensible defaults for steps/calories that the user can adjust on the
// results screen.
function buildInitialGoals(answers) {
  const ringGoals = computeWeeklyGoals(answers);
  return {
    strength: ringGoals.strength,
    cardio: ringGoals.cardio,
    recovery: ringGoals.recovery,
    stepsPerDay: DEFAULT_STEPS,
    caloriesPerDay: DEFAULT_CALORIES,
  };
}

export default function OnboardingFlow({ onComplete, onSignIn }) {
  const [step, setStep] = useState('welcome');
  // Direction drives the slide-in animation when step changes — 'forward'
  // (slide in from right) for normal advance, 'back' (slide in from left)
  // when the user taps a Back button.
  const [direction, setDirection] = useState('forward');
  const goForward = (next) => { setDirection('forward'); setStep(next); };
  const goBack    = (next) => { setDirection('back');    setStep(next); };

  const [answers, setAnswers] = useState(null); // survey answers
  // Back from the suggested-week screen lands on the last question, not the first.
  const [surveyReturnToEnd, setSurveyReturnToEnd] = useState(false);
  // weeklyGoals: editable on the results screen. Holds ring goals (strength/
  // cardio/recovery) + daily targets (stepsPerDay/caloriesPerDay). null until
  // the survey completes.
  const [weeklyGoals, setWeeklyGoals] = useState(null);
  const [distanceUnit, setDistanceUnit] = useState('mi');
  const [hkAuthorized, setHkAuthorized] = useState(false);
  const [linkedWorkouts, setLinkedWorkouts] = useState([]);
  const [onboardingWeekSteps, setOnboardingWeekSteps] = useState(0);
  const [onboardingCredits, setOnboardingCredits] = useState([]);
  const [weeklyPlan, setWeeklyPlan] = useState(null); // set on the schedule step

  // Restore in-progress survey answers if user reloaded mid-flow (rare path).
  // We don't auto-skip steps — restarting from welcome is fine — but answers
  // are preserved so the user doesn't have to re-tap everything.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('preSignupOnboarding');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.extra && !parsed?.done) {
        setAnswers(parsed.extra);
        // If we previously persisted edited goals, restore those too;
        // otherwise the results screen will recompute defaults on mount.
        if (parsed?.goals) {
          setWeeklyGoals({
            strength: parsed.goals.liftsPerWeek,
            cardio: parsed.goals.cardioPerWeek,
            recovery: parsed.goals.recoveryPerWeek,
            stepsPerDay: parsed.goals.stepsPerDay ?? DEFAULT_STEPS,
            caloriesPerDay: parsed.goals.caloriesPerDay ?? DEFAULT_CALORIES,
          });
        }
        if (parsed?.distanceUnit === 'km' || parsed?.distanceUnit === 'mi') {
          setDistanceUnit(parsed.distanceUnit);
        }
        if (parsed?.weeklyPlan) setWeeklyPlan(parsed.weeklyPlan);
      }
    } catch {}
  }, []);

  const goalsForSave = useMemo(() => {
    if (!weeklyGoals) return null;
    return {
      liftsPerWeek: weeklyGoals.strength,
      cardioPerWeek: weeklyGoals.cardio,
      recoveryPerWeek: weeklyGoals.recovery,
      stepsPerDay: weeklyGoals.stepsPerDay,
      caloriesPerDay: weeklyGoals.caloriesPerDay,
    };
  }, [weeklyGoals]);

  const persistInProgress = (patch) => {
    try {
      const raw = localStorage.getItem('preSignupOnboarding');
      const prev = raw ? JSON.parse(raw) : {};
      const next = { ...prev, ...patch };
      localStorage.setItem('preSignupOnboarding', JSON.stringify(next));
    } catch {}
  };

  const finish = (overrides = {}) => {
    const payload = {
      goals: goalsForSave,
      extra: answers,
      distanceUnit,
      linkedWorkouts: overrides.linkedWorkouts ?? linkedWorkouts,
      onboardingCredits: overrides.onboardingCredits ?? onboardingCredits,
      weeklyPlan: overrides.weeklyPlan ?? weeklyPlan,
      done: true,
      savedAt: new Date().toISOString(),
    };
    try { localStorage.setItem('preSignupOnboarding', JSON.stringify(payload)); } catch {}
    onComplete(payload);
  };

  const persistGoals = (next) => {
    setWeeklyGoals(next);
    persistInProgress({
      goals: {
        liftsPerWeek: next.strength,
        cardioPerWeek: next.cardio,
        recoveryPerWeek: next.recovery,
        stepsPerDay: next.stepsPerDay,
        caloriesPerDay: next.caloriesPerDay,
      },
    });
  };

  const renderCurrent = () => {
    if (step === 'welcome') {
      return (
        <WelcomeScreen
          onGetStarted={() => goForward('survey')}
          onSignIn={onSignIn}
        />
      );
    }

    if (step === 'survey') {
      return (
        <SurveyScreen
          initialAnswers={answers}
          initialStep={surveyReturnToEnd ? 4 : 1}
          onBack={() => { setSurveyReturnToEnd(false); goBack('welcome'); }}
          onComplete={(a) => {
            setAnswers(a);
            // Initialize goals from the new answers, but preserve any prior
            // step/calorie edits if the user backed through the flow.
            setWeeklyGoals(prev => {
              const fresh = buildInitialGoals(a);
              return prev
                ? { ...fresh, stepsPerDay: prev.stepsPerDay, caloriesPerDay: prev.caloriesPerDay }
                : fresh;
            });
            persistInProgress({ extra: a });
            goForward('results');
          }}
        />
      );
    }

    if (step === 'results' && weeklyGoals) {
      return (
        <ResultsScreen
          answers={answers}
          weeklyGoals={weeklyGoals}
          onContinue={() => goForward('customize')}
          onBack={() => { setSurveyReturnToEnd(true); goBack('survey'); }}
        />
      );
    }

    if (step === 'customize' && weeklyGoals) {
      return (
        <CustomizeWeekScreen
          weeklyGoals={weeklyGoals}
          onUpdateGoals={persistGoals}
          onBack={() => goBack('results')}
          onContinue={() => goForward('daily-targets')}
        />
      );
    }

    if (step === 'daily-targets' && weeklyGoals) {
      return (
        <DailyTargetsScreen
          weeklyGoals={weeklyGoals}
          onUpdateGoals={persistGoals}
          distanceUnit={distanceUnit}
          onUpdateDistanceUnit={(unit) => {
            const next = unit === 'km' ? 'km' : 'mi';
            setDistanceUnit(next);
            persistInProgress({ distanceUnit: next });
          }}
          onBack={() => goBack('customize')}
          onContinue={() => {
            persistInProgress({ goals: goalsForSave, distanceUnit });
            goForward('streak-win');
          }}
        />
      );
    }

    if (step === 'streak-win' && weeklyGoals) {
      return (
        <StreakWinScreen
          weeklyGoals={weeklyGoals}
          onBack={() => goBack('daily-targets')}
          onContinue={() => goForward('streak-shield')}
        />
      );
    }

    if (step === 'streak-shield' && weeklyGoals) {
      return (
        <StreakShieldScreen
          weeklyGoals={weeklyGoals}
          onBack={() => goBack('streak-win')}
          onContinue={() => goForward('schedule')}
        />
      );
    }

    if (step === 'schedule' && weeklyGoals) {
      return (
        <ScheduleScreen
          goals={goalsForSave}
          initialPlan={weeklyPlan}
          onChange={(wp) => { setWeeklyPlan(wp); persistInProgress({ weeklyPlan: wp }); }}
          onBack={() => goBack('streak-shield')}
          onContinue={() => goForward('hk')}
          onSkip={() => goForward('hk')}
        />
      );
    }

    if (step === 'hk') {
      return (
        <HKPrescreen
          onConnected={(granted) => {
            setHkAuthorized(granted);
            goForward('linking');
          }}
        />
      );
    }

    if (step === 'linking' && weeklyGoals) {
      return (
        <LinkingScreen
          weeklyGoals={weeklyGoals}
          hkAuthorized={hkAuthorized}
          answers={answers}
          initialLinked={linkedWorkouts}
          initialCredits={onboardingCredits}
          onContinue={({ linkedWorkouts: lw, onboardingCredits: cr, weekSteps: ws }) => {
            setLinkedWorkouts(lw);
            setOnboardingCredits(cr);
            setOnboardingWeekSteps(ws || 0);
            persistInProgress({ linkedWorkouts: lw, onboardingCredits: cr });
            goForward('celebrate');
          }}
        />
      );
    }

    if (step === 'celebrate' && weeklyGoals) {
      return (
        <CelebrateScreen
          weeklyGoals={weeklyGoals}
          linkedWorkouts={linkedWorkouts}
          onboardingCredits={onboardingCredits}
          weekSteps={onboardingWeekSteps}
          onContinue={() => goForward('notif')}
        />
      );
    }

    if (step === 'notif') {
      // Account-first reorder (subscription-only): the notification prompt is
      // the LAST pre-signup step. After the user responds (grant / deny / skip)
      // we finish → Login. The Welcome Offer paywall now fires AFTER signup
      // (WelcomePaywallStep in App.jsx), so a user who creates an account but
      // declines the trial is still a reachable account we can re-engage.
      // Order: emotional peak (Celebrate) → soft ask (Notif) → commitment
      // (Signup) → conversion (Paywall).
      return (
        <NotifPrescreen
          onEnabled={() => finish()}
          onSkip={() => finish()}
        />
      );
    }

    return null;
  };

  // Wrap each screen with a key-changing animated container so transitions
  // between major steps slide in the same way the survey's internal question
  // transitions do. A parent transform creates a containing block for the
  // child's `position: fixed`, so the inner fixed-positioned screens follow
  // the slide animation.
  return (
    <div
      key={step}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        animation: `${direction === 'back' ? 'slideInLeft' : 'slideInRight'} 0.3s ease-out`,
      }}
    >
      {renderCurrent()}
    </div>
  );
}





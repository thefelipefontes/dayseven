// Pre-signup onboarding flow: Welcome → Survey → Results → HK pre-screen →
// Workout Linking → Notification pre-screen. State persists to localStorage
// at every step so a reload mid-flow doesn't wipe answers; the final write
// to Firestore happens post-signup in finalizeOnboardingFlow.

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Capacitor } from '@capacitor/core';
import { fetchHealthKitWorkouts, requestHealthKitAuthorization } from './services/healthService';
import { requestNotificationPermission } from './services/notificationService';

// ============================================================================
// Brand + style helpers
// ============================================================================

export const RING_COLORS = {
  strength: '#00FF94',
  cardio: '#FF9500',
  recovery: '#00D1FF',
};

const pressProps = {
  onTouchStart: (e) => { e.currentTarget.style.transform = 'scale(0.95)'; },
  onTouchEnd: (e) => { e.currentTarget.style.transform = 'scale(1)'; },
  onMouseDown: (e) => { e.currentTarget.style.transform = 'scale(0.95)'; },
  onMouseUp: (e) => { e.currentTarget.style.transform = 'scale(1)'; },
  onMouseLeave: (e) => { e.currentTarget.style.transform = 'scale(1)'; },
};

const ctaPressProps = (enabled, base = '#00FF94', pressed = '#00CC77') => ({
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

const Q5_RECOVERY = [
  { value: 'sleep_rest',          emoji: '😴', label: 'I prioritize sleep and rest days' },
  { value: 'mobility_stretching', emoji: '🧘', label: 'I do mobility or stretching work' },
  { value: 'cold_plunge_sauna',   emoji: '🧊', label: 'Cold plunge / sauna / contrast therapy' },
  { value: 'no_routine',          emoji: '🤔', label: "I don't really have a recovery routine" },
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
//   - Q5 (recovery routine) drives credit-card labels and copy elsewhere; the
//     recovery goal itself is capped at 2 regardless of answers.
export function computeWeeklyGoals({ origin = null, daysPerWeek, recovery = [] } = {}) {
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
  lifter_adding_cardio:  "You've built the foundation. Now you're adding the engine. This is what hybrid actually looks like.",
  runner_adding_muscle:  "You already have the engine. Now you build the frame to match.",
  already_hybrid:        "You already know the lifestyle. You just need something that holds you to it.",
  starting_from_scratch: "Everyone starts somewhere. The ones who last don't start harder — they start smarter. Small weeks compound into something serious.",
};

const ORIGIN_TIMEFRAME = {
  lifter_adding_cardio:  "In 8 weeks, your lifts will feel easier and your body will look more athletic. That's what adding the engine does.",
  runner_adding_muscle:  "In 8 weeks, you'll be stronger, more built, and running faster than you were when you were only running.",
  already_hybrid:        "In 4 weeks, you'll know exactly what a complete week looks like — and you won't want to close anything less.",
  starting_from_scratch: "In 6 weeks, you'll have built a streak worth protecting. That's when it stops feeling like effort and starts feeling like identity.",
};

function primaryOrigin(origin) {
  // Tolerate legacy array shape from older localStorage payloads.
  const value = Array.isArray(origin) ? origin[0] : origin;
  const known = ['lifter_adding_cardio', 'runner_adding_muscle', 'already_hybrid', 'starting_from_scratch'];
  return known.includes(value) ? value : 'already_hybrid';
}

function closingLine(recovery = []) {
  if (recovery.includes('no_routine') && !recovery.some(r => r !== 'no_routine')) {
    return "Recovery is your third ring — and right now it's your biggest unlock.";
  }
  return 'Set your standard. Earn your streaks.';
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

function recoveryCreditLabel(recovery = []) {
  if (recovery.includes('cold_plunge_sauna')) return 'Cold Plunge';
  return 'Yoga';
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

// ============================================================================
// Ring component (SVG, animated)
// ============================================================================

function Ring({ color, progress, size = 96, stroke = 10, label, count, goal, goalOnly = false }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = Math.min(1, Math.max(0, progress)) * circumference;
  return (
    <div className="flex flex-col items-center">
      <div style={{ width: size, height: size, position: 'relative' }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            style={{ transition: 'stroke-dasharray 600ms cubic-bezier(0.34, 1.56, 0.64, 1)' }}
          />
        </svg>
        {(count !== undefined || goal !== undefined) && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {goalOnly ? (
              <span className="font-bold" style={{ color, fontSize: size * 0.35, lineHeight: 1 }}>{goal}</span>
            ) : (
              <span className="text-white font-bold text-base">{count}<span className="text-gray-500 text-xs font-medium">/{goal}</span></span>
            )}
          </div>
        )}
      </div>
      {label && <span className="mt-2 text-xs font-semibold uppercase tracking-wider" style={{ color }}>{label}</span>}
    </div>
  );
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
            Set Your Standards.<br />Earn Your Streaks.
          </p>
        </div>
      </div>
      <div className="fixed bottom-0 left-0 right-0 p-6 pb-12" style={{ background: 'linear-gradient(to top, #000 80%, transparent)' }}>
        <button
          onClick={onGetStarted}
          className="w-full py-4 rounded-xl font-bold text-lg transition-all duration-150"
          style={{ backgroundColor: '#00FF94', color: 'black' }}
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

function SurveyScreen({ initialAnswers, onComplete, onBack }) {
  const TOTAL_STEPS = 5;
  const [step, setStep] = useState(1);
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
  const [recovery, setRecovery] = useState(initialAnswers?.recovery || []);

  const canContinue = (() => {
    switch (step) {
      case 1: return origin !== null;
      case 2: return obstacle !== null;
      case 3: return daysPerWeek !== null;
      case 4: return goal !== null;
      case 5: return recovery.length > 0;
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
    onComplete({ origin, obstacle, daysPerWeek, goal, recovery });
  };

  const toggleMulti = (set, setter, value) => {
    setter(set.includes(value) ? set.filter(v => v !== value) : [...set, value]);
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
            <p className="text-gray-500 text-sm mb-6">Helps us focus the right ring.</p>
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
      case 5:
        return (
          <div className="space-y-3">
            <h2 className="text-2xl font-bold mb-1">What do you currently do for training recovery?</h2>
            <p className="text-gray-500 text-sm mb-6">Select all that fit.</p>
            {Q5_RECOVERY.map(opt => renderOptionRow({
              key: opt.value,
              emoji: opt.emoji,
              label: opt.label,
              selected: recovery.includes(opt.value),
              onTap: () => toggleMulti(recovery, setRecovery, opt.value),
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
            backgroundColor: canContinue ? '#00FF94' : 'rgba(255,255,255,0.1)',
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
// Results screen — personalized message + animated rings
// ============================================================================

const STRENGTH_OPTIONS = [2, 3, 4, 5];
const CARDIO_OPTIONS = [1, 2, 3, 4];
const RECOVERY_OPTIONS = [1, 2];
const STEPS_OPTIONS = [6000, 8000, 10000, 12000, 15000];
const CALORIES_OPTIONS = [300, 400, 500, 600, 750, 1000, 1250, 1500, 1750, 2000];

// Results hero — pure conviction moment. Personalized message + timeframe +
// animated rings + closing line. No editors competing for attention; the
// user customizes goals on the next screen.
function ResultsScreen({ answers, weeklyGoals, onContinue }) {
  // 0 → 8% pulse to show rings are alive (spec: animateRingTo 0.08, 1200ms easeOut)
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setProgress(0.08), 200);
    return () => clearTimeout(t);
  }, []);

  const originKey = primaryOrigin(answers.origin);
  const message = ORIGIN_MESSAGE[originKey];
  const timeframe = ORIGIN_TIMEFRAME[originKey];
  const closing = closingLine(answers.recovery);

  return (
    <div className="fixed inset-0 z-50 bg-black text-white flex flex-col overflow-hidden">
      {/* Outer scroll container — overflow-y-auto so very tall messages still
          fit on small devices. Inner flex column with min-height 100% +
          justify-center centers content vertically when it fits, and falls
          back to natural top-anchored scroll when it doesn't. */}
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
            <p className="text-[18px] leading-snug mb-5 text-white font-medium">
              {message}
            </p>
            <p className="text-[15px] leading-relaxed mb-12 text-gray-400">
              {timeframe}
            </p>

            <div className="flex items-start justify-around mb-4">
              <Ring color={RING_COLORS.strength} progress={progress} size={104} stroke={10} label="Strength" goal={weeklyGoals.strength} goalOnly />
              <Ring color={RING_COLORS.cardio}   progress={progress} size={104} stroke={10} label="Cardio"   goal={weeklyGoals.cardio}   goalOnly />
              <Ring color={RING_COLORS.recovery} progress={progress} size={104} stroke={10} label="Recovery" goal={weeklyGoals.recovery} goalOnly />
            </div>

            {/* Suggestion caption — signals these are derived from the survey
                answers (and implicitly: changeable on the next screen). */}
            <p className="text-center text-[12px] text-gray-500 flex items-center justify-center gap-1.5">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              Suggested from your answers
            </p>
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-6 pb-12" style={{ background: 'linear-gradient(to top, #000 80%, transparent)' }}>
        <button
          onClick={onContinue}
          className="w-full py-4 rounded-xl font-bold text-lg transition-all duration-150"
          style={{ backgroundColor: '#00FF94', color: 'black' }}
          {...ctaPressProps(true)}
        >
          Review my goals
        </button>
      </div>
    </div>
  );
}

// Customize screen — editable weekly goal chips with a smaller live-updating
// ring preview so each tap visibly moves the number.
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
          <p className="text-gray-400 text-[14px] leading-relaxed mb-7">
            Suggested from your answers — change anything that doesn't fit.
          </p>

          {/* Live-updating ring preview */}
          <div className="flex items-start justify-around mb-8">
            <Ring color={RING_COLORS.strength} progress={0.08} size={68} stroke={7} label="Strength" goal={weeklyGoals.strength} goalOnly />
            <Ring color={RING_COLORS.cardio}   progress={0.08} size={68} stroke={7} label="Cardio"   goal={weeklyGoals.cardio}   goalOnly />
            <Ring color={RING_COLORS.recovery} progress={0.08} size={68} stroke={7} label="Recovery" goal={weeklyGoals.recovery} goalOnly />
          </div>

          <div className="mb-5">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: RING_COLORS.strength }} />
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
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: RING_COLORS.cardio }} />
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
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: RING_COLORS.recovery }} />
              <label className="text-[14px] font-semibold">Recovery sessions / week</label>
            </div>
            <GoalChips
              color={RING_COLORS.recovery}
              value={weeklyGoals.recovery}
              options={RECOVERY_OPTIONS}
              onChange={(v) => setField('recovery', v)}
            />
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-6 pb-12" style={{ background: 'linear-gradient(to top, #000 80%, transparent)' }}>
        <button
          onClick={onContinue}
          className="w-full py-4 rounded-xl font-bold text-lg transition-all duration-150"
          style={{ backgroundColor: '#00FF94', color: 'black' }}
          {...ctaPressProps(true)}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Daily Targets screen — steps + calories baselines (don't affect rings)
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
          <h2 className="text-2xl font-bold mb-2">Set your daily baseline.</h2>
          <p className="text-gray-400 text-[14px] leading-relaxed mb-3">
            Two floors to hit every day — a step count and an active calorie burn.
          </p>
          <div className="rounded-xl p-3 mb-7 flex items-start gap-2" style={{ backgroundColor: 'rgba(0,209,255,0.08)', border: '1px solid rgba(0,209,255,0.2)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00D1FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: 1, flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p className="text-[12px] leading-snug" style={{ color: '#E0F7FF' }}>
              These don't count toward your weekly rings — they're a daily movement floor to keep you honest on rest days.
            </p>
          </div>

          <div className="mb-7">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: RING_COLORS.strength }} />
              <label className="text-[14px] font-semibold">Steps / day</label>
            </div>
            <p className="text-xs text-gray-500 mb-3 ml-4">10k+ is the standard for general health.</p>
            <GoalChips
              color={RING_COLORS.strength}
              value={weeklyGoals.stepsPerDay}
              options={STEPS_OPTIONS}
              onChange={(v) => setField('stepsPerDay', v)}
              formatLabel={(v) => `${v / 1000}k`}
            />
          </div>

          <div className="mb-7">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: RING_COLORS.cardio }} />
              <label className="text-[14px] font-semibold">Active calories / day</label>
            </div>
            <p className="text-xs text-gray-500 mb-3 ml-4">Calories burned through exercise only. 400–600 is typical.</p>
            <GoalChips
              color={RING_COLORS.cardio}
              value={weeklyGoals.caloriesPerDay}
              options={CALORIES_OPTIONS}
              onChange={(v) => setField('caloriesPerDay', v)}
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
          style={{ backgroundColor: '#00FF94', color: 'black' }}
          {...ctaPressProps(true)}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// HealthKit permission pre-screen
// ============================================================================

function HKPrescreen({ onConnected, onSkip }) {
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
          <h2 className="text-2xl font-bold mb-3">dayseven works best when it knows what you've already done.</h2>
          <p className="text-gray-400 text-[15px] leading-relaxed">
            Connect Apple Health to automatically log workouts to your rings — no manual entry needed.
          </p>
        </div>
      </div>
      <div className="fixed bottom-0 left-0 right-0 p-6 pb-12" style={{ background: 'linear-gradient(to top, #000 80%, transparent)' }}>
        <button
          onClick={handleConnect}
          disabled={requesting}
          className="w-full py-4 rounded-xl font-bold text-lg transition-all duration-150"
          style={{ backgroundColor: '#00FF94', color: 'black', opacity: requesting ? 0.6 : 1 }}
          {...ctaPressProps(!requesting)}
        >
          {requesting ? 'Connecting…' : 'Connect Apple Health'}
        </button>
        <button onClick={onSkip} className="w-full mt-3 py-3 text-gray-400 text-sm font-medium">
          I'll do this later
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
  if (['Running','Cycle','Sports','Stair Climbing','Elliptical','Rowing','Walking','Hiking','Swimming'].includes(activity.type)) return 'cardio';
  if (['Cold Plunge','Sauna','Contrast Therapy','Massage','Chiropractic','Yoga','Pilates'].includes(activity.type)) return 'recovery';
  return null;
}

function workoutCardIcon(ring, type) {
  // Lightweight inline glyph by ring color
  if (ring === 'strength') return '🏋️';
  if (ring === 'cardio') {
    if (type === 'Cycle' || type === 'Cycling') return '🚴';
    if (type === 'Walking') return '🚶';
    return '🏃';
  }
  if (ring === 'recovery') {
    if (type === 'Cold Plunge') return '🧊';
    if (type === 'Sauna')       return '🔥';
    if (type === 'Yoga')        return '🧘';
    if (type === 'Pilates')     return '🤸';
    return '🌿';
  }
  return '💪';
}

function LinkingScreen({ weeklyGoals, hkAuthorized, answers, initialLinked, initialCredits, onContinue }) {
  const [hkWorkouts, setHkWorkouts] = useState([]);
  const [loadingHK, setLoadingHK] = useState(hkAuthorized && Capacitor.isNativePlatform());
  // linkedIds: Set of activity IDs currently linked
  const [linkedIds, setLinkedIds] = useState(() => new Set((initialLinked || []).map(a => a.id)));
  const [claimedCreditIds, setClaimedCreditIds] = useState(() => new Set((initialCredits || []).map(c => c.id)));

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
        const weekOnly = (workouts || []).filter(w => isInCurrentWeek(w.date));
        setHkWorkouts(weekOnly);
      } catch (e) {
        if (!cancelled) setHkWorkouts([]);
      } finally {
        if (!cancelled) setLoadingHK(false);
      }
    })();
    return () => { cancelled = true; };
  }, [hkAuthorized]);

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
    { id: 'credit_recovery', ring: 'recovery', label: recoveryCreditLabel(answers.recovery) },
  ]), [answers.origin, answers.recovery]);

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
    onContinue({ linkedWorkouts, onboardingCredits: credits });
  };

  const hasAnyHK = hkWorkouts.length > 0;
  const hasAnyCredit = visibleCredits.length > 0;

  // Aggregate progress across all three rings — drives the under-rings
  // progress bar so users see total momentum, not just per-ring fill.
  const totalGoal = (weeklyGoals.strength || 0) + (weeklyGoals.cardio || 0) + (weeklyGoals.recovery || 0);
  const totalDone = ringTotals.strength + ringTotals.cardio + ringTotals.recovery;
  const totalPct = totalGoal ? Math.min(100, (totalDone / totalGoal) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 bg-black text-white flex flex-col overflow-hidden">
      {/* Sticky rings header */}
      <div className="flex-shrink-0 px-6 pb-4" style={{ backgroundColor: '#000', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
        <h2 className="text-2xl font-bold mb-1">Let's build your first week.</h2>
        <p className="text-gray-500 text-sm mb-5">Tap any sessions below to link them to your rings.</p>
        <div className="flex items-start justify-around">
          <Ring size={72} stroke={8} color={RING_COLORS.strength} progress={ringProgress('strength')} label="Strength" count={ringTotals.strength} goal={weeklyGoals.strength} />
          <Ring size={72} stroke={8} color={RING_COLORS.cardio}   progress={ringProgress('cardio')}   label="Cardio"   count={ringTotals.cardio}   goal={weeklyGoals.cardio} />
          <Ring size={72} stroke={8} color={RING_COLORS.recovery} progress={ringProgress('recovery')} label="Recovery" count={ringTotals.recovery} goal={weeklyGoals.recovery} />
        </div>

        {/* Aggregate progress bar — mirrors the home tab's overall progress
            pattern so users feel forward motion across all three rings as
            they tap to link / claim credits. */}
        <div className="mt-5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Week progress</span>
            <span className="text-[12px] font-semibold text-white tabular-nums">
              {Math.round(totalPct)}%
            </span>
          </div>
          <div className="w-full rounded-full overflow-hidden" style={{ height: 4, backgroundColor: 'rgba(255,255,255,0.1)' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${totalPct}%`, backgroundColor: '#00FF94' }}
            />
          </div>
        </div>
      </div>

      {/* Scrollable card list */}
      <div className="flex-1 px-6 py-5 pb-32 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        {loadingHK && (
          <div className="text-center text-gray-500 text-sm py-6">Reading from Apple Health…</div>
        )}

        {hasAnyHK && (
          <div className="mb-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">This week from Apple Health</h3>
            <div className="space-y-2">
              {hkWorkouts.map(w => {
                const ring = activityRing(w);
                const color = ring ? RING_COLORS[ring] : '#888';
                const linked = linkedIds.has(w.id);
                return (
                  <button
                    key={w.id}
                    onClick={() => toggleLink(w.id)}
                    className="w-full p-4 rounded-2xl text-left transition-all duration-200 border-2 flex items-center gap-3"
                    style={{
                      backgroundColor: linked ? `${color}15` : 'rgba(255,255,255,0.04)',
                      borderColor: linked ? color : 'rgba(255,255,255,0.08)',
                      transform: 'scale(1)',
                    }}
                    {...pressProps}
                  >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${color}20` }}>
                      <span className="text-xl">{workoutCardIcon(ring, w.type)}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-[15px]" style={{ color: linked ? color : 'white' }}>
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
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00FF94" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2z" />
              </svg>
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#00FF94' }}>You've earned this</h3>
            </div>
            <p className="text-xs text-gray-500 mb-3">A starting credit for making it through. Tap each one to claim — they count toward your first week's streak.</p>
            <div className="space-y-2">
              {visibleCredits.map(c => {
                const color = RING_COLORS[c.ring];
                const claimed = claimedCreditIds.has(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => toggleCredit(c.id)}
                    className="w-full p-4 rounded-2xl text-left transition-all duration-200 flex items-center gap-3"
                    style={{
                      backgroundColor: claimed ? `${color}15` : 'rgba(255,255,255,0.025)',
                      border: claimed ? `2px solid ${color}` : '1px dashed rgba(255,255,255,0.18)',
                      transform: 'scale(1)',
                    }}
                    {...pressProps}
                  >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${color}20` }}>
                      <span className="text-xl">{workoutCardIcon(c.ring, c.label)}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-[15px]" style={{ color: claimed ? color : 'white' }}>
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
          style={{ backgroundColor: '#00FF94', color: 'black' }}
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
// screen and the notification ask. Recaps ring state + what's left to
// complete the first hybrid week. Always shows with positive framing, even
// when the user claimed zero credits / linked nothing.
// ============================================================================

function CelebrateScreen({ weeklyGoals, linkedWorkouts, onboardingCredits, onContinue }) {
  // Animate rings from 0 → current as the screen mounts.
  const [progressed, setProgressed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setProgressed(true), 250);
    return () => clearTimeout(t);
  }, []);

  const totals = useMemo(() => {
    const c = { strength: 0, cardio: 0, recovery: 0 };
    for (const a of [...(linkedWorkouts || []), ...(onboardingCredits || [])]) {
      const r = activityRing(a);
      if (r) c[r] += 1;
    }
    return c;
  }, [linkedWorkouts, onboardingCredits]);

  const remaining = {
    strength: Math.max(0, (weeklyGoals.strength || 0) - totals.strength),
    cardio:   Math.max(0, (weeklyGoals.cardio   || 0) - totals.cardio),
    recovery: Math.max(0, (weeklyGoals.recovery || 0) - totals.recovery),
  };
  const allDone = remaining.strength === 0 && remaining.cardio === 0 && remaining.recovery === 0;

  const ringProgress = (ring) => {
    const goal = weeklyGoals[ring];
    if (!goal) return 0;
    return progressed ? Math.min(1, totals[ring] / goal) : 0;
  };

  const headline = allDone ? 'First week — locked in.' : 'Already on your way.';
  const subhead = allDone
    ? "Every session from here compounds. Now make it real."
    : "Here's what's left to complete your first hybrid week.";

  const breakdownRow = (ring, label, isLast) => {
    const rem = remaining[ring];
    const color = RING_COLORS[ring];
    return (
      <div
        key={ring}
        className="flex items-center justify-between py-3"
        style={isLast ? undefined : { borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-[15px] font-semibold text-white">{label}</span>
        </div>
        {rem === 0 ? (
          <span className="text-[13px] font-semibold flex items-center gap-1.5" style={{ color }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Complete
          </span>
        ) : (
          <span className="text-[14px] font-semibold text-white tabular-nums">
            <span style={{ color }}>{rem}</span>
            <span className="text-gray-500 font-medium"> more</span>
          </span>
        )}
      </div>
    );
  };

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
            <p className="text-[15px] leading-relaxed mb-10 text-gray-400">{subhead}</p>

            <div className="flex items-start justify-around mb-8">
              <Ring color={RING_COLORS.strength} progress={ringProgress('strength')} size={96} stroke={9} label="Strength" count={totals.strength} goal={weeklyGoals.strength} />
              <Ring color={RING_COLORS.cardio}   progress={ringProgress('cardio')}   size={96} stroke={9} label="Cardio"   count={totals.cardio}   goal={weeklyGoals.cardio} />
              <Ring color={RING_COLORS.recovery} progress={ringProgress('recovery')} size={96} stroke={9} label="Recovery" count={totals.recovery} goal={weeklyGoals.recovery} />
            </div>

            {!allDone && (
              <div className="rounded-2xl px-4" style={{ backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                {breakdownRow('strength', 'Strength', false)}
                {breakdownRow('cardio',   'Cardio',   false)}
                {breakdownRow('recovery', 'Recovery', true)}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-6 pb-12" style={{ background: 'linear-gradient(to top, #000 80%, transparent)' }}>
        <button
          onClick={onContinue}
          className="w-full py-4 rounded-xl font-bold text-lg transition-all duration-150"
          style={{ backgroundColor: '#00FF94', color: 'black' }}
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
            Enable notifications and dayseven will remind you when a ring is still open — before the week closes.
          </p>

          {/* Mock notification preview */}
          <div className="rounded-2xl p-4 mx-auto max-w-sm text-left" style={{ backgroundColor: 'rgba(255,255,255,0.06)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex items-center gap-2 mb-1.5">
              <img src="/icon-transparent.png" alt="" className="w-5 h-5 rounded" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">dayseven</span>
              <span className="text-[11px] text-gray-500 ml-auto">now</span>
            </div>
            <p className="text-[14px] text-white">
              Your strength ring is still open. 2 days left.
            </p>
          </div>
        </div>
      </div>
      <div className="fixed bottom-0 left-0 right-0 p-6 pb-12" style={{ background: 'linear-gradient(to top, #000 80%, transparent)' }}>
        <button
          onClick={handleEnable}
          disabled={busy}
          className="w-full py-4 rounded-xl font-bold text-lg transition-all duration-150"
          style={{ backgroundColor: '#00FF94', color: 'black', opacity: busy ? 0.6 : 1 }}
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
// Steps: 'welcome' → 'survey' → 'results' → 'hk' → 'linking' → 'notif' → done
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
  // weeklyGoals: editable on the results screen. Holds ring goals (strength/
  // cardio/recovery) + daily targets (stepsPerDay/caloriesPerDay). null until
  // the survey completes.
  const [weeklyGoals, setWeeklyGoals] = useState(null);
  const [distanceUnit, setDistanceUnit] = useState('mi');
  const [hkAuthorized, setHkAuthorized] = useState(false);
  const [linkedWorkouts, setLinkedWorkouts] = useState([]);
  const [onboardingCredits, setOnboardingCredits] = useState([]);

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
          onBack={() => goBack('welcome')}
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
            goForward('hk');
          }}
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
          onSkip={() => {
            setHkAuthorized(false);
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
          onContinue={({ linkedWorkouts: lw, onboardingCredits: cr }) => {
            setLinkedWorkouts(lw);
            setOnboardingCredits(cr);
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

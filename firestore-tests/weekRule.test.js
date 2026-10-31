// Unit tests for the server's port of the app's week rule (functions/weekRule.js). No
// emulator. Cases mirror src/utils/weekGoals.js and canHold in src/utils/streakShield.js.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  weekKeyOf, normalizeGoals, weekGoalsResolver, winningCategories, judgeWeek, canHold,
} = require('../functions/weekRule');

describe('weekGoalsResolver', () => {
  it('no goals set: the app\'s defaults (4 strength, 3 cardio)', () => {
    assert.deepEqual(normalizeGoals(undefined), { lifts: 4, cardio: 3, recovery: 2, stepsPerDay: 10000 });
  });

  it('a past week uses the goals in force then, not today\'s', () => {
    const resolve = weekGoalsResolver({ liftsPerWeek: 2, cardioPerWeek: 2 }, [
      { fromWeek: '2026-10-18', liftsPerWeek: 2, cardioPerWeek: 2 },
      { fromWeek: '2026-09-06', liftsPerWeek: 5, cardioPerWeek: 4, stepsPerDay: null },
    ]);
    assert.equal(resolve('2026-10-11').lifts, 5);
    assert.equal(resolve('2026-10-11').stepsPerDay, 10000); // null entry → current
    assert.equal(resolve('2026-10-18').lifts, 2);
    assert.equal(resolve('2026-08-30').lifts, 2); // before any entry → current
  });

  it('a queued edit applies from its Sunday, before the app has moved it into goals', () => {
    const resolve = weekGoalsResolver({ liftsPerWeek: 4, cardioPerWeek: 3 }, [],
      { liftsPerWeek: 2, cardioPerWeek: null, applyOn: '2026-11-01', queuedAt: '2026-10-28T10:00:00Z' });
    assert.equal(resolve('2026-10-25').lifts, 4);
    assert.deepEqual(resolve('2026-11-01'), { lifts: 2, cardio: 3, recovery: 2, stepsPerDay: 10000 });
  });

  it('week keys are Sunday-start', () => {
    assert.equal(weekKeyOf('2026-10-31'), '2026-10-25');
    assert.equal(weekKeyOf('2026-11-01'), '2026-11-01');
  });
});

describe('winningCategories', () => {
  it('original rule before winningRuleFrom, steps from it, no steps without step data', () => {
    assert.deepEqual(winningCategories('2026-10-18', { winningRuleFrom: '2026-10-25' }), ['lifts', 'cardio', 'recovery']);
    assert.deepEqual(winningCategories('2026-10-25', { winningRuleFrom: '2026-10-25', stepsTracked: true }), ['lifts', 'cardio', 'steps']);
    assert.deepEqual(winningCategories('2026-10-25', { winningRuleFrom: '2026-10-25', stepsTracked: false }), ['lifts', 'cardio']);
    assert.deepEqual(winningCategories('2026-10-25', {}), ['lifts', 'cardio', 'recovery']);
  });
});

describe('judgeWeek', () => {
  const goals = { lifts: 3, cardio: 2, recovery: 0, stepsPerDay: 10000 };

  it('a recovery goal of 0 is never met', () => {
    const judged = judgeWeek({ lifts: 3, cardio: 2, recovery: 0 }, goals);
    assert.equal(judged.recovery, false);
    assert.equal(judged.all, false);
  });

  it('steps rule: won when strength, cardio and 70k steps are all in', () => {
    const judged = judgeWeek({ lifts: 3, cardio: 2 }, goals, { weekSteps: 70000, required: ['lifts', 'cardio', 'steps'] });
    assert.equal(judged.all, true);
    assert.equal(judged.percent, 100);
  });

  it('percent caps each goal at 100%', () => {
    const judged = judgeWeek({ lifts: 6, cardio: 0 }, goals, { required: ['lifts', 'cardio'] });
    assert.equal(judged.percent, 50);
  });
});

describe('canHold', () => {
  const goals = { lifts: 3, cardio: 2, recovery: 2, stepsPerDay: 10000 };
  const req = { required: ['lifts', 'cardio', 'steps'] };

  it('70% with every goal halfway holds', () => {
    // 2/3 lifts, 2/2 cardio, 35k/70k steps → (67 + 100 + 50) / 3 = 72%
    assert.equal(canHold(judgeWeek({ lifts: 2, cardio: 2 }, goals, { ...req, weekSteps: 35000 })), true);
  });

  it('70% with one goal short of halfway does not', () => {
    // 3/3, 2/2, 20k/70k steps → (100 + 100 + 29) / 3 = 76%, steps short of half
    assert.equal(canHold(judgeWeek({ lifts: 3, cardio: 2 }, goals, { ...req, weekSteps: 20000 })), false);
  });

  it('under 70% does not, and a won week needs no hold', () => {
    assert.equal(canHold(judgeWeek({ lifts: 2, cardio: 1 }, goals, { ...req, weekSteps: 35000 })), false);
    assert.equal(canHold(judgeWeek({ lifts: 3, cardio: 2 }, goals, { ...req, weekSteps: 70000 })), false);
  });
});

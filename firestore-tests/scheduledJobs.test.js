// The hourly scheduled jobs, run in this process against the Firestore emulator (the
// functions emulator can't fire schedules). FCM is stubbed to record what would be sent,
// and the clock is shifted so each job's local-time gate opens. Project demo-jobs, so no
// emulator trigger touches this data.
const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

process.env.GCLOUD_PROJECT = 'demo-jobs';
// emulators:exec sets FIREBASE_CONFIG to the functions emulator's project, and the Admin
// SDK prefers it; without this the emulator's triggers would run on this data too.
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-jobs' });
const functionsDir = path.join(__dirname, '..', 'functions');
const messagingModule = require(require.resolve('firebase-admin/messaging', { paths: [functionsDir] }));
const sent = [];
messagingModule.getMessaging = () => ({
  sendEachForMulticast: async (message) => {
    sent.push(message);
    return { successCount: message.tokens.length, failureCount: 0, responses: message.tokens.map(() => ({ success: true })) };
  },
});
const jobs = require(path.join(functionsDir, 'index.js'));
const { getFirestore } = require(require.resolve('firebase-admin/firestore', { paths: [functionsDir] }));
const db = getFirestore();

// Run `fn` with the clock moved to `isoNow` (time keeps ticking; only the offset changes).
const RealDate = Date;
async function at(isoNow, fn) {
  const offset = new RealDate(isoNow).getTime() - RealDate.now();
  class ShiftedDate extends RealDate {
    constructor(...args) { if (args.length) super(...args); else super(RealDate.now() + offset); }
    static now() { return RealDate.now() + offset; }
  }
  global.Date = ShiftedDate;
  try { return await fn(); } finally { global.Date = RealDate; }
}

const DAY = 24 * 60 * 60 * 1000;
const pushesTo = (uid) => sent.filter((m) => m.tokens.includes(`token-${uid}`));

async function user(uid, data) {
  await db.collection('users').doc(uid).set({ username: uid, subscriptionRequired: true, forceProTier: true, ...data });
  await db.collection('userTokens').doc(uid).set({ tokens: [`token-${uid}`] });
}

async function clearAll() {
  for (const name of ['users', 'userTokens', 'notificationEvents', 'config', 'publicProfiles']) {
    const snap = await db.collection(name).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

describe('scheduled jobs', () => {
  before(clearAll);
  beforeEach(async () => { sent.length = 0; await clearAll(); });
  after(clearAll);

  it('daily reminders: saved-on users only, at their reminder time', async () => {
    const prefs = (extra) => ({ notificationPreferences: { timezone: 'UTC', dailyReminderTime: '09:00', ...extra } });
    await user('on', prefs({ dailyReminders: true }));
    await user('never-chose', prefs({}));
    await user('injured', { ...prefs({ dailyReminders: true }), injuryMode: { isActive: true } });
    await user('other-time', prefs({ dailyReminders: true, dailyReminderTime: '18:00' }));
    await at('2026-10-29T09:10:00Z', () => jobs.sendDailyReminders.run({}));
    assert.equal(pushesTo('on').length, 1);
    assert.equal(pushesTo('on')[0].notification.title, 'Time to Move!');
    assert.equal(pushesTo('never-chose').length, 0);
    assert.equal(pushesTo('injured').length, 0);
    assert.equal(pushesTo('other-time').length, 0);
  });

  it('daily reminders skip a user who already logged today (activities read on demand)', async () => {
    await user('done', { notificationPreferences: { timezone: 'UTC', dailyReminders: true }, activities: [{ id: 1, type: 'Running', date: '2026-10-29' }] });
    await at('2026-10-29T09:10:00Z', () => jobs.sendDailyReminders.run({}));
    assert.equal(pushesTo('done').length, 0);
  });

  // Steps rule with no step data: the Winning Streak needs Strength + Cardio. Oct 18–24 is
  // the last closed week on Thursday Oct 29.
  const streakUser = (activities, goals = { liftsPerWeek: 1, cardioPerWeek: 1 }) => ({
    notificationPreferences: { timezone: 'UTC' }, streaks: { master: 4 }, winningRuleFrom: '2026-09-06', goals, activities,
  });
  const WON_LAST_WEEK = [{ id: 1, type: 'Strength Training', date: '2026-10-19' }, { id: 2, type: 'Running', date: '2026-10-20' }];

  it('streak reminder: 8 PM local, only after two quiet days', async () => {
    await user('quiet', streakUser([...WON_LAST_WEEK, { id: 3, type: 'Running', date: '2026-10-25' }]));
    await user('active', streakUser([...WON_LAST_WEEK, { id: 3, type: 'Running', date: '2026-10-28' }]));
    await at('2026-10-29T20:05:00Z', () => jobs.sendStreakReminders.run({}));
    assert.equal(pushesTo('quiet').length, 1);
    assert.doesNotMatch(pushesTo('quiet')[0].notification.body, /\d-week/); // the saved count may be stale
    assert.equal(pushesTo('active').length, 0);
  });

  it('streak reminder: once per lapse', async () => {
    const activities = [...WON_LAST_WEEK, { id: 3, type: 'Running', date: '2026-10-25' }];
    await user('lapse', streakUser(activities));
    await at('2026-10-29T20:05:00Z', () => jobs.sendStreakReminders.run({}));
    await at('2026-10-30T20:05:00Z', () => jobs.sendStreakReminders.run({}));
    assert.equal(pushesTo('lapse').length, 1);
    // Back on Oct 30 (which wins that week), then quiet again: a new lapse.
    await db.collection('users').doc('lapse').update({ activities: [...activities, { id: 4, type: 'Strength Training', date: '2026-10-30' }] });
    await at('2026-11-02T20:05:00Z', () => jobs.sendStreakReminders.run({}));
    assert.equal(pushesTo('lapse').length, 2);
  });

  it('streak reminder: after a held week, never after a lost one', async () => {
    const goals = { liftsPerWeek: 2, cardioPerWeek: 2 };
    const cardio = [{ id: 2, type: 'Running', date: '2026-10-20' }, { id: 3, type: 'Running', date: '2026-10-22' }];
    // 1 of 2 strength, 2 of 2 cardio: 75%, every goal halfway → held.
    await user('held', streakUser([{ id: 1, type: 'Strength Training', date: '2026-10-19' }, ...cardio], goals));
    // No strength: 50% → lost, though the saved streak still says 4.
    await user('lost', streakUser(cardio, goals));
    await at('2026-10-29T20:05:00Z', () => jobs.sendStreakReminders.run({}));
    assert.equal(pushesTo('held').length, 1);
    assert.equal(pushesTo('lost').length, 0);
  });

  it('streak reminder: last week judged against the goals in force then', async () => {
    // Goals went up this week; last week's 1 + 1 met the 1 + 1 in force then.
    await user('raised', {
      ...streakUser(WON_LAST_WEEK, { liftsPerWeek: 4, cardioPerWeek: 3 }),
      goalHistory: [{ fromWeek: '2026-10-04', liftsPerWeek: 1, cardioPerWeek: 1 }, { fromWeek: '2026-10-25', liftsPerWeek: 4, cardioPerWeek: 3 }],
    });
    await at('2026-10-29T20:05:00Z', () => jobs.sendStreakReminders.run({}));
    assert.equal(pushesTo('raised').length, 1);
  });

  it('goal reminder: Thursday 8 AM, judged on the local week', async () => {
    await user('thu', {
      notificationPreferences: { timezone: 'UTC' },
      goals: { liftsPerWeek: 2, cardioPerWeek: 1, recoveryPerWeek: 0 },
      activities: [
        { id: 1, type: 'Strength Training', date: '2026-10-26' },
        { id: 2, type: 'Running', date: '2026-10-24' }, // last week
      ],
    });
    await at('2026-10-29T08:01:00Z', () => jobs.sendGoalReminder.run({}));
    assert.equal(pushesTo('thu').length, 1);
    assert.match(pushesTo('thu')[0].notification.title, /^1\/3 Workouts Done/);
    assert.equal(pushesTo('thu')[0].notification.body, 'Still need 1 strength + 1 cardio to win the week — 3 days left! 💪');
  });

  it('goal reminder: a week won early names only the goals it needed (no step data)', async () => {
    await user('nosteps', {
      notificationPreferences: { timezone: 'UTC' }, winningRuleFrom: '2026-09-06',
      goals: { liftsPerWeek: 1, cardioPerWeek: 1 },
      activities: [{ id: 1, type: 'Strength Training', date: '2026-10-26' }, { id: 2, type: 'Running', date: '2026-10-27' }],
    });
    await at('2026-10-29T08:01:00Z', () => jobs.sendGoalReminder.run({}));
    assert.equal(pushesTo('nosteps')[0].notification.title, 'Week Won Early! 🏆');
    assert.match(pushesTo('nosteps')[0].notification.body, /^Strength and cardio are done with 3 days to spare/);
  });

  it('goal reminder: no goals set means the app\'s defaults (4 strength, 3 cardio)', async () => {
    await user('defaults', {
      notificationPreferences: { timezone: 'UTC' }, winningRuleFrom: '2026-09-06',
      activities: [{ id: 1, type: 'Strength Training', date: '2026-10-26' }],
    });
    await at('2026-10-29T08:01:00Z', () => jobs.sendGoalReminder.run({}));
    assert.match(pushesTo('defaults')[0].notification.title, /^1\/7 Workouts Done/);
  });

  it('weekly summary counts last Sunday–Saturday, not this morning', async () => {
    await user('week', {
      notificationPreferences: { timezone: 'UTC' },
      activities: [
        { id: 1, type: 'Running', date: '2026-10-24', calories: 100 }, // the week before
        { id: 2, type: 'Running', date: '2026-10-25', calories: 100 },
        { id: 3, type: 'Strength Training', date: '2026-10-28', calories: 100 },
        { id: 4, type: 'Running', date: '2026-10-31', calories: 100 },
        { id: 5, type: 'Running', date: '2026-11-01', calories: 100 }, // this morning
      ],
    });
    await at('2026-11-01T10:05:00Z', () => jobs.sendWeeklySummary.run({}));
    assert.equal(pushesTo('week').length, 1);
    assert.match(pushesTo('week')[0].notification.body, /^3 workouts, .*300 cal\./);
    assert.deepEqual((await db.collection('users').doc('week').get()).data().pendingSharePrompt.type, 'weekly');
  });

  it('weekly summary: no steps line for a user without step data', async () => {
    await user('nostepsweek', {
      notificationPreferences: { timezone: 'UTC' }, winningRuleFrom: '2026-09-06',
      activities: [{ id: 1, type: 'Running', date: '2026-10-26', calories: 100 }],
    });
    await at('2026-11-01T10:05:00Z', () => jobs.sendWeeklySummary.run({}));
    assert.equal(pushesTo('nostepsweek')[0].notification.body, '1 workouts, 100 cal. Tap to share with friends!');
  });

  it('an entitlement a day past its stored expiry is no access (a missed EXPIRATION)', async () => {
    const prefs = { notificationPreferences: { timezone: 'UTC', dailyReminders: true, dailyReminderTime: '09:00' } };
    const sub = (expiresAt) => ({ forceProTier: false, subscription: { entitlementActive: true, status: 'active', expiresAt } });
    await user('stale-sub', { ...prefs, ...sub('2026-10-26T00:00:00.000Z') });
    await user('renewing', { ...prefs, ...sub('2026-10-29T06:00:00.000Z') }); // renewal webhook a few hours late
    await at('2026-10-29T09:10:00Z', () => jobs.sendDailyReminders.run({}));
    assert.equal(pushesTo('stale-sub').length, 0);
    assert.equal(pushesTo('renewing').length, 1);
  });

  it('monthly summary uses the user\'s month (UTC+14 is already on the 1st)', async () => {
    await user('kiri', {
      notificationPreferences: { timezone: 'Pacific/Kiritimati' },
      activities: [
        { id: 1, type: 'Running', date: '2026-09-15', duration: 1800 },
        { id: 2, type: 'Running', date: '2026-10-02', duration: 1800 },
        { id: 3, type: 'Running', date: '2026-10-20', duration: 1800 },
        { id: 4, type: 'Running', date: '2026-10-31', duration: 1800 },
      ],
    });
    // 20:00 UTC on Oct 31 is 10:00 on Nov 1 in Kiritimati; the server's own month is still October.
    await at('2026-10-31T20:05:00Z', () => jobs.sendMonthlySummary.run({}));
    assert.equal(pushesTo('kiri').length, 1);
    assert.equal(pushesTo('kiri')[0].notification.title, 'Your October Recap 📊');
    assert.match(pushesTo('kiri')[0].notification.body, /^3 activities, .*\(\+2 from last month!\)/);
  });

  it('trial ending: day-before nudge once, flag set with update()', async () => {
    const now = new RealDate('2026-10-29T12:00:00Z').getTime();
    await user('trial', {
      forceProTier: false,
      notificationPreferences: { timezone: 'UTC' },
      subscription: { status: 'trial', entitlementActive: true, willRenew: false, trialEndsAt: new RealDate(now + DAY).toISOString() },
      activities: [{ id: 1, type: 'Running', date: '2026-10-28' }],
    });
    await at('2026-10-29T12:00:00Z', () => jobs.sendTrialEndingReminders.run({}));
    assert.equal(pushesTo('trial').length, 1);
    assert.match(pushesTo('trial')[0].notification.body, /^Your week: 1 workout/);
    assert.equal((await db.collection('users').doc('trial').get()).data().trialEndingNotified, true);
  });

  it('win-back: 6 PM local, lapsed user, stage recorded', async () => {
    await db.collection('config').doc('lifecycleNotifications').set({ winbackEnabled: true });
    await user('lapsed', {
      forceProTier: false,
      notificationPreferences: { timezone: 'UTC' },
      createdAt: '2026-10-01T00:00:00.000Z',
      subscription: { entitlementActive: false, status: 'expired', expiresAt: '2026-10-27T00:00:00.000Z' },
      activities: [{ id: 1, type: 'Running', date: '2026-10-20' }],
    });
    await user('subscribed', {
      forceProTier: false,
      notificationPreferences: { timezone: 'UTC' },
      subscription: { entitlementActive: true, status: 'active' },
    });
    await at('2026-10-29T18:05:00Z', () => jobs.sendWinbackReminders.run({}));
    assert.equal(pushesTo('lapsed').length, 1);
    assert.equal(pushesTo('lapsed')[0].notification.title, 'We saved your spot 👋');
    assert.equal((await db.collection('users').doc('lapsed').get()).data().winbackStage, 1);
    assert.equal(pushesTo('subscribed').length, 0);
  });

  it('activation: first-workout nudge at 5 PM local for a new user', async () => {
    await user('newbie', {
      notificationPreferences: { timezone: 'UTC' },
      createdAt: new RealDate(new RealDate('2026-10-29T17:00:00Z').getTime() - 1.5 * DAY).toISOString(),
      activities: [],
    });
    await at('2026-10-29T17:05:00Z', () => jobs.sendActivationReminders.run({}));
    assert.equal(pushesTo('newbie').length, 1);
    assert.equal((await db.collection('users').doc('newbie').get()).data().activationFirstNudge, true);
  });
});

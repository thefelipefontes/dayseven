// Trigger and callable handlers run in this process against the Firestore and Auth
// emulators, with FCM and Storage stubbed, so what each would send or delete can be
// checked exactly (and two runs raced). Project demo-handlers, so no emulator trigger
// touches this data.
const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

process.env.GCLOUD_PROJECT = 'demo-handlers';
// emulators:exec sets FIREBASE_CONFIG to the functions emulator's project, and the Admin
// SDK prefers it; without this the emulator's triggers would run on this data too.
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-handlers' });
const functionsDir = path.join(__dirname, '..', 'functions');
const fromFunctions = (name) => require(require.resolve(name, { paths: [functionsDir] }));

const sent = [];
fromFunctions('firebase-admin/messaging').getMessaging = () => ({
  sendEachForMulticast: async (message) => {
    sent.push(message);
    return { successCount: message.tokens.length, failureCount: 0, responses: message.tokens.map(() => ({ success: true })) };
  },
});
const storageCalls = [];
const bucket = {
  file: (name) => ({ delete: async () => { storageCalls.push(`file:${name}`); } }),
  deleteFiles: async ({ prefix }) => { storageCalls.push(`prefix:${prefix}`); },
};
fromFunctions('firebase-admin/storage').getStorage = () => ({ bucket: () => bucket });

const fns = require(path.join(functionsDir, 'index.js'));
const { weekKeyOf } = require(path.join(functionsDir, 'weekRule.js'));
const db = fromFunctions('firebase-admin/firestore').getFirestore();
const adminAuth = fromFunctions('firebase-admin/auth').getAuth();

const pushesTo = (uid) => sent.filter((m) => m.tokens.includes(`token-${uid}`));
const snap = (data) => ({ data: () => data });
const updated = (userId, before, after) => ({ params: { userId }, data: { before: snap(before), after: snap(after) } });
const exists = async (p) => (await db.doc(p).get()).exists;

async function user(uid, data = {}) {
  await db.collection('users').doc(uid).set({ username: uid, notificationPreferences: { timezone: 'UTC' }, ...data });
  await db.collection('userTokens').doc(uid).set({ tokens: [`token-${uid}`] });
}

async function clearAll() {
  for (const name of ['users', 'userTokens', 'publicProfiles', 'usernames', 'friendRequests', 'challenges', 'pushRateLimits', 'notificationEvents']) {
    await db.recursiveDelete(db.collection(name));
  }
}

describe('handlers', () => {
  before(clearAll);
  beforeEach(async () => { sent.length = 0; storageCalls.length = 0; await clearAll(); });
  after(clearAll);

  describe('onStreakMilestone', () => {
    it('two runs for the same crossing send one push', async () => {
      await user('five', { streaks: { master: 5 } });
      const ev = updated('five', { streaks: { master: 4 } }, { streaks: { master: 5 }, notificationPreferences: { timezone: 'UTC' } });
      await Promise.all([fns.onStreakMilestone.run(ev), fns.onStreakMilestone.run(ev)]);
      assert.equal(pushesTo('five').length, 1);
      assert.equal(typeof (await db.doc('users/five').get()).data().streakMilestoneNotifiedAt['5'], 'string');
    });

    it('a push that isn\'t delivered gives the claim back', async () => {
      const prefs = { timezone: 'UTC', quietHoursEnabled: true, quietHoursStart: '00:00', quietHoursEnd: '23:59' };
      await user('quiet', { streaks: { master: 5 }, notificationPreferences: prefs });
      await fns.onStreakMilestone.run(updated('quiet', { streaks: { master: 4 } }, { streaks: { master: 5 }, notificationPreferences: prefs }));
      assert.equal(pushesTo('quiet').length, 0);
      assert.equal((await db.doc('users/quiet').get()).data().streakMilestoneNotifiedAt?.['5'], undefined);
    });
  });

  describe('onGoalAchieved', () => {
    const today = new Date().toISOString().split('T')[0];
    const week = weekKeyOf(today);
    const won = (extra) => updated('winner', { weekCelebrations: { week, master: false } },
      { weekCelebrations: { week, master: true }, winningRuleFrom: '2026-09-06', notificationPreferences: { timezone: 'UTC' }, ...extra });

    it('names steps only for a user with step data', async () => {
      await user('winner', { winningRuleFrom: '2026-09-06' });
      await fns.onGoalAchieved.run(won());
      assert.equal(pushesTo('winner')[0].notification.body, 'Strength and cardio — done. Your winning streak just grew.');

      sent.length = 0;
      await db.doc('users/winner').update({ lastGoalAchievedNotifAt: null });
      await db.doc(`users/winner/dailyHealth/${today}`).set({ date: today, steps: 9000 });
      await fns.onGoalAchieved.run(won());
      assert.equal(pushesTo('winner')[0].notification.body, 'Strength, cardio and steps — done. Your winning streak just grew.');
    });
  });

  describe('push rate limits', () => {
    const reaction = (activityId, reactorUid = 'fan') => ({
      params: { ownerId: 'owner', activityId, reactionId: reactorUid },
      data: snap({ reactorUid, reactionType: '🔥', createdAt: new Date().toISOString() }),
    });

    it('a reaction pushes only for an activity the owner has, once per activity', async () => {
      await user('owner', { activities: [{ id: 1700000000000, type: 'Running', date: '2026-10-28' }] });
      await user('fan');
      await fns.onReactionCreated.run(reaction('999'));
      assert.equal(pushesTo('owner').length, 0);
      await fns.onReactionCreated.run(reaction('1700000000000'));
      await fns.onReactionCreated.run(reaction('1700000000000')); // taken back and given again
      assert.equal(pushesTo('owner').length, 1);
    });

    it('comments: ten an hour from one person', async () => {
      await user('owner');
      await user('chatty');
      for (let i = 0; i < 12; i++) {
        await fns.onCommentCreated.run({
          params: { ownerId: 'owner', activityId: '1', commentId: `c${i}` },
          data: snap({ commenterUid: 'chatty', text: `comment ${i}` }),
        });
      }
      assert.equal(pushesTo('owner').length, 10);
      // Someone else still gets through.
      await user('other');
      await fns.onCommentCreated.run({ params: { ownerId: 'owner', activityId: '1', commentId: 'o1' }, data: snap({ commenterUid: 'other', text: 'hi' }) });
      assert.equal(pushesTo('owner').length, 11);
    });

    it('friend requests: three a day for a pair', async () => {
      await user('wanted');
      await user('asker');
      for (let i = 0; i < 5; i++) {
        await fns.onFriendRequestCreated.run({ params: { requestId: 'asker_wanted' }, data: snap({ fromUid: 'asker', toUid: 'wanted', status: 'pending' }) });
      }
      assert.equal(pushesTo('wanted').length, 3);
    });
  });

  describe('completedChallengesForFeed', () => {
    it('returns wins of the caller\'s friends only, trimmed to what the feed reads', async () => {
      await db.doc('users/alice/friends/bob').set({ friendUid: 'bob' });
      await db.doc('challenges/c1').set({
        challengerUid: 'zed', challengerName: 'Zed', status: 'completed', winnerUids: ['alice'], participantUids: ['zed', 'alice'],
        participants: { alice: { status: 'completed', fulfillingActivityId: '42', fulfillingPhotoURL: 'https://x/p.jpg', completionMessage: 'gg' } },
        challengerActivity: { activityId: '7', type: 'Running' }, requirePhoto: true, title: 'Run',
      });
      await db.doc('challenges/c2').set({ challengerUid: 'zed', status: 'completed', winnerUids: ['carol'], participantUids: ['zed', 'carol'] });
      const { challenges } = await fns.completedChallengesForFeed.run({ auth: { uid: 'bob', token: {} }, data: { uids: ['alice', 'carol'] } });
      assert.deepEqual(challenges, [{
        id: 'c1', challengerUid: 'zed', challengerName: 'Zed', challengerActivity: { activityId: '7' }, requirePhoto: true,
        participants: { alice: { status: 'completed', fulfillingActivityId: '42' } },
        friendUid: null, friendStatus: null, fulfillingActivityId: null,
      }]);
    });
  });

  describe('account deletion', () => {
    // 'gone' has data of its own and traces in friend's: a friend doc, a comment (with
    // friend's reply under it), a reply, a reaction, a request, a challenge, a counter.
    async function seedAccount(uid) {
      await user(uid, { activities: [{ id: 1, type: 'Running', date: '2026-10-28' }] });
      await user('friend');
      await user(`${uid}zo`); // a uid that starts with this one: its photos must stay
      await db.doc(`users/${uid}/dailyHealth/2026-10-28`).set({ date: '2026-10-28', steps: 5000 });
      await db.doc(`users/${uid}/friends/friend`).set({ friendUid: 'friend' });
      await db.doc(`users/${uid}/activityComments/1/comments/mine`).set({ commenterUid: 'friend', text: 'nice' });
      await db.doc(`users/${uid}/activityReactions/1/reactions/friend`).set({ reactorUid: 'friend', reactionType: '🔥' });
      await db.doc(`users/friend/friends/${uid}`).set({ friendUid: uid });
      await db.doc(`users/friend/friends/${uid}zo`).set({ friendUid: `${uid}zo` });
      await db.doc('users/friend/activityComments/5/comments/byGone').set({ commenterUid: uid, text: 'hi' });
      await db.doc('users/friend/activityComments/5/comments/byGone/replies/r1').set({ replierUid: 'friend', text: 'yo' });
      await db.doc('users/friend/activityComments/6/comments/byFriend').set({ commenterUid: 'friend', text: 'mine' });
      await db.doc('users/friend/activityComments/6/comments/byFriend/replies/r2').set({ replierUid: uid, text: 'reply' });
      await db.doc(`users/friend/activityReactions/5/reactions/${uid}`).set({ reactorUid: uid, reactionType: '💪' });
      await db.doc(`users/friend/activityReactions/5/reactions/${uid}zo`).set({ reactorUid: `${uid}zo`, reactionType: '💪' });
      await db.doc(`friendRequests/${uid}_x`).set({ fromUid: uid, toUid: 'x', status: 'pending' });
      await db.doc('challenges/withGone').set({ participantUids: ['friend', uid], status: 'active' });
      await db.doc('challenges/without').set({ participantUids: ['friend', `${uid}zo`], status: 'active' });
      await db.doc(`usernames/${uid}`).set({ uid });
      await db.doc(`publicProfiles/${uid}`).set({ uid, username: uid });
      await db.doc(`pushRateLimits/reaction_${uid}_friend`).set({ fromUid: uid, toUid: 'friend', sent: [] });
    }

    async function assertGone(uid) {
      for (const p of [
        `users/${uid}`, `users/${uid}/dailyHealth/2026-10-28`, `users/${uid}/friends/friend`,
        `users/${uid}/activityComments/1/comments/mine`, `users/${uid}/activityReactions/1/reactions/friend`,
        `users/friend/friends/${uid}`, 'users/friend/activityComments/5/comments/byGone',
        'users/friend/activityComments/5/comments/byGone/replies/r1',
        'users/friend/activityComments/6/comments/byFriend/replies/r2', `users/friend/activityReactions/5/reactions/${uid}`,
        `friendRequests/${uid}_x`, 'challenges/withGone', `usernames/${uid}`, `userTokens/${uid}`,
        `publicProfiles/${uid}`, `pushRateLimits/reaction_${uid}_friend`,
      ]) assert.equal(await exists(p), false, `${p} should be gone`);
      for (const p of [
        'users/friend', `users/friend/friends/${uid}zo`, 'users/friend/activityComments/6/comments/byFriend',
        `users/friend/activityReactions/5/reactions/${uid}zo`, 'challenges/without', `users/${uid}zo`,
      ]) assert.equal(await exists(p), true, `${p} should stay`);
      assert.deepEqual(storageCalls.sort(), [`file:profilePhotos/${uid}`, `prefix:activityPhotos/${uid}/`]);
    }

    it('deleteAccount deletes everything, then the Auth account', async () => {
      await adminAuth.createUser({ uid: 'gone' });
      await seedAccount('gone');
      const result = await fns.deleteAccount.run({ auth: { uid: 'gone', token: { auth_time: Math.floor(Date.now() / 1000) } }, data: {} });
      assert.deepEqual(result, { deleted: true });
      await assertGone('gone');
      await assert.rejects(adminAuth.getUser('gone'), { code: 'auth/user-not-found' });
    });

    it('deleteAccount without a recent sign-in deletes nothing', async () => {
      await adminAuth.createUser({ uid: 'stale' });
      await seedAccount('stale');
      const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600;
      await assert.rejects(
        fns.deleteAccount.run({ auth: { uid: 'stale', token: { auth_time: tenMinutesAgo } }, data: {} }),
        { code: 'failed-precondition', message: 'requires-recent-login' },
      );
      assert.equal(await exists('users/stale/dailyHealth/2026-10-28'), true);
      assert.equal((await adminAuth.getUser('stale')).uid, 'stale');
      await adminAuth.deleteUser('stale');
    });

    it('an Auth deletion from elsewhere (old app, console) cleans up the rest', async () => {
      await seedAccount('oldapp');
      await fns.onAuthUserDeleted.run({ uid: 'oldapp' }, {});
      await assertGone('oldapp');
    });
  });
});

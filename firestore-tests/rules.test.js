// Emulator tests for firestore.rules (transitional) and firestore.strict.rules.
// Every case runs against both files; `expect` maps a stage to allowed/denied where the
// two differ. Run with `npm test` from this directory.
const { describe, it, before, after, beforeEach } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, limit, getDocs,
  writeBatch, serverTimestamp, deleteField,
} = require('firebase/firestore');
const { makeEnv, challengeDoc, iso, HOUR } = require('./helpers');

// alice ↔ bob and alice ↔ dave are friends; carol knows nobody; eve is a second stranger.
const USERS = ['alice', 'bob', 'carol', 'dave', 'eve'];
const FRIENDS = [['alice', 'bob'], ['alice', 'dave']];

for (const stage of ['transitional', 'strict']) {
  const strict = stage === 'strict';
  // Run `promise` expecting success when `allowed` is true for this stage.
  const check = (allowed, promise) => (allowed ? assertSucceeds(promise) : assertFails(promise));

  describe(`${stage} rules`, () => {
    let env;
    const as = (uid) => env.authenticatedContext(uid).firestore();
    const anon = () => env.unauthenticatedContext().firestore();
    const seed = (fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));

    before(async () => { env = await makeEnv(stage); });
    after(async () => { await env.cleanup(); });

    beforeEach(async () => {
      await env.clearFirestore();
      await seed(async (db) => {
        for (const uid of USERS) {
          await setDoc(doc(db, 'users', uid), {
            uid, username: uid, displayName: uid.toUpperCase(), email: `${uid}@example.com`,
            subscriptionRequired: true, subscription: { entitlementActive: true, status: 'active' },
            challengeStats: { wins: 1, losses: 0 }, activities: [{ id: 1, type: 'Running', date: '2026-10-27' }],
            notificationPreferences: { timezone: 'America/New_York' },
          });
          await setDoc(doc(db, 'publicProfiles', uid), { uid, username: uid, displayName: uid.toUpperCase(), photoURL: null });
          await setDoc(doc(db, 'usernames', uid), { uid });
          await setDoc(doc(db, 'users', uid, 'dailyHealth', '2026-10-27'), { date: '2026-10-27', steps: 8000, calories: 300 });
        }
        for (const [a, b] of FRIENDS) {
          await setDoc(doc(db, 'users', a, 'friends', b), { friendUid: b, addedAt: iso() });
          await setDoc(doc(db, 'users', b, 'friends', a), { friendUid: a, addedAt: iso() });
        }
      });
    });

    // ---------------------------------------------------------------- users

    describe('users', () => {
      it('owner reads own doc', () => assertSucceeds(getDoc(doc(as('alice'), 'users', 'alice'))));
      it('friend reads friend doc', () => assertSucceeds(getDoc(doc(as('bob'), 'users', 'alice'))));
      it('signed-out read is denied', () => assertFails(getDoc(doc(anon(), 'users', 'alice'))));
      it('stranger reads a user doc (transitional only)', () =>
        check(!strict, getDoc(doc(as('carol'), 'users', 'alice'))));
      it('old-app username search, limit 10 (transitional only)', () =>
        check(!strict, getDocs(query(collection(as('carol'), 'users'),
          where('username', '>=', 'a'), where('username', '<=', 'a'), limit(10)))));
      it('listing users without a limit is denied', () =>
        assertFails(getDocs(query(collection(as('carol'), 'users'), where('username', '==', 'alice')))));
      it('listing every user is denied', () => assertFails(getDocs(collection(as('carol'), 'users'))));

      it('new account with subscriptionRequired: true', () =>
        assertSucceeds(setDoc(doc(as('frank'), 'users', 'frank'), {
          uid: 'frank', email: 'f@example.com', displayName: null, photoURL: null,
          authProvider: 'apple', createdAt: iso(), subscriptionRequired: true,
        }, { merge: true })));
      it('new account without the field (stamped by the server)', () =>
        assertSucceeds(setDoc(doc(as('frank'), 'users', 'frank'), { goals: { liftsPerWeek: 3 } }, { merge: true })));
      it('new account with subscriptionRequired: false is denied', () =>
        assertFails(setDoc(doc(as('frank'), 'users', 'frank'), { uid: 'frank', subscriptionRequired: false })));
      for (const key of ['forceProTier', 'subscription', 'challengeStats', 'winbackStage', 'trialEndingNotified']) {
        it(`new account carrying ${key} is denied`, () =>
          assertFails(setDoc(doc(as('frank'), 'users', 'frank'), { uid: 'frank', subscriptionRequired: true, [key]: true })));
      }
      it('creating another user\'s doc is denied', () =>
        assertFails(setDoc(doc(as('carol'), 'users', 'frank'), { uid: 'frank', subscriptionRequired: true })));

      it('owner saves the fields the app writes', async () => {
        const db = as('alice');
        const ref = doc(db, 'users', 'alice');
        await assertSucceeds(setDoc(ref, { activities: [{ id: 2, type: 'Yoga', date: '2026-10-28' }] }, { merge: true }));
        await assertSucceeds(setDoc(ref, { goals: { liftsPerWeek: 4 }, goalHistory: [] }, { merge: true }));
        await assertSucceeds(setDoc(ref, { notificationPreferences: { dailyReminders: false, timezone: 'Europe/Lisbon' } }, { merge: true }));
        await assertSucceeds(setDoc(ref, { streaks: { master: 3 }, weekCelebrations: { week: '2026-10-25', master: true } }, { merge: true }));
        await assertSucceeds(setDoc(ref, { unreadBadgeCount: 0, unreadFeedCount: 0, pendingSharePrompt: null }, { merge: true }));
        await assertSucceeds(setDoc(ref, { username: 'alice2', displayName: 'Al', photoURL: 'https://x/y.jpg' }, { merge: true }));
        await assertSucceeds(updateDoc(ref, { 'streaks.lifts': 2 })); // Watch REST PATCH with a field mask
      });
      it('writing back unchanged server-only values is allowed', () =>
        assertSucceeds(setDoc(doc(as('alice'), 'users', 'alice'), {
          subscriptionRequired: true, challengeStats: { wins: 1, losses: 0 }, streaks: { master: 1 },
        }, { merge: true })));
      for (const [key, value] of [
        ['forceProTier', true],
        ['subscription', { entitlementActive: true, status: 'active', expiresAt: '2099-01-01T00:00:00.000Z' }],
        ['challengeStats', { wins: 99, losses: 0 }],
        ['winbackStage', 3],
        ['winbackLastSentAt', iso()],
        ['trialFinalNotified', true],
        ['activationFirstNudge', true],
        ['subscriptionRequired', false],
      ]) {
        it(`owner changing ${key} is denied`, () =>
          assertFails(setDoc(doc(as('alice'), 'users', 'alice'), { [key]: value }, { merge: true })));
      }
      it('owner removing subscriptionRequired is denied', () =>
        assertFails(updateDoc(doc(as('alice'), 'users', 'alice'), { subscriptionRequired: deleteField() })));
      it('owner bumping a nested challengeStats counter is denied', () =>
        assertFails(updateDoc(doc(as('alice'), 'users', 'alice'), { 'challengeStats.wins': 5 })));
      it('another user writing my doc is denied', () =>
        assertFails(setDoc(doc(as('bob'), 'users', 'alice'), { streaks: { master: 0 } }, { merge: true })));
      it('owner deletes own doc', () => assertSucceeds(deleteDoc(doc(as('alice'), 'users', 'alice'))));
      it('friend deleting my doc is denied', () => assertFails(deleteDoc(doc(as('bob'), 'users', 'alice'))));
    });

    describe('dailyHealth', () => {
      const day = (db, uid) => doc(db, 'users', uid, 'dailyHealth', '2026-10-27');
      it('owner writes', () =>
        assertSucceeds(setDoc(day(as('alice'), 'alice'), { date: '2026-10-27', steps: 9000, calories: 1, lastUpdated: iso() }, { merge: true })));
      it('friend reads (leaderboard)', () => assertSucceeds(getDoc(day(as('bob'), 'alice'))));
      it('friend lists the window (leaderboard)', () =>
        assertSucceeds(getDocs(query(collection(as('bob'), 'users', 'alice', 'dailyHealth'), where('date', '>=', '2026-10-01')))));
      it('stranger reads are denied', () => assertFails(getDoc(day(as('carol'), 'alice'))));
      it('friend writes are denied', () => assertFails(setDoc(day(as('bob'), 'alice'), { steps: 1 })));
    });

    // ---------------------------------------------------------------- public profiles + usernames

    describe('publicProfiles', () => {
      it('anyone signed in gets one', () => assertSucceeds(getDoc(doc(as('carol'), 'publicProfiles', 'alice'))));
      it('search with a limit', () =>
        assertSucceeds(getDocs(query(collection(as('carol'), 'publicProfiles'),
          where('username', '>=', 'a'), where('username', '<=', 'a'), limit(10)))));
      it('listing without a limit is denied', () => assertFails(getDocs(collection(as('carol'), 'publicProfiles'))));
      it('signed-out get is denied', () => assertFails(getDoc(doc(anon(), 'publicProfiles', 'alice'))));
      it('clients cannot write, even their own', () =>
        assertFails(setDoc(doc(as('alice'), 'publicProfiles', 'alice'), { uid: 'alice', username: 'alice', displayName: 'X' })));
    });

    describe('usernames', () => {
      it('claim a free username for myself', () => assertSucceeds(setDoc(doc(as('carol'), 'usernames', 'newname'), { uid: 'carol' })));
      it('claim a username for someone else is denied', () =>
        assertFails(setDoc(doc(as('carol'), 'usernames', 'newname'), { uid: 'alice' })));
      it('take a username someone holds is denied', () => assertFails(setDoc(doc(as('carol'), 'usernames', 'alice'), { uid: 'carol' })));
      it('re-save my own reservation', () => assertSucceeds(setDoc(doc(as('alice'), 'usernames', 'alice'), { uid: 'alice' })));
      it('hand my reservation to another uid is denied', () =>
        assertFails(setDoc(doc(as('alice'), 'usernames', 'alice'), { uid: 'carol' })));
      it('release my username', () => assertSucceeds(deleteDoc(doc(as('alice'), 'usernames', 'alice'))));
      it('release someone else\'s is denied', () => assertFails(deleteDoc(doc(as('carol'), 'usernames', 'alice'))));
      it('availability check reads one', () => assertSucceeds(getDoc(doc(as('carol'), 'usernames', 'alice'))));
      it('listing usernames is denied', () => assertFails(getDocs(collection(as('carol'), 'usernames'))));
    });

    describe('userTokens', () => {
      it('owner writes and deletes', async () => {
        await assertSucceeds(setDoc(doc(as('alice'), 'userTokens', 'alice'), { tokens: ['t1'] }, { merge: true }));
        await assertSucceeds(deleteDoc(doc(as('alice'), 'userTokens', 'alice')));
      });
      it('others cannot read or write', async () => {
        await assertFails(getDoc(doc(as('bob'), 'userTokens', 'alice')));
        await assertFails(setDoc(doc(as('bob'), 'userTokens', 'alice'), { tokens: ['x'] }));
      });
    });

    describe('pushRateLimits', () => {
      it('server only: neither side can read, reset or write a counter', async () => {
        const id = 'reaction_bob_alice';
        await seed((db) => setDoc(doc(db, 'pushRateLimits', id), { kind: 'reaction', fromUid: 'bob', toUid: 'alice', sent: [1] }));
        await assertFails(getDoc(doc(as('bob'), 'pushRateLimits', id)));
        await assertFails(getDoc(doc(as('alice'), 'pushRateLimits', id)));
        await assertFails(deleteDoc(doc(as('bob'), 'pushRateLimits', id)));
        await assertFails(setDoc(doc(as('bob'), 'pushRateLimits', 'comment_bob_alice'), { sent: [] }));
      });
    });

    // ---------------------------------------------------------------- friend requests + friends

    describe('friendRequests', () => {
      const pending = (from, to, id = `${from}_${to}_1`) => seed((db) =>
        setDoc(doc(db, 'friendRequests', id), { id, fromUid: from, toUid: to, status: 'pending', createdAt: iso() }));

      it('send a request (native shape)', () =>
        assertSucceeds(setDoc(doc(as('carol'), 'friendRequests', 'carol_eve_1'), {
          id: 'carol_eve_1', fromUid: 'carol', toUid: 'eve', status: 'pending', createdAt: iso(),
        })));
      it('send a request (web shape)', () =>
        assertSucceeds(setDoc(doc(as('carol'), 'friendRequests', 'abc'), {
          id: 'abc', fromUid: 'carol', toUid: 'eve', status: 'pending', createdAt: serverTimestamp(),
        })));
      it('forged sender is denied', () =>
        assertFails(setDoc(doc(as('carol'), 'friendRequests', 'r'), { fromUid: 'eve', toUid: 'alice', status: 'pending' })));
      it('request to myself is denied', () =>
        assertFails(setDoc(doc(as('carol'), 'friendRequests', 'r'), { fromUid: 'carol', toUid: 'carol', status: 'pending' })));
      it('request to a uid with no account is denied', () =>
        assertFails(setDoc(doc(as('carol'), 'friendRequests', 'r'), { fromUid: 'carol', toUid: 'ghost', status: 'pending' })));
      it('creating an already-accepted request is denied', () =>
        assertFails(setDoc(doc(as('carol'), 'friendRequests', 'r'), { fromUid: 'carol', toUid: 'eve', status: 'accepted' })));

      it('recipient sees incoming requests', async () => {
        await pending('carol', 'eve');
        await assertSucceeds(getDocs(query(collection(as('eve'), 'friendRequests'),
          where('toUid', '==', 'eve'), where('status', '==', 'pending'))));
      });
      it('sender sees sent requests', async () => {
        await pending('carol', 'eve');
        await assertSucceeds(getDocs(query(collection(as('carol'), 'friendRequests'),
          where('fromUid', '==', 'carol'), where('status', '==', 'pending'))));
      });
      it('duplicate check for one pair (new app)', () =>
        assertSucceeds(getDocs(query(collection(as('carol'), 'friendRequests'),
          where('fromUid', '==', 'eve'), where('toUid', '==', 'carol')))));
      it('old app lists every pending request (transitional only)', () =>
        check(!strict, getDocs(query(collection(as('carol'), 'friendRequests'), where('status', '==', 'pending')))));
      it('outsider reads a request (transitional only)', async () => {
        await pending('carol', 'eve');
        await check(!strict, getDoc(doc(as('alice'), 'friendRequests', 'carol_eve_1')));
      });

      it('recipient accepts', async () => {
        await pending('carol', 'eve');
        await assertSucceeds(updateDoc(doc(as('eve'), 'friendRequests', 'carol_eve_1'), { status: 'accepted' }));
      });
      it('web accept (merge set)', async () => {
        await pending('carol', 'eve');
        await assertSucceeds(setDoc(doc(as('eve'), 'friendRequests', 'carol_eve_1'), { status: 'accepted' }, { merge: true }));
      });
      it('sender accepting their own request is denied', async () => {
        await pending('carol', 'eve');
        await assertFails(updateDoc(doc(as('carol'), 'friendRequests', 'carol_eve_1'), { status: 'accepted' }));
      });
      it('redirecting a request is denied', async () => {
        await pending('carol', 'eve');
        await assertFails(updateDoc(doc(as('eve'), 'friendRequests', 'carol_eve_1'), { status: 'accepted', fromUid: 'alice' }));
      });
      it('either side deletes (decline / account deletion)', async () => {
        await pending('carol', 'eve');
        await assertSucceeds(deleteDoc(doc(as('eve'), 'friendRequests', 'carol_eve_1')));
        await pending('carol', 'eve');
        await assertSucceeds(deleteDoc(doc(as('carol'), 'friendRequests', 'carol_eve_1')));
      });
      it('outsider deleting a request is denied', async () => {
        await pending('carol', 'eve');
        await assertFails(deleteDoc(doc(as('alice'), 'friendRequests', 'carol_eve_1')));
      });
    });

    describe('friends', () => {
      const pending = (from, to, id) => seed((db) =>
        setDoc(doc(db, 'friendRequests', id), { id, fromUid: from, toUid: to, status: 'pending', createdAt: iso() }));
      // acceptFriendRequest() in the new app: one batch.
      const acceptBatch = (db, id, from, to) => {
        const batch = writeBatch(db);
        batch.update(doc(db, 'friendRequests', id), { status: 'accepted' });
        batch.set(doc(db, 'users', from, 'friends', to), { friendUid: to, addedAt: iso(), requestId: id });
        batch.set(doc(db, 'users', to, 'friends', from), { friendUid: from, addedAt: iso(), requestId: id });
        return batch.commit();
      };

      it('owner lists own friends', () => assertSucceeds(getDocs(collection(as('alice'), 'users', 'alice', 'friends'))));
      it('the friend reads their entry in my list', () => assertSucceeds(getDoc(doc(as('bob'), 'users', 'alice', 'friends', 'bob'))));
      it('outsider lists my friends is denied', () => assertFails(getDocs(collection(as('carol'), 'users', 'alice', 'friends'))));

      it('accept in one batch (new app)', async () => {
        await pending('carol', 'eve', 'r1');
        await assertSucceeds(acceptBatch(as('eve'), 'r1', 'carol', 'eve'));
      });
      it('accept batch over a stale friend doc', async () => {
        await pending('carol', 'eve', 'r1');
        await seed((db) => setDoc(doc(db, 'users', 'carol', 'friends', 'eve'), { friendUid: 'eve', addedAt: iso() }));
        await assertSucceeds(acceptBatch(as('eve'), 'r1', 'carol', 'eve'));
      });
      it('sender running the accept batch is denied', async () => {
        await pending('carol', 'eve', 'r1');
        await assertFails(acceptBatch(as('carol'), 'r1', 'carol', 'eve'));
      });
      it('reusing an already-accepted request later is denied', async () => {
        await seed((db) => setDoc(doc(db, 'friendRequests', 'r1'), { fromUid: 'carol', toUid: 'eve', status: 'accepted' }));
        const db = as('eve');
        await assertFails(setDoc(doc(db, 'users', 'carol', 'friends', 'eve'), { friendUid: 'eve', addedAt: iso(), requestId: 'r1' }));
      });
      it('friend doc naming someone else\'s request is denied', async () => {
        await pending('carol', 'eve', 'r1');
        const db = as('alice');
        const batch = writeBatch(db);
        batch.set(doc(db, 'users', 'carol', 'friends', 'alice'), { friendUid: 'alice', addedAt: iso(), requestId: 'r1' });
        await assertFails(batch.commit());
      });

      it('old-app accept, one write at a time (transitional only)', async () => {
        await pending('carol', 'eve', 'r1');
        const db = as('eve');
        await assertSucceeds(updateDoc(doc(db, 'friendRequests', 'r1'), { status: 'accepted' }));
        await check(!strict, setDoc(doc(db, 'users', 'carol', 'friends', 'eve'), { friendUid: 'eve', addedAt: iso() }));
        await check(!strict, setDoc(doc(db, 'users', 'eve', 'friends', 'carol'), { friendUid: 'carol', addedAt: iso() }));
      });
      // Transitional residue: rules can't see a request id here, so the validateFriendDoc
      // Cloud Function removes the doc after the fact (see triggers.test.js).
      it('adding myself to a stranger\'s list (allowed only transitionally, cleaned up server-side)', () =>
        check(!strict, setDoc(doc(as('carol'), 'users', 'alice', 'friends', 'carol'), { friendUid: 'carol', addedAt: iso() })));
      it('adding a stranger to my own list (allowed only transitionally, cleaned up server-side)', () =>
        check(!strict, setDoc(doc(as('carol'), 'users', 'carol', 'friends', 'alice'), { friendUid: 'alice', addedAt: iso() })));
      it('friend doc with a mismatched friendUid is denied', () =>
        assertFails(setDoc(doc(as('carol'), 'users', 'alice', 'friends', 'carol'), { friendUid: 'eve', addedAt: iso() })));
      it('friend doc with extra fields is denied', () =>
        assertFails(setDoc(doc(as('carol'), 'users', 'carol', 'friends', 'alice'), { friendUid: 'alice', addedAt: iso(), role: 'x' })));
      it('writing a doc for two other people is denied', () =>
        assertFails(setDoc(doc(as('carol'), 'users', 'alice', 'friends', 'eve'), { friendUid: 'eve', addedAt: iso() })));

      it('either side removes the friendship', async () => {
        await assertSucceeds(deleteDoc(doc(as('alice'), 'users', 'alice', 'friends', 'bob')));
        await assertSucceeds(deleteDoc(doc(as('alice'), 'users', 'bob', 'friends', 'alice')));
      });
      it('outsider removing a friendship is denied', () =>
        assertFails(deleteDoc(doc(as('carol'), 'users', 'alice', 'friends', 'bob'))));
    });

    // ---------------------------------------------------------------- reactions, comments, replies

    describe('reactions', () => {
      const reaction = (db, owner, reactor) => doc(db, 'users', owner, 'activityReactions', '1', 'reactions', reactor);
      const body = (uid, extra = {}) => ({ reactorUid: uid, reactorName: 'Bob', reactorPhoto: null, reactionType: '🔥', createdAt: iso(), ...extra });

      it('friend reacts', () => assertSucceeds(setDoc(reaction(as('bob'), 'alice', 'bob'), body('bob'))));
      it('owner reacts to own activity', () => assertSucceeds(setDoc(reaction(as('alice'), 'alice', 'alice'), body('alice'))));
      it('friend changes reaction', async () => {
        await setDoc(reaction(as('bob'), 'alice', 'bob'), body('bob'));
        await assertSucceeds(setDoc(reaction(as('bob'), 'alice', 'bob'), body('bob', { reactionType: '💪' })));
      });
      it('stranger reacting is denied', () => assertFails(setDoc(reaction(as('carol'), 'alice', 'carol'), body('carol'))));
      it('reaction under another uid is denied', () => assertFails(setDoc(reaction(as('bob'), 'alice', 'dave'), body('dave'))));
      it('forged reactorUid is denied', () => assertFails(setDoc(reaction(as('bob'), 'alice', 'bob'), body('dave'))));
      it('oversized name is denied', () =>
        assertFails(setDoc(reaction(as('bob'), 'alice', 'bob'), body('bob', { reactorName: 'x'.repeat(101) }))));
      it('friend reads reactions', () => assertSucceeds(getDocs(collection(as('dave'), 'users', 'alice', 'activityReactions', '1', 'reactions'))));
      it('stranger reads are denied', () => assertFails(getDocs(collection(as('carol'), 'users', 'alice', 'activityReactions', '1', 'reactions'))));
      it('owner clears others\' reactions (activity deleted)', async () => {
        await setDoc(reaction(as('bob'), 'alice', 'bob'), body('bob'));
        await assertSucceeds(deleteDoc(reaction(as('alice'), 'alice', 'bob')));
      });
      it('third party removing a reaction is denied', async () => {
        await setDoc(reaction(as('bob'), 'alice', 'bob'), body('bob'));
        await assertFails(deleteDoc(reaction(as('dave'), 'alice', 'bob')));
      });
    });

    describe('comments and replies', () => {
      const comment = (db, owner, id) => doc(db, 'users', owner, 'activityComments', '1', 'comments', id);
      const reply = (db, owner, cid, id) => doc(db, 'users', owner, 'activityComments', '1', 'comments', cid, 'replies', id);
      const cbody = (uid, extra = {}) => ({ id: `${uid}_1`, commenterUid: uid, commenterName: 'Name', commenterPhoto: null, text: 'nice', createdAt: iso(), ...extra });
      const rbody = (uid, extra = {}) => ({ id: `${uid}_2`, replierUid: uid, replierName: 'Name', replierPhoto: null, text: 'thanks', createdAt: iso(), ...extra });
      const seedComment = () => seed((db) => setDoc(comment(db, 'alice', 'bob_1'), cbody('bob')));

      it('friend comments', () => assertSucceeds(setDoc(comment(as('bob'), 'alice', 'bob_1'), cbody('bob'))));
      it('web comment with serverTimestamp', () =>
        assertSucceeds(setDoc(comment(as('bob'), 'alice', 'auto'), cbody('bob', { id: 'auto', createdAt: serverTimestamp() }))));
      it('comment posing as someone else is denied', () =>
        assertFails(setDoc(comment(as('bob'), 'alice', 'x'), cbody('dave'))));
      it('stranger commenting is denied', () => assertFails(setDoc(comment(as('carol'), 'alice', 'x'), cbody('carol'))));
      it('oversized comment is denied', () =>
        assertFails(setDoc(comment(as('bob'), 'alice', 'x'), cbody('bob', { text: 'x'.repeat(2001) }))));
      it('editing a comment is denied', async () => {
        await seedComment();
        await assertFails(updateDoc(comment(as('bob'), 'alice', 'bob_1'), { text: 'edited' }));
      });
      it('friend reads comments', () => assertSucceeds(getDocs(collection(as('dave'), 'users', 'alice', 'activityComments', '1', 'comments'))));
      it('stranger reads are denied', () => assertFails(getDocs(collection(as('carol'), 'users', 'alice', 'activityComments', '1', 'comments'))));
      it('commenter and owner delete; another friend cannot', async () => {
        await seedComment();
        await assertFails(deleteDoc(comment(as('dave'), 'alice', 'bob_1')));
        await assertSucceeds(deleteDoc(comment(as('bob'), 'alice', 'bob_1')));
        await seedComment();
        await assertSucceeds(deleteDoc(comment(as('alice'), 'alice', 'bob_1')));
      });

      it('friend replies', async () => {
        await seedComment();
        await assertSucceeds(setDoc(reply(as('dave'), 'alice', 'bob_1', 'dave_2'), rbody('dave')));
      });
      it('reply posing as someone else is denied', async () => {
        await seedComment();
        await assertFails(setDoc(reply(as('dave'), 'alice', 'bob_1', 'x'), rbody('bob')));
      });
      it('stranger replying is denied', async () => {
        await seedComment();
        await assertFails(setDoc(reply(as('carol'), 'alice', 'bob_1', 'x'), rbody('carol')));
      });
      it('replier and owner delete a reply', async () => {
        await seedComment();
        await seed((db) => setDoc(reply(db, 'alice', 'bob_1', 'dave_2'), rbody('dave')));
        await assertFails(deleteDoc(reply(as('bob'), 'alice', 'bob_1', 'dave_2')));
        await assertSucceeds(deleteDoc(reply(as('dave'), 'alice', 'bob_1', 'dave_2')));
        await seed((db) => setDoc(reply(db, 'alice', 'bob_1', 'dave_2'), rbody('dave')));
        await assertSucceeds(deleteDoc(reply(as('alice'), 'alice', 'bob_1', 'dave_2')));
      });
    });

    // ---------------------------------------------------------------- challenges

    describe('challenges', () => {
      const create = (uid, c) => setDoc(doc(as(uid), 'challenges', c.id), c.doc);
      const seedChallenge = (c) => seed((db) => setDoc(doc(db, 'challenges', c.id), c.doc));
      // alice has more friends for the group cases
      const addFriends = (owner, others) => seed(async (db) => {
        for (const o of others) {
          await setDoc(doc(db, 'users', owner, 'friends', o), { friendUid: o, addedAt: iso() });
          await setDoc(doc(db, 'users', o, 'friends', owner), { friendUid: owner, addedAt: iso() });
        }
      });

      it('1v1 to a friend (native shape)', () => assertSucceeds(create('alice', challengeDoc('alice', ['bob']))));
      it('1v1 to a friend (web shape)', () => {
        const c = challengeDoc('alice', ['bob'], { createdAt: serverTimestamp() });
        return assertSucceeds(create('alice', c));
      });
      it('group to friends', () => assertSucceeds(create('alice', challengeDoc('alice', ['bob', 'dave']))));
      it('group of 10 friends', async () => {
        const many = Array.from({ length: 10 }, (_, i) => `f${i}`);
        await addFriends('alice', many);
        await assertSucceeds(create('alice', challengeDoc('alice', many)));
      });
      it('group of 11 is denied', async () => {
        const many = Array.from({ length: 11 }, (_, i) => `f${i}`);
        await addFriends('alice', many);
        await assertFails(create('alice', challengeDoc('alice', many)));
      });
      it('naming a non-friend is denied', () => assertFails(create('alice', challengeDoc('alice', ['carol']))));
      it('a group with one non-friend is denied', () => assertFails(create('alice', challengeDoc('alice', ['bob', 'carol']))));
      it('forged challenger is denied', () => assertFails(create('bob', challengeDoc('alice', ['bob']))));
      for (const status of ['accepted', 'completed', 'expired']) {
        it(`a participant already ${status} is denied`, () =>
          assertFails(create('alice', challengeDoc('alice', ['bob'], { participants: { bob: { status } } }))));
      }
      it('participants map naming someone outside participantUids is denied', () =>
        assertFails(create('alice', challengeDoc('alice', ['bob'], { participants: { bob: { status: 'pending' }, carol: { status: 'pending' } } }))));
      it('participant missing from the map is denied', () =>
        assertFails(create('alice', challengeDoc('alice', ['bob', 'dave'], { participants: { bob: { status: 'pending' } } }))));
      it('duplicate participant uids are denied', () =>
        assertFails(create('alice', challengeDoc('alice', ['bob'], { participantUids: ['alice', 'bob', 'bob'] }))));
      it('1v1 pointing friendUid elsewhere is denied', () =>
        assertFails(create('alice', challengeDoc('alice', ['bob'], { friendUid: 'dave' }))));
      it('a non-pending challenge is denied', () =>
        assertFails(create('alice', challengeDoc('alice', ['bob'], { status: 'active' }))));
      it('pre-set winners are denied', () =>
        assertFails(create('alice', challengeDoc('alice', ['bob'], { winnerUids: ['alice'] }))));
      it('title over 60 characters is denied', () =>
        assertFails(create('alice', challengeDoc('alice', ['bob'], { title: 'x'.repeat(61) }))));
      it('challenger name over 100 characters is denied', () =>
        assertFails(create('alice', challengeDoc('alice', ['bob'], { challengerName: 'x'.repeat(101) }))));
      it('unsupported window is denied', () =>
        assertFails(create('alice', challengeDoc('alice', ['bob'], { windowHours: 1000 }))));
      // The app sets expiresAt = respondByAt from one Date; the rules require them equal.
      const deadline = (ms) => { const at = iso(ms); return { respondByAt: at, expiresAt: at }; };
      it('deadline a week out is denied', () =>
        assertFails(create('alice', challengeDoc('alice', ['bob'], deadline(7 * 24 * HOUR)))));
      it('deadline already passed is denied', () =>
        assertFails(create('alice', challengeDoc('alice', ['bob'], { expiresAt: iso(-5 * HOUR) }))));
      it('phone clock an hour fast is fine', () =>
        assertSucceeds(create('alice', challengeDoc('alice', ['bob'], deadline(9 * HOUR)))));
      it('phone clock an hour slow is fine', () =>
        assertSucceeds(create('alice', challengeDoc('alice', ['bob'], deadline(7 * HOUR)))));
      it('expiresAt differing from respondByAt is denied', () =>
        assertFails(create('alice', challengeDoc('alice', ['bob'], { respondByAt: iso(8 * HOUR), expiresAt: iso(30 * HOUR) }))));

      it('participant reads', async () => {
        const c = challengeDoc('alice', ['bob']);
        await seedChallenge(c);
        await assertSucceeds(getDoc(doc(as('bob'), 'challenges', c.id)));
        await assertFails(getDoc(doc(as('carol'), 'challenges', c.id)));
        await assertSucceeds(getDocs(query(collection(as('bob'), 'challenges'), where('participantUids', 'array-contains', 'bob'))));
      });

      it('a friend of a participant reads an open challenge: denied', async () => {
        const c = challengeDoc('alice', ['dave']);
        await seedChallenge(c);
        await assertFails(getDoc(doc(as('bob'), 'challenges', c.id)));
      });

      describe('completed challenges', () => {
        // alice challenged dave, dave won. bob is alice's friend; carol knows nobody.
        const done = challengeDoc('alice', ['dave'], { status: 'completed', winnerUids: ['dave'] });
        beforeEach(() => seedChallenge(done));

        it('participants read it', () => assertSucceeds(getDoc(doc(as('dave'), 'challenges', done.id))));
        it('a friend of a participant reads it', () => assertSucceeds(getDoc(doc(as('bob'), 'challenges', done.id))));
        it('a stranger reading it is denied', () => assertFails(getDoc(doc(as('carol'), 'challenges', done.id))));
        it('a stranger listing them by winner is denied', () =>
          assertFails(getDocs(query(collection(as('carol'), 'challenges'),
            where('status', '==', 'completed'), where('winnerUids', 'array-contains', 'dave')))));
        // App versions up to 1.8.4 list friends' wins this way; the feed now asks the
        // completedChallengesForFeed function, since a query can't check friendship.
        it('even a friend listing them by winner is denied', () =>
          assertFails(getDocs(query(collection(as('alice'), 'challenges'),
            where('status', '==', 'completed'), where('winnerUids', 'array-contains', 'dave')))));
        it('a friend of a later participant reads a group win', async () => {
          // eve is friends with participant 4 only.
          const group = challengeDoc('alice', ['bob', 'dave', 'carol'], { status: 'completed', winnerUids: ['carol'] });
          await seed(async (db) => {
            await setDoc(doc(db, 'challenges', group.id), group.doc);
            await setDoc(doc(db, 'users', 'carol', 'friends', 'eve'), { friendUid: 'eve', addedAt: iso() });
          });
          await assertSucceeds(getDoc(doc(as('eve'), 'challenges', group.id)));
        });
      });

      // acceptChallenge() in challengeService.js
      const acceptUpdate = (c, uid, first = true) => {
        const now = Date.now();
        const u = { [`participants.${uid}.status`]: 'accepted', [`participants.${uid}.acceptedAt`]: iso(), status: 'active' };
        if (first) { u.expiresAt = new Date(now + c.doc.windowHours * HOUR).toISOString(); u.firstAcceptedAt = iso(); }
        if (c.doc.type !== 'group' && c.doc.friendUid === uid) { u.friendStatus = 'accepted'; u.acceptedAt = iso(); }
        return u;
      };

      it('recipient accepts a 1v1', async () => {
        const c = challengeDoc('alice', ['bob']);
        await seedChallenge(c);
        await assertSucceeds(updateDoc(doc(as('bob'), 'challenges', c.id), acceptUpdate(c, 'bob')));
      });
      it('second group accepter keeps the deadline', async () => {
        const c = challengeDoc('alice', ['bob', 'dave']);
        await seedChallenge(c);
        await assertSucceeds(updateDoc(doc(as('bob'), 'challenges', c.id), acceptUpdate(c, 'bob')));
        await assertSucceeds(updateDoc(doc(as('dave'), 'challenges', c.id), acceptUpdate(c, 'dave', false)));
      });
      it('accepting with a far-off deadline is denied', async () => {
        const c = challengeDoc('alice', ['bob']);
        await seedChallenge(c);
        await assertFails(updateDoc(doc(as('bob'), 'challenges', c.id), { ...acceptUpdate(c, 'bob'), expiresAt: iso(30 * 24 * HOUR) }));
      });
      it('marking myself completed is denied', async () => {
        const c = challengeDoc('alice', ['bob']);
        await seedChallenge(c);
        await assertFails(updateDoc(doc(as('bob'), 'challenges', c.id), { 'participants.bob.status': 'completed' }));
        await assertFails(updateDoc(doc(as('bob'), 'challenges', c.id), { ...acceptUpdate(c, 'bob'), 'participants.bob.status': 'completed' }));
      });
      it('completing after accepting is denied', async () => {
        const c = challengeDoc('alice', ['bob']);
        await seedChallenge(c);
        await updateDoc(doc(as('bob'), 'challenges', c.id), acceptUpdate(c, 'bob'));
        await assertFails(updateDoc(doc(as('bob'), 'challenges', c.id), {
          'participants.bob.status': 'completed', status: 'completed', winnerUids: ['bob'], friendStatus: 'completed',
        }));
      });
      it('accepting for someone else is denied', async () => {
        const c = challengeDoc('alice', ['bob', 'dave']);
        await seedChallenge(c);
        await assertFails(updateDoc(doc(as('bob'), 'challenges', c.id), acceptUpdate(c, 'dave')));
      });
      it('challenger accepting on the recipient\'s behalf is denied', async () => {
        const c = challengeDoc('alice', ['bob']);
        await seedChallenge(c);
        await assertFails(updateDoc(doc(as('alice'), 'challenges', c.id), acceptUpdate(c, 'bob')));
      });
      it('accepting while changing the match rule is denied', async () => {
        const c = challengeDoc('alice', ['bob']);
        await seedChallenge(c);
        await assertFails(updateDoc(doc(as('bob'), 'challenges', c.id), { ...acceptUpdate(c, 'bob'), 'matchRule.distanceMin': 0.1 }));
      });

      it('recipient declines a 1v1', async () => {
        const c = challengeDoc('alice', ['bob']);
        await seedChallenge(c);
        await assertSucceeds(updateDoc(doc(as('bob'), 'challenges', c.id), {
          'participants.bob.status': 'declined', 'participants.bob.resolvedAt': iso(),
          status: 'declined', friendStatus: 'declined', resolvedAt: iso(),
        }));
      });
      it('recipient declines a group', async () => {
        const c = challengeDoc('alice', ['bob', 'dave']);
        await seedChallenge(c);
        await assertSucceeds(updateDoc(doc(as('dave'), 'challenges', c.id), {
          'participants.dave.status': 'declined', 'participants.dave.resolvedAt': iso(),
        }));
      });
      it('a group decline ending the whole challenge is denied', async () => {
        const c = challengeDoc('alice', ['bob', 'dave']);
        await seedChallenge(c);
        await assertFails(updateDoc(doc(as('dave'), 'challenges', c.id), {
          'participants.dave.status': 'declined', status: 'declined',
        }));
      });

      it('challenger cancels while pending', async () => {
        const c = challengeDoc('alice', ['bob']);
        await seedChallenge(c);
        await assertSucceeds(updateDoc(doc(as('alice'), 'challenges', c.id), { status: 'cancelled', resolvedAt: iso() }));
      });
      it('challenger cancelling an active challenge outright is denied', async () => {
        const c = challengeDoc('alice', ['bob'], { status: 'active', participants: { bob: { status: 'accepted' } }, friendStatus: 'accepted' });
        await seedChallenge(c);
        await assertFails(updateDoc(doc(as('alice'), 'challenges', c.id), { status: 'cancelled', resolvedAt: iso() }));
      });
      it('recipient cancelling a pending challenge is denied', async () => {
        const c = challengeDoc('alice', ['bob']);
        await seedChallenge(c);
        await assertFails(updateDoc(doc(as('bob'), 'challenges', c.id), { status: 'cancelled', resolvedAt: iso() }));
      });

      describe('cancel requests', () => {
        const active = () => challengeDoc('alice', ['bob'], {
          status: 'active', participants: { bob: { status: 'accepted', acceptedAt: iso() } }, friendStatus: 'accepted',
        });
        const askBody = () => ({ cancelRequest: { requestedBy: 'alice', requestedAt: iso(), response: null, respondedAt: null } });

        it('challenger asks; recipient agrees', async () => {
          const c = active();
          await seedChallenge(c);
          await assertSucceeds(updateDoc(doc(as('alice'), 'challenges', c.id), askBody()));
          await assertSucceeds(updateDoc(doc(as('bob'), 'challenges', c.id), {
            'cancelRequest.response': 'accepted', 'cancelRequest.respondedAt': iso(), status: 'cancelled', resolvedAt: iso(),
          }));
        });
        it('recipient declines; challenge continues', async () => {
          const c = active();
          await seedChallenge(c);
          await updateDoc(doc(as('alice'), 'challenges', c.id), askBody());
          await assertSucceeds(updateDoc(doc(as('bob'), 'challenges', c.id), {
            'cancelRequest.response': 'declined', 'cancelRequest.respondedAt': iso(),
          }));
        });
        it('challenger answering their own request is denied', async () => {
          const c = active();
          await seedChallenge(c);
          await updateDoc(doc(as('alice'), 'challenges', c.id), askBody());
          await assertFails(updateDoc(doc(as('alice'), 'challenges', c.id), {
            'cancelRequest.response': 'accepted', status: 'cancelled', resolvedAt: iso(),
          }));
        });
        it('declining while cancelling anyway is denied', async () => {
          const c = active();
          await seedChallenge(c);
          await updateDoc(doc(as('alice'), 'challenges', c.id), askBody());
          await assertFails(updateDoc(doc(as('bob'), 'challenges', c.id), {
            'cancelRequest.response': 'declined', status: 'cancelled',
          }));
        });
        it('recipient opening a cancel request is denied', async () => {
          const c = active();
          await seedChallenge(c);
          await assertFails(updateDoc(doc(as('bob'), 'challenges', c.id), {
            cancelRequest: { requestedBy: 'bob', requestedAt: iso(), response: null, respondedAt: null },
          }));
        });
      });

      it('outsider updating a challenge is denied', async () => {
        const c = challengeDoc('alice', ['bob']);
        await seedChallenge(c);
        await assertFails(updateDoc(doc(as('carol'), 'challenges', c.id), { status: 'cancelled' }));
      });
      it('deleting a challenge is denied', async () => {
        const c = challengeDoc('alice', ['bob']);
        await seedChallenge(c);
        await assertFails(deleteDoc(doc(as('alice'), 'challenges', c.id)));
      });
    });
  });
}

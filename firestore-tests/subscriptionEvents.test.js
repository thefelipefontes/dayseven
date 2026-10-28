// Unit tests for the RevenueCat event mapping (functions/subscriptionEvents.js). No emulator.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveUid, isStale, subscriptionFromEvent, transferUpdates } = require('../functions/subscriptionEvents');

const NOW = Date.UTC(2026, 9, 28, 12);
const DAY = 24 * 60 * 60 * 1000;
const ev = (type, extra = {}) => ({ type, app_user_id: 'uid1', event_timestamp_ms: NOW, ...extra });

describe('subscriptionFromEvent', () => {
  it('lifetime non-renewing purchase is active and never expires', () => {
    const s = subscriptionFromEvent(ev('NON_RENEWING_PURCHASE', { expiration_at_ms: null, period_type: 'NORMAL' }), NOW);
    assert.equal(s.entitlementActive, true);
    assert.equal(s.status, 'active');
    assert.equal(s.expiresAt, null);
    assert.equal(s.willRenew, false);
  });
  it('trial purchase', () => {
    const s = subscriptionFromEvent(ev('INITIAL_PURCHASE', { period_type: 'TRIAL', expiration_at_ms: NOW + 7 * DAY }), NOW);
    assert.equal(s.status, 'trial');
    assert.equal(s.trialEndsAt, new Date(NOW + 7 * DAY).toISOString());
    assert.equal(s.willRenew, true);
  });
  it('billing issue inside the grace period keeps access', () => {
    const s = subscriptionFromEvent(ev('BILLING_ISSUE', {
      period_type: 'NORMAL', expiration_at_ms: NOW - 1000, grace_period_expiration_at_ms: NOW + 6 * DAY,
    }), NOW);
    assert.equal(s.entitlementActive, true);
    assert.equal(s.billingIssue, true);
    assert.equal(s.expiresAt, new Date(NOW + 6 * DAY).toISOString());
  });
  it('billing issue with no grace period loses access', () => {
    const s = subscriptionFromEvent(ev('BILLING_ISSUE', { expiration_at_ms: NOW - 1000, grace_period_expiration_at_ms: null }), NOW);
    assert.equal(s.entitlementActive, false);
    assert.equal(s.status, 'expired');
  });
  it('cancellation keeps access until expiry', () => {
    const s = subscriptionFromEvent(ev('CANCELLATION', { expiration_at_ms: NOW + DAY }), NOW);
    assert.equal(s.entitlementActive, true);
    assert.equal(s.willRenew, false);
  });
  it('refund (cancellation dated now) loses access', () => {
    const s = subscriptionFromEvent(ev('CANCELLATION', { expiration_at_ms: NOW - 1, cancel_reason: 'CUSTOMER_SUPPORT' }), NOW);
    assert.equal(s.entitlementActive, false);
  });
  it('expiration', () => assert.equal(subscriptionFromEvent(ev('EXPIRATION', { expiration_at_ms: NOW - 1 }), NOW).entitlementActive, false));
  for (const type of ['TEST', 'EXPERIMENT_ENROLLMENT', 'SUBSCRIBER_ALIAS', 'PRICE_INCREASE_CONSENT_REQUIRED']) {
    it(`${type} changes nothing`, () => assert.equal(subscriptionFromEvent(ev(type), NOW), null));
  }
  it('an unknown type without an expiry changes nothing', () => assert.equal(subscriptionFromEvent(ev('SOMETHING_NEW'), NOW), null));
  it('records the event time for ordering', () =>
    assert.equal(subscriptionFromEvent(ev('RENEWAL', { expiration_at_ms: NOW + DAY }), NOW).lastEventAtMs, NOW));
});

describe('isStale', () => {
  it('older than the last applied event', () => assert.equal(isStale({ event_timestamp_ms: 1000 }, { lastEventAtMs: 2000 }), true));
  it('same timestamp (a retry) is applied again', () => assert.equal(isStale({ event_timestamp_ms: 2000 }, { lastEventAtMs: 2000 }), false));
  it('no history yet', () => assert.equal(isStale({ event_timestamp_ms: 1000 }, undefined), false));
});

describe('resolveUid', () => {
  it('skips anonymous ids', () =>
    assert.equal(resolveUid({ app_user_id: '$RCAnonymousID:abc', aliases: ['$RCAnonymousID:def', 'fb-uid'] }), 'fb-uid'));
  it('null when only anonymous', () => assert.equal(resolveUid({ app_user_id: '$RCAnonymousID:abc' }), null));
});

describe('transferUpdates', () => {
  it('receiver gains access, giver loses it, anonymous ids skipped', () => {
    const out = transferUpdates({
      type: 'TRANSFER', event_timestamp_ms: NOW,
      transferred_from: ['old-uid', '$RCAnonymousID:x'], transferred_to: ['new-uid'],
    }, { 'new-uid': { status: 'trial' } }, NOW);
    const byUid = Object.fromEntries(out.map((u) => [u.uid, u.subscription]));
    assert.deepEqual(Object.keys(byUid).sort(), ['new-uid', 'old-uid']);
    assert.equal(byUid['new-uid'].entitlementActive, true);
    assert.equal(byUid['new-uid'].status, 'trial');
    assert.equal(byUid['old-uid'].entitlementActive, false);
    assert.equal(byUid['old-uid'].status, 'expired');
  });
  it('an id on both sides keeps access', () => {
    const out = transferUpdates({ type: 'TRANSFER', transferred_from: ['a'], transferred_to: ['a'] }, {}, NOW);
    assert.equal(out.length, 1);
    assert.equal(out[0].subscription.entitlementActive, true);
  });
});

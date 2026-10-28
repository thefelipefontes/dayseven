/**
 * RevenueCat webhook event → the compact `subscription` object stored on users/{uid}.
 * Kept free of Firestore so it can be unit-tested (firestore-tests/subscriptionEvents.test.js).
 *
 * Event reference: https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
 */

// Events that say nothing about whether the user is entitled. Writing state for these used
// to mark the user expired (no expiration_at_ms → inactive).
const IGNORED_TYPES = new Set([
  'TEST', 'EXPERIMENT_ENROLLMENT', 'VIRTUAL_CURRENCY_TRANSACTION', 'SUBSCRIBER_ALIAS',
  'PRICE_INCREASE_CONSENT_REQUIRED', 'PRICE_INCREASE_CONSENT_APPROVED', 'INVOICE_ISSUANCE',
]);

// Purchases and renewals: entitled until expiry (or for good, when there is none).
const ACTIVE_TYPES = new Set([
  'INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'SUBSCRIPTION_EXTENDED',
  'TEMPORARY_ENTITLEMENT_GRANT', 'REFUND_REVERSED', 'NON_RENEWING_PURCHASE',
]);

const isRealUid = (id) => !!id && !String(id).startsWith('$RCAnonymousID:');

/** The Firebase UID an event is about: the first non-anonymous id RevenueCat sent. */
function resolveUid(event) {
  return [event.app_user_id, event.original_app_user_id, ...(event.aliases || [])].find(isRealUid) || null;
}

/**
 * True when `event` is older than the last event already applied to this user. RevenueCat
 * doesn't deliver in order, so an old RENEWAL can land after the EXPIRATION that ended it.
 * Retries reuse the same timestamp and are applied again (the result is the same).
 */
function isStale(event, prevSubscription) {
  const at = Number(event.event_timestamp_ms) || 0;
  const last = Number(prevSubscription?.lastEventAtMs) || 0;
  return at > 0 && last > 0 && at < last;
}

function meta(event, nowMs) {
  return {
    environment: event.environment || null, // 'PRODUCTION' | 'SANDBOX' — exclude SANDBOX from counts/targeting
    lastEventType: event.type,
    lastEventAtMs: Number(event.event_timestamp_ms) || nowMs,
    updatedAt: new Date(nowMs).toISOString(),
  };
}

/**
 * The `subscription` object for a non-TRANSFER event, or null when the event should not
 * change stored state.
 */
function subscriptionFromEvent(event, nowMs = Date.now()) {
  const type = event.type;
  if (!type || IGNORED_TYPES.has(type) || type === 'TRANSFER') return null;

  const periodType = event.period_type || null; // TRIAL | NORMAL | INTRO | PREPAID
  const expirationMs = Number(event.expiration_at_ms) || null;
  // During a billing grace period the store keeps the user entitled until the grace ends.
  const graceMs = Number(event.grace_period_expiration_at_ms) || null;

  let entitlementActive;
  let accessUntilMs = expirationMs;
  if (ACTIVE_TYPES.has(type)) {
    // Lifetime (non-renewing) purchases have no expiry at all.
    entitlementActive = !expirationMs || expirationMs > nowMs;
  } else if (type === 'EXPIRATION') {
    entitlementActive = false;
  } else if (type === 'BILLING_ISSUE') {
    accessUntilMs = Math.max(expirationMs || 0, graceMs || 0) || null;
    entitlementActive = !!accessUntilMs && accessUntilMs > nowMs;
  } else if (type === 'CANCELLATION' || type === 'SUBSCRIPTION_PAUSED') {
    // Auto-renew off (or a pause scheduled): still entitled until expiry. A refund arrives
    // as a CANCELLATION whose expiry is the refund time, so it reads as inactive.
    entitlementActive = expirationMs ? expirationMs > nowMs : true;
  } else if (expirationMs) {
    // An event type this code doesn't know: trust the expiry it carries.
    entitlementActive = expirationMs > nowMs;
  } else {
    return null;
  }

  const isTrial = periodType === 'TRIAL';
  const expiresAt = accessUntilMs ? new Date(accessUntilMs).toISOString() : null;
  const renews = !['CANCELLATION', 'SUBSCRIPTION_PAUSED', 'NON_RENEWING_PURCHASE', 'EXPIRATION'].includes(type);
  return {
    entitlementActive,
    status: !entitlementActive ? 'expired' : (isTrial ? 'trial' : 'active'),
    periodType,
    expiresAt,
    trialEndsAt: isTrial && entitlementActive ? expiresAt : null,
    willRenew: entitlementActive && renews,
    billingIssue: type === 'BILLING_ISSUE',
    ...meta(event, nowMs),
  };
}

/**
 * A TRANSFER moves the entitlement between app user ids (e.g. Restore Purchases on another
 * account). It carries no product or expiry, so the receiving side is marked entitled until
 * its next renewal or expiration event says otherwise, and the giving side loses access now.
 * Returns [{ uid, subscription }] for every non-anonymous id on either side.
 */
function transferUpdates(event, prevByUid = {}, nowMs = Date.now()) {
  const to = (event.transferred_to || []).filter(isRealUid);
  const from = (event.transferred_from || []).filter((id) => isRealUid(id) && !to.includes(id));
  const nowIso = new Date(nowMs).toISOString();
  return [
    ...to.map((uid) => ({
      uid,
      subscription: {
        entitlementActive: true,
        status: prevByUid[uid]?.status === 'trial' ? 'trial' : 'active',
        periodType: prevByUid[uid]?.periodType || null,
        expiresAt: null,
        trialEndsAt: null,
        willRenew: null,
        billingIssue: false,
        ...meta(event, nowMs),
      },
    })),
    ...from.map((uid) => ({
      uid,
      subscription: {
        entitlementActive: false,
        status: 'expired',
        periodType: prevByUid[uid]?.periodType || null,
        expiresAt: nowIso, // starts the win-back clock at the transfer
        trialEndsAt: null,
        willRenew: false,
        billingIssue: false,
        ...meta(event, nowMs),
      },
    })),
  ];
}

module.exports = { resolveUid, isStale, subscriptionFromEvent, transferUpdates };

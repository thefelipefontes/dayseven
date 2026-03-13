/**
 * RevenueCat Subscription Service
 *
 * Handles all subscription/purchase logic via RevenueCat SDK.
 * Only active on native (iOS/Android) — all functions are no-ops on web.
 *
 * Entitlement: "dayseven Pro"
 * Products: monthly, yearly, lifetime
 */

import { Capacitor } from '@capacitor/core';

const isNative = Capacitor.isNativePlatform();

const REVENUECAT_API_KEY = 'appl_UATysAceRzTnMyGAvenoKKlXXov';
const ENTITLEMENT_ID = 'dayseven Pro';

// Diagnostic mode — set to true to show alerts at failure points
const RC_DEBUG = false;

const debugLog = (message, data) => {
  console.log(`[RC-Debug] ${message}`, data || '');
  if (RC_DEBUG && isNative) {
    // Use a non-blocking approach — queue alerts so they don't stack
    setTimeout(() => {
      const detail = data ? `\n\n${typeof data === 'object' ? JSON.stringify(data, null, 2) : data}` : '';
      window.alert?.(`[RC] ${message}${detail}`);
    }, 100);
  }
};

// Lazy-loaded SDK references (avoids import errors on web)
let Purchases = null;
let RevenueCatUI = null;
let LOG_LEVEL = null;
let PAYWALL_RESULT = null;
let PURCHASES_ERROR_CODE = null;

/**
 * Lazy-load the RevenueCat SDK modules
 * Uses dynamic import() so web builds don't crash on missing native plugins
 */
const loadSDK = async () => {
  if (!isNative) return false;
  if (Purchases) return true;

  try {
    const purchasesModule = await import('@revenuecat/purchases-capacitor');
    Purchases = purchasesModule.Purchases;
    LOG_LEVEL = purchasesModule.LOG_LEVEL;
    PAYWALL_RESULT = purchasesModule.PAYWALL_RESULT;
    PURCHASES_ERROR_CODE = purchasesModule.PURCHASES_ERROR_CODE;

    const uiModule = await import('@revenuecat/purchases-capacitor-ui');
    RevenueCatUI = uiModule.RevenueCatUI;

    return true;
  } catch (error) {
    debugLog('SDK LOAD FAILED', error.message);
    return false;
  }
};

/**
 * Initialize RevenueCat with the user's Firebase UID.
 * Should be called once after Firebase auth resolves.
 *
 * @param {string} userId - Firebase UID
 * @returns {Promise<boolean>} true if initialized successfully
 */
export const initializeRevenueCat = async (userId) => {
  if (!isNative) return false;

  try {
    const loaded = await loadSDK();
    if (!loaded) {
      debugLog('INIT FAILED: SDK not loaded');
      return false;
    }

    await Purchases.setLogLevel({ level: LOG_LEVEL.INFO });

    if (Capacitor.getPlatform() === 'ios') {
      await Purchases.configure({
        apiKey: REVENUECAT_API_KEY,
        appUserID: userId,
      });
    } else if (Capacitor.getPlatform() === 'android') {
      // Android API key would go here when ready
      await Purchases.configure({
        apiKey: REVENUECAT_API_KEY,
        appUserID: userId,
      });
    }

    console.log('[SubscriptionService] RevenueCat initialized for user:', userId);
    return true;
  } catch (error) {
    debugLog('INIT ERROR', error.message);
    return false;
  }
};

/**
 * Check if the user has the "dayseven Pro" entitlement.
 *
 * @returns {Promise<boolean>}
 */
export const checkProStatus = async () => {
  if (!isNative || !Purchases) return false;

  try {
    const { customerInfo } = await Purchases.getCustomerInfo();
    return !!customerInfo?.entitlements?.active?.[ENTITLEMENT_ID];
  } catch (error) {
    console.error('[SubscriptionService] checkProStatus error:', error);
    return false;
  }
};

/**
 * Get the full customer info object.
 *
 * @returns {Promise<Object|null>}
 */
export const getCustomerInfo = async () => {
  if (!isNative || !Purchases) return null;

  try {
    const { customerInfo } = await Purchases.getCustomerInfo();
    return customerInfo;
  } catch (error) {
    console.error('[SubscriptionService] getCustomerInfo error:', error);
    return null;
  }
};

/**
 * Add a listener for customer info updates.
 * Called whenever subscription status changes (purchase, renewal, expiry, etc.)
 *
 * @param {Function} callback - Called with { isPro: boolean, customerInfo: Object }
 */
export const addCustomerInfoListener = async (callback) => {
  if (!isNative || !Purchases) return;

  try {
    await Purchases.addCustomerInfoUpdateListener((customerInfo) => {
      const isPro = !!customerInfo?.entitlements?.active?.[ENTITLEMENT_ID];
      callback({ isPro, customerInfo });
    });
  } catch (error) {
    console.error('[SubscriptionService] addCustomerInfoListener error:', error);
  }
};

/**
 * Present the RevenueCat paywall UI.
 * Always shows the paywall regardless of current entitlement status.
 *
 * @param {Object} [options] - Optional configuration
 * @param {string} [options.offeringIdentifier] - RevenueCat offering ID to display (e.g. "Welcome Offer")
 * @returns {Promise<{purchased: boolean, result: string|null}>}
 */
export const presentPaywall = async (options = {}) => {
  if (!isNative) {
    debugLog('PAYWALL SKIP: not native platform');
    return { purchased: false, result: null };
  }
  if (!RevenueCatUI) {
    debugLog('PAYWALL SKIP: RevenueCatUI is null (SDK failed to load)');
    return { purchased: false, result: null };
  }

  try {
    // Check if offerings are available before presenting (avoids Error 23)
    const offerings = await Purchases.getOfferings();
    if (!offerings?.current) {
      const offeringKeys = offerings?.all ? Object.keys(offerings.all) : [];
      debugLog('PAYWALL SKIP: No current offering', {
        hasOfferings: !!offerings,
        allKeys: offeringKeys,
        current: offerings?.current || null
      });
      return { purchased: false, result: null };
    }

    const paywallOptions = {};
    if (options.offeringIdentifier) {
      const offering = offerings?.all?.[options.offeringIdentifier];
      if (offering) {
        paywallOptions.offering = offering;
      } else {
        debugLog('PAYWALL WARNING: Offering not found', {
          requested: options.offeringIdentifier,
          available: Object.keys(offerings.all || {})
        });
      }
    }

    const { result } = await RevenueCatUI.presentPaywall(paywallOptions);

    switch (result) {
      case PAYWALL_RESULT.PURCHASED:
      case PAYWALL_RESULT.RESTORED:
        console.log('[SubscriptionService] Paywall result: purchase/restore successful');
        return { purchased: true, result };
      case PAYWALL_RESULT.CANCELLED:
        console.log('[SubscriptionService] Paywall dismissed by user');
        return { purchased: false, result };
      case PAYWALL_RESULT.NOT_PRESENTED:
        debugLog('PAYWALL NOT_PRESENTED: SDK refused to show paywall');
        return { purchased: false, result };
      case PAYWALL_RESULT.ERROR:
        debugLog('PAYWALL ERROR: SDK returned error result');
        return { purchased: false, result };
      default:
        debugLog('PAYWALL UNKNOWN RESULT', result);
        return { purchased: false, result };
    }
  } catch (error) {
    debugLog('PAYWALL EXCEPTION', error.message);
    return { purchased: false, result: null };
  }
};

/**
 * Present paywall only if user does NOT have the "dayseven Pro" entitlement.
 * Useful for gating features — shows paywall automatically if needed.
 *
 * @returns {Promise<string|null>} PAYWALL_RESULT value or null
 */
export const presentPaywallIfNeeded = async () => {
  if (!isNative || !RevenueCatUI) return null;

  try {
    const { result } = await RevenueCatUI.presentPaywallIfNeeded({
      requiredEntitlementIdentifier: ENTITLEMENT_ID,
    });
    return result;
  } catch (error) {
    console.error('[SubscriptionService] presentPaywallIfNeeded error:', error);
    return null;
  }
};

/**
 * Present the RevenueCat Customer Center UI.
 * Allows pro users to manage subscriptions, request refunds, etc.
 */
export const presentCustomerCenter = async () => {
  if (!isNative || !RevenueCatUI) return;

  try {
    await RevenueCatUI.presentCustomerCenter();
  } catch (error) {
    console.error('[SubscriptionService] presentCustomerCenter error:', error);
  }
};

/**
 * Restore previous purchases.
 * Should only be triggered by explicit user action (e.g., "Restore Purchases" button).
 *
 * @returns {Promise<{isPro: boolean, customerInfo: Object|null}>}
 */
export const restorePurchases = async () => {
  if (!isNative || !Purchases) return { isPro: false, customerInfo: null };

  try {
    const { customerInfo } = await Purchases.restorePurchases();
    const isPro = !!customerInfo?.entitlements?.active?.[ENTITLEMENT_ID];
    console.log('[SubscriptionService] Purchases restored, isPro:', isPro);
    return { isPro, customerInfo };
  } catch (error) {
    console.error('[SubscriptionService] restorePurchases error:', error);
    return { isPro: false, customerInfo: null };
  }
};

/**
 * Fetch available offerings (products configured in RevenueCat dashboard).
 *
 * @returns {Promise<Object|null>} Offerings object or null
 */
export const getOfferings = async () => {
  if (!isNative || !Purchases) return null;

  try {
    const offerings = await Purchases.getOfferings();
    return offerings;
  } catch (error) {
    console.error('[SubscriptionService] getOfferings error:', error);
    return null;
  }
};

/**
 * Log out of RevenueCat (resets to anonymous user).
 * Call this when the user signs out of the app.
 */
export const logoutRevenueCat = async () => {
  if (!isNative || !Purchases) return;

  try {
    await Purchases.logOut();
    console.log('[SubscriptionService] RevenueCat logged out');
  } catch (error) {
    // logOut throws if the user is already anonymous — safe to ignore
    console.error('[SubscriptionService] logoutRevenueCat error:', error);
  }
};

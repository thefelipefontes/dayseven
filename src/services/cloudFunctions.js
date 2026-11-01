// Calling an onCall Cloud Function from the app.
//
// On native the web Firebase Auth SDK has no user (auth lives in the
// @capacitor-firebase/authentication plugin), so httpsCallable would hang waiting for an ID
// token. There the token comes from the plugin and the call is a plain POST to the
// function's HTTPS endpoint in the callable protocol, as applyChallengeIntent does.
import { Capacitor } from '@capacitor/core';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { auth } from '../firebase';

/**
 * Call the function `name` with `data` and return what it returns. Throws an Error whose
 * `message` is the function's error message and `code` its error code
 * ('failed-precondition', 'unauthenticated', …). `freshToken` sends a just-minted ID token,
 * for a call right after the user signed in again.
 */
export async function callFunction(name, data = {}, { freshToken = false } = {}) {
  if (Capacitor.isNativePlatform()) {
    const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
    const { token } = await FirebaseAuthentication.getIdToken({ forceRefresh: freshToken });
    if (!token) throw Object.assign(new Error('no_auth_token'), { code: 'unauthenticated' });
    const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
    const res = await fetch(`https://us-central1-${projectId}.cloudfunctions.net/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || json?.error) {
      // Callable error shape: { error: { status: 'FAILED_PRECONDITION', message } }
      const status = json?.error?.status;
      throw Object.assign(new Error(json?.error?.message || `http_${res.status}`), {
        code: status ? status.toLowerCase().replace(/_/g, '-') : `http-${res.status}`,
      });
    }
    return json?.result;
  }

  if (freshToken && auth.currentUser) await auth.currentUser.getIdToken(true);
  try {
    const res = await httpsCallable(getFunctions(), name)(data);
    return res.data;
  } catch (err) {
    throw Object.assign(new Error(err.message), { code: String(err.code || '').replace(/^functions\//, '') });
  }
}

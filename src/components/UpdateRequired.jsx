import React from 'react';
import { APP_STORE_URL } from '../utils/appVersion';

// Full screen, in place of the app, when this build is older than config/minAppVersion.
const UpdateRequired = () => (
  <div
    className="fixed inset-0 flex flex-col items-center justify-center px-8 text-center"
    style={{ backgroundColor: '#000' }}
  >
    <h1 className="text-white text-2xl font-bold mb-2">Update DaySeven</h1>
    <p className="text-gray-400 text-sm leading-relaxed mb-8 max-w-xs">
      This version is out of date. Update to keep your workouts and streaks saving correctly.
    </p>
    <button
      onClick={() => { try { window.open(APP_STORE_URL, '_blank'); } catch {} }}
      className="w-full max-w-xs py-3.5 rounded-xl font-bold text-black active:opacity-80"
      style={{ backgroundColor: '#00FF94' }}
    >
      Open the App Store
    </button>
  </div>
);

export default UpdateRequired;

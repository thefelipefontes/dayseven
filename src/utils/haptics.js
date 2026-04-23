import { Haptics, ImpactStyle } from '@capacitor/haptics';

// Helper function for haptic feedback that works on iOS
export const triggerHaptic = async (style = ImpactStyle.Medium) => {
  try {
    await Haptics.impact({ style });
  } catch (e) {
    // Fallback to vibrate API for web/Android
    if (navigator.vibrate) navigator.vibrate(10);
  }
};

export { ImpactStyle };

// Convert a Date to YYYY-MM-DD string in local timezone (avoids UTC date shifting)
export const toLocalDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Get today's date in YYYY-MM-DD format (local timezone)
export const getTodayDate = () => toLocalDateStr(new Date());

// Get current year
export const getCurrentYear = () => new Date().getFullYear();

// Parse date string (YYYY-MM-DD) to Date object at noon local time
// This avoids timezone issues where "2026-01-24" would be interpreted as UTC midnight
export const parseLocalDate = (dateStr) => {
  if (!dateStr) return new Date();
  return new Date(dateStr + 'T12:00:00');
};

// Format date as "Today", "Yesterday", or "Mon, Jan 20"
export const formatFriendlyDate = (dateStr) => {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // Use local date parts instead of toISOString() which uses UTC
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const yesterdayStr = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;

  if (dateStr === todayStr) return 'Today';
  if (dateStr === yesterdayStr) return 'Yesterday';

  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

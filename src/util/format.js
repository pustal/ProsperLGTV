/**
 * Small formatting helpers for sizes, dates and counts.
 */

/**
 * Human-readable size ("3.2 MB").
 * @param {number} bytes
 */
export function formatBytes(bytes) {
  const b = bytes || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * How long ago a time was ("just now", "3 hours ago", "12 Oct").
 * @param {number} ms  time since epoch
 */
export function formatAgo(ms) {
  if (!ms) return 'never';
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`;
  const d = new Date(ms);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * "1 channel" / "1,234 channels".
 * @param {number} n
 * @param {string} [word]
 */
export function plural(n, word) {
  const w = word || 'channel';
  return `${(n || 0).toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
}

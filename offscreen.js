/**
 * Keeps the MV3 service worker reachable while the bridge is ON.
 * Page timers are not throttled as aggressively as extension service workers.
 */
const TICK_MS = 4000;

setInterval(() => {
    chrome.runtime.sendMessage({ action: 'bridge_tick' }).catch(() => {});
}, TICK_MS);

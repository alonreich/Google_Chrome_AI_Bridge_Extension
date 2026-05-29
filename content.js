/**
 * Deprecated: manifest must not load this file (v1.5.5+).
 * Eyes UI lives in eyes-page.js (no chrome.*). Background injects it via scripting API.
 * This stub only clears legacy timers if an old build left them running.
 */
(function () {
    if (window !== window.top) return;
    try {
        if (window.__geminiBridgeHeartbeatTimer != null) {
            clearInterval(window.__geminiBridgeHeartbeatTimer);
            window.__geminiBridgeHeartbeatTimer = null;
        }
    } catch (e) {}
    try {
        document.querySelectorAll('#gemini-bridge-eyes, #gemini-bridge-overlay').forEach((el) => {
            el.remove();
        });
    } catch (e) {}
})();

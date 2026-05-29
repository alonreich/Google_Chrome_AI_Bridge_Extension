/**
 * Bridge eye overlay — page context only (no chrome.* APIs).
 * Background updates via chrome.scripting.executeScript + __bridgeApplyEyes.
 */
(function () {
    if (window !== window.top) return;

    const EYES_ID = 'gemini-bridge-eyes';
    const OVERLAY_ID = 'gemini-bridge-overlay';
    const STYLE_ID = 'gemini-bridge-eye-style-v2';

    function cameraEyeSvg(mode) {
        const busy = mode === 'busy';
        const uid = 'b' + Math.random().toString(36).slice(2, 8);
        const irisStops = busy
            ? '<stop offset="0%" stop-color="#FF8A70"/>' +
              '<stop offset="45%" stop-color="#EA4335"/>' +
              '<stop offset="100%" stop-color="#8B1414"/>'
            : '<stop offset="0%" stop-color="#6EB6FF"/>' +
              '<stop offset="45%" stop-color="#1A73E8"/>' +
              '<stop offset="100%" stop-color="#0B3D91"/>';
        const irisStroke = busy ? '#6B1010' : '#0D3A7A';
        const glowBlur = busy ? '3' : '2';
        const glowColor = busy ? 'rgba(255,80,60,0.9)' : 'rgba(30,120,255,0.7)';

        return (
            '<svg class="bridge-camera-eye" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
            '<defs>' +
            '<radialGradient id="iris' +
            uid +
            '" cx="48%" cy="48%" rx="50%" ry="42%">' +
            irisStops +
            '</radialGradient>' +
            '<linearGradient id="lid' +
            uid +
            '" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="rgba(12,16,28,0.75)"/>' +
            '<stop offset="55%" stop-color="rgba(12,16,28,0)"/>' +
            '</linearGradient>' +
            '<filter id="glow' +
            uid +
            '"><feGaussianBlur stdDeviation="' +
            glowBlur +
            '" result="b"/>' +
            '<feFlood flood-color="' +
            glowColor +
            '" result="c"/>' +
            '<feComposite in="c" in2="b" operator="in" result="g"/>' +
            '<feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
            '</defs>' +
            '<ellipse cx="50" cy="50" rx="49" ry="36" fill="#081018"/>' +
            '<ellipse cx="50" cy="50" rx="48" ry="35" fill="#FFFFFF"/>' +
            '<ellipse cx="50" cy="50" rx="48" ry="35" fill="none" stroke="#E8EEF8" stroke-width="1.2"/>' +
            '<ellipse cx="50" cy="51" rx="26" ry="30" fill="url(#iris' +
            uid +
            ')" filter="url(#glow' +
            uid +
            ')"/>' +
            '<ellipse cx="50" cy="51" rx="26" ry="30" fill="none" stroke="' +
            irisStroke +
            '" stroke-width="0.8" opacity="0.55"/>' +
            '<ellipse cx="50" cy="52" rx="11" ry="14" fill="#030508"/>' +
            '<ellipse cx="44" cy="46" rx="7" ry="4.5" fill="#FFFFFF" opacity="0.95"/>' +
            '<ellipse cx="58" cy="56" rx="2.5" ry="1.8" fill="#FFFFFF" opacity="0.5"/>' +
            '<ellipse cx="50" cy="32" rx="48" ry="22" fill="url(#lid' +
            uid +
            ')"/>' +
            '<path d="M 14 58 Q 50 68 86 58" fill="none" stroke="rgba(30,40,60,0.35)" stroke-width="1.2"/>' +
            '</svg>'
        );
    }

    function ensureEyeStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .bridge-camera-eye { width: 100%; height: 100%; display: block; }
            #${EYES_ID} {
                position: fixed; bottom: 24px; right: 24px;
                width: 112px; height: 112px; z-index: 2147483647;
                pointer-events: none; transform-origin: center center;
            }
            #${EYES_ID}.bridge-eye-idle {
                filter: drop-shadow(0 0 14px rgba(26, 115, 232, 0.85))
                        drop-shadow(0 4px 16px rgba(0, 0, 0, 0.45));
            }
            #${EYES_ID}.bridge-eye-busy {
                filter: drop-shadow(0 0 18px rgba(234, 67, 53, 1))
                        drop-shadow(0 0 8px rgba(255, 120, 80, 0.9))
                        drop-shadow(0 4px 16px rgba(0, 0, 0, 0.45));
            }
            #${EYES_ID} .bridge-eye-pulse {
                width: 100%; height: 100%;
                transform-origin: center center;
                will-change: transform; backface-visibility: hidden;
            }
            #${EYES_ID}.bridge-eye-idle .bridge-eye-pulse {
                animation: bridge-eye-breathe 3s linear infinite;
            }
            #${EYES_ID}.bridge-eye-busy .bridge-eye-pulse {
                animation: bridge-eye-record 0.55s linear infinite;
            }
            @keyframes bridge-eye-breathe {
                0% { transform: scale3d(1, 1, 1); }
                12.5% { transform: scale3d(1.1, 1.1, 1); }
                25% { transform: scale3d(1.18, 1.18, 1); }
                37.5% { transform: scale3d(1.23, 1.23, 1); }
                50% { transform: scale3d(1.26, 1.26, 1); }
                62.5% { transform: scale3d(1.23, 1.23, 1); }
                75% { transform: scale3d(1.18, 1.18, 1); }
                87.5% { transform: scale3d(1.1, 1.1, 1); }
                100% { transform: scale3d(1, 1, 1); }
            }
            @keyframes bridge-eye-record {
                0% { transform: scale3d(1, 1, 1); }
                12.5% { transform: scale3d(1.14, 1.14, 1); }
                25% { transform: scale3d(1.24, 1.24, 1); }
                37.5% { transform: scale3d(1.3, 1.3, 1); }
                50% { transform: scale3d(1.34, 1.34, 1); }
                62.5% { transform: scale3d(1.3, 1.3, 1); }
                75% { transform: scale3d(1.24, 1.24, 1); }
                87.5% { transform: scale3d(1.14, 1.14, 1); }
                100% { transform: scale3d(1, 1, 1); }
            }
            #${OVERLAY_ID} .bridge-overlay-eye.bridge-eye-idle {
                filter: drop-shadow(0 0 24px rgba(26, 115, 232, 0.8));
            }
            #${OVERLAY_ID} .bridge-overlay-eye.bridge-eye-busy {
                filter: drop-shadow(0 0 32px rgba(234, 67, 53, 0.95));
            }
            #${OVERLAY_ID} .bridge-overlay-eye {
                width: min(72vmin, 72vh); height: min(72vmin, 72vh);
                animation: bridge-overlay-flash 3s ease-in-out forwards;
            }
            @keyframes bridge-overlay-flash {
                0% { opacity: 0; transform: scale(0.6); }
                20% { opacity: 1; transform: scale(1); }
                70% { opacity: 0.85; transform: scale(1.05); }
                100% { opacity: 0; transform: scale(1.15); }
            }
        `;
        document.head.appendChild(style);
    }

    function applyEyes(mode) {
        const eyeMode = mode === 'busy' ? 'busy' : 'idle';
        document.querySelectorAll('#' + EYES_ID).forEach((el) => el.remove());
        ensureEyeStyles();
        const eyes = document.createElement('div');
        eyes.id = EYES_ID;
        eyes.className = 'bridge-eye-' + eyeMode;
        const pulse = document.createElement('div');
        pulse.className = 'bridge-eye-pulse';
        pulse.innerHTML = cameraEyeSvg(eyeMode);
        eyes.appendChild(pulse);
        document.body.appendChild(eyes);
    }

    function removeEyes() {
        document.querySelectorAll('#' + EYES_ID).forEach((el) => el.remove());
        document.querySelectorAll('#' + OVERLAY_ID).forEach((el) => el.remove());
    }

    function showOverlay(mode) {
        const eyeMode = mode === 'busy' ? 'busy' : 'idle';
        document.querySelectorAll('#' + OVERLAY_ID).forEach((el) => el.remove());
        ensureEyeStyles();
        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.style.cssText =
            'position:fixed;inset:0;z-index:2147483647;pointer-events:none;' +
            'display:flex;align-items:center;justify-content:center;background:transparent;';
        overlay.innerHTML =
            '<div class="bridge-overlay-eye bridge-eye-' +
            eyeMode +
            '">' +
            cameraEyeSvg(eyeMode) +
            '</div>';
        document.body.appendChild(overlay);
        setTimeout(() => overlay.remove(), 3500);
    }

    window.__bridgeApplyEyes = applyEyes;
    window.__bridgeRemoveEyes = removeEyes;
    window.__bridgeShowOverlay = showOverlay;
})();

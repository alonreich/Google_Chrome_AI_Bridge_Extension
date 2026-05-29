document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('toggleBridge');
    const statusText = document.getElementById('statusText');
    const urlDisplay = document.getElementById('urlDisplay');
    const accessBadge = document.getElementById('accessBadge');
    const serverBadge = document.getElementById('serverBadge');

    chrome.storage.local.get(['bridgeActive'], (result) => {
        const isActive = result.bridgeActive !== false;
        toggle.checked = isActive;
        updateUI(isActive);
    });

    toggle.addEventListener('change', () => {
        const isActive = toggle.checked;
        chrome.storage.local.set({ bridgeActive: isActive });
        chrome.runtime.sendMessage({ action: 'set_bridge_active', active: isActive });
        updateUI(isActive);
    });

    function updateUI(isActive) {
        if (!isActive) {
            statusText.innerText = 'Bridge OFF — grey icon';
            statusText.style.color = '#5f6368';
        } else {
            chrome.runtime.sendMessage({ action: 'get_bridge_state' }, (state) => {
                if (chrome.runtime.lastError || !state) {
                    statusText.innerText = 'Bridge ON — blue icon';
                    statusText.style.color = '#1a73e8';
                    return;
                }
                if (state.isControlled) {
                    statusText.innerText = 'Remote control — red icon & eye';
                    statusText.style.color = '#EA4335';
                } else {
                    statusText.innerText = 'Bridge ready — blue icon & eye';
                    statusText.style.color = '#1a73e8';
                }
            });
        }

        checkServer();

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]) return;
            const tab = tabs[0];
            urlDisplay.innerText = tab.url || '(none)';

            if (!isActive) {
                setAccessStatus(false, 'Bridge Disabled');
                return;
            }
            if (!tab.url?.startsWith('http')) {
                setAccessStatus(false, 'Restricted Page');
                return;
            }

            chrome.tabs.sendMessage(tab.id, { action: 'ping' }, (response) => {
                if (chrome.runtime.lastError) {
                    setAccessStatus(false, 'Injecting...');
                    chrome.runtime.sendMessage({ action: 'force_inject', tabId: tab.id });
                } else if (response?.status === 'alive') {
                    setAccessStatus(true, 'Connected');
                } else {
                    setAccessStatus(false, 'Wait...');
                }
            });
        });
    }

    function checkServer() {
        if (!serverBadge) return;
        fetch('http://127.0.0.1:5000/health')
            .then((r) => (r.ok ? r.json() : Promise.reject()))
            .then(() => {
                serverBadge.innerText = 'Server OK';
                serverBadge.className = 'status-badge status-active';
            })
            .catch(() => {
                serverBadge.innerText = 'Server OFF';
                serverBadge.className = 'status-badge status-inactive';
            });
    }

    function setAccessStatus(hasAccess, text) {
        accessBadge.innerText = text || (hasAccess ? 'Connected' : 'No Access');
        accessBadge.className = 'status-badge ' + (hasAccess ? 'status-active' : 'status-inactive');
    }

    setInterval(() => {
        chrome.storage.local.get(['bridgeActive'], (result) => {
            updateUI(result.bridgeActive !== false);
        });
    }, 1500);
});

const BRIDGE_BASE = 'http://127.0.0.1:5000';
const LONG_POLL_WAIT_MS = 25000;
const MIN_CONTROL_VISIBLE_MS = 500;
const ALARM_NAME = 'bridgeKeepAlive';
const OFFSCREEN_URL = 'offscreen.html';

let bridgeActive = false;
let isControlled = false;
let controlHoldUntil = 0;
let isHandlingCommand = false;
let pollInFlight = false;
let pollAbortController = null;
let lastJustLoaded = false;
let tickPushCounter = 0;

async function extLog(msg) {
    console.log('[Bridge]', msg);
    try {
        await fetch(`${BRIDGE_BASE}/log`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ msg: String(msg) })
        });
    } catch (e) {}
}

function controlActiveNow() {
    return isControlled || isHandlingCommand || Date.now() < controlHoldUntil;
}

function applyVisualState() {
    const controlled = bridgeActive && controlActiveNow();
    const iconPrefix = !bridgeActive ? 'icon_' : controlled ? 'icon_active_' : 'icon_on_';

    chrome.action
        .setIcon({
            path: {
                16: `icons/${iconPrefix}16.png`,
                48: `icons/${iconPrefix}48.png`,
                128: `icons/${iconPrefix}128.png`
            }
        })
        .catch(() => {});

    chrome.action.setBadgeText({ text: controlled ? '●' : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#EA4335' });

    if (bridgeActive) {
        broadcastEyes(true, controlled);
    } else {
        broadcastEyes(false, false);
    }
}

function setControlled(active) {
    isControlled = !!active;
    if (!active) {
        controlHoldUntil = Math.max(controlHoldUntil, Date.now() + MIN_CONTROL_VISIBLE_MS);
    }
    applyVisualState();
}

async function syncServerControlState() {
    if (!bridgeActive) return false;
    try {
        const response = await fetch(`${BRIDGE_BASE}/health`);
        if (!response.ok) return isControlled;
        const health = await response.json();
        const serverControlling = !!health.controlling;
        if (serverControlling !== isControlled && !isHandlingCommand) {
            isControlled = serverControlling;
            applyVisualState();
        }
        if (response.ok) {
            chrome.action.setBadgeText({ text: controlActiveNow() ? '●' : '' });
        }
        return serverControlling;
    } catch (e) {
        return isControlled;
    }
}

function scheduleKeepAliveAlarm() {
    if (!chrome.alarms?.create) return;
    chrome.alarms.clear(ALARM_NAME, () => {
        chrome.alarms.create(ALARM_NAME, { when: Date.now() + 20000 });
    });
}

async function ensureOffscreenDocument() {
    if (!chrome.offscreen) return;
    try {
        if (chrome.runtime.getContexts) {
            const contexts = await chrome.runtime.getContexts({
                contextTypes: ['OFFSCREEN_DOCUMENT'],
                documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
            });
            if (contexts.length > 0) return;
        }
        await chrome.offscreen.createDocument({
            url: OFFSCREEN_URL,
            reasons: ['WORKERS'],
            justification: 'Keeps AI bridge polling and live state active while enabled'
        });
    } catch (e) {
        if (!String(e.message).includes('Only a single offscreen')) {
            await extLog('Offscreen create: ' + e.message);
        }
    }
}

async function closeOffscreenDocument() {
    if (!chrome.offscreen) return;
    try {
        if (chrome.runtime.getContexts) {
            const contexts = await chrome.runtime.getContexts({
                contextTypes: ['OFFSCREEN_DOCUMENT'],
                documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
            });
            if (contexts.length === 0) return;
        }
        await chrome.offscreen.closeDocument();
    } catch (e) {}
}

async function reinjectAllBridgeTabs() {
    const tabs = await chrome.tabs.query({});
    const controlled = controlActiveNow();
    for (const tab of tabs) {
        if (!tab.id || !tab.url?.startsWith('http')) continue;
        try {
            await applyEyesToTab(tab.id, {
                active: bridgeActive,
                isBusy: controlled,
                eyeMode: !bridgeActive ? 'off' : controlled ? 'busy' : 'idle'
            });
        } catch (e) {
            await extLog('Reinject tab ' + tab.id + ': ' + e.message);
        }
    }
}

async function wakeBridge() {
    const stored = await chrome.storage.local.get(['bridgeActive']);
    bridgeActive = stored.bridgeActive !== false;
    if (!bridgeActive) return;
    await ensureOffscreenDocument();
    scheduleKeepAliveAlarm();
    if (!pollInFlight) {
        pollServer();
    }
    if (lastJustLoaded) {
        await reinjectAllBridgeTabs();
    }
    pushLiveState();
    syncServerControlState();
}

chrome.runtime.onStartup.addListener(() => wakeBridge());
chrome.runtime.onInstalled.addListener(() => {
    lastJustLoaded = true;
    wakeBridge();
});

if (chrome.alarms?.onAlarm) {
    chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === ALARM_NAME) {
            scheduleKeepAliveAlarm();
            wakeBridge();
        }
    });
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.bridgeActive) {
        bridgeActive = !!changes.bridgeActive.newValue;
        if (!bridgeActive) {
            isControlled = false;
            isHandlingCommand = false;
            controlHoldUntil = 0;
            stopBridgeSession();
            extLog('Bridge disabled via storage.');
        } else {
            startBridgeSession();
            extLog('Bridge enabled via storage.');
        }
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const handle = async () => {
        if (message.action === 'bridge_tick') {
            if (!bridgeActive) return { ok: false };
            tickPushCounter += 1;
            if (tickPushCounter % 1 === 0) {
                await pushLiveState();
            }
            await syncServerControlState();
            if (!pollInFlight) {
                pollServer();
            }
            return { ok: true };
        }
        if (message.action === 'bridge_heartbeat') {
            if (bridgeActive && !pollInFlight) {
                pollServer();
            }
            return { ok: true };
        }
        if (message.action === 'get_bridge_state') {
            return {
                active: bridgeActive,
                isBusy: controlActiveNow(),
                isControlled: controlActiveNow(),
                justLoaded: lastJustLoaded
            };
        }
        if (message.action === 'set_bridge_active') {
            bridgeActive = !!message.active;
            await chrome.storage.local.set({ bridgeActive });
            if (!bridgeActive) {
                isControlled = false;
                isHandlingCommand = false;
                controlHoldUntil = 0;
                stopBridgeSession();
            } else {
                startBridgeSession();
            }
            return { ok: true, active: bridgeActive };
        }
        if (message.action === 'force_inject') {
            const tabId = message.tabId || (await getActiveTab())?.id;
            if (tabId) {
                await injectContentScript(tabId);
                return { ok: true, tabId };
            }
            return { ok: false, error: 'No tab' };
        }
        return { status: 'unhandled' };
    };

    handle()
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ error: err.message }));
    return true;
});

async function checkAndStart() {
    const result = await chrome.storage.local.get(['bridgeActive']);
    bridgeActive = result.bridgeActive !== false;
    await chrome.storage.local.set({ bridgeActive });
    applyVisualState();
    if (bridgeActive) {
        startBridgeSession();
        await extLog('Bridge started.');
    }
}

function stopBridgeSession() {
    if (pollAbortController) {
        pollAbortController.abort();
        pollAbortController = null;
    }
    pollInFlight = false;
    if (chrome.alarms?.clear) {
        chrome.alarms.clear(ALARM_NAME);
    }
    closeOffscreenDocument();
    applyVisualState();
}

function startBridgeSession() {
    applyVisualState();
    ensureOffscreenDocument();
    scheduleKeepAliveAlarm();
    pollServer();
    pushLiveState();
    syncServerControlState();
}

async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tabs[0] || null;
}

async function cleanupLegacyBridgeOnTab(tabId) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                try {
                    if (window.__geminiBridgeHeartbeatTimer != null) {
                        clearInterval(window.__geminiBridgeHeartbeatTimer);
                        window.__geminiBridgeHeartbeatTimer = null;
                    }
                } catch (e) {}
                try {
                    document
                        .querySelectorAll('#gemini-bridge-eyes, #gemini-bridge-overlay')
                        .forEach((el) => el.remove());
                } catch (e) {}
            }
        });
    } catch (e) {}
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js']
        });
    } catch (e) {}
}

function resolveEyeModeFromPayload(active, controlled, eyeMode) {
    if (!active) return 'idle';
    if (eyeMode === 'busy' || eyeMode === 'idle') return eyeMode;
    return controlled ? 'busy' : 'idle';
}

async function applyEyesToTab(tabId, { active, isBusy, eyeMode }) {
    if (!tabId) return;
    const mode = resolveEyeModeFromPayload(active, isBusy, eyeMode);
    try {
        await cleanupLegacyBridgeOnTab(tabId);
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['eyes-page.js']
        });
        await chrome.scripting.executeScript({
            target: { tabId },
            func: (show, eyeModeArg) => {
                if (show && typeof window.__bridgeApplyEyes === 'function') {
                    window.__bridgeApplyEyes(eyeModeArg);
                } else if (typeof window.__bridgeRemoveEyes === 'function') {
                    window.__bridgeRemoveEyes();
                }
            },
            args: [!!active, mode]
        });
    } catch (e) {
        await extLog('applyEyes tab ' + tabId + ': ' + e.message);
    }
}

async function showBridgeOverlayOnTab(tabId) {
    if (!tabId) return;
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['eyes-page.js']
        });
        await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                if (typeof window.__bridgeShowOverlay === 'function') {
                    window.__bridgeShowOverlay('idle');
                }
            }
        });
    } catch (e) {}
}

/** @deprecated use applyEyesToTab */
async function injectContentScript(tabId) {
    const controlled = controlActiveNow();
    await applyEyesToTab(tabId, {
        active: bridgeActive,
        isBusy: controlled,
        eyeMode: bridgeActive ? (controlled ? 'busy' : 'idle') : 'off'
    });
}

async function broadcastEyes(active, controlled = false) {
    const tabs = await chrome.tabs.query({});
    const eyeMode = !active ? 'off' : controlled ? 'busy' : 'idle';
    for (const tab of tabs) {
        if (!tab.id || !tab.url?.startsWith('http')) continue;
        await applyEyesToTab(tab.id, { active, isBusy: controlled, eyeMode });
    }
}

async function pushLiveState() {
    if (!bridgeActive) return;
    try {
        const tabs = await chrome.tabs.query({});
        const summarized = [];
        for (const tab of tabs) {
            if (!tab.url?.startsWith('http')) continue;
            if (tab.discarded) {
                summarized.push({
                    id: tab.id,
                    active: tab.active,
                    windowId: tab.windowId,
                    url: tab.url,
                    title: tab.title,
                    text: null,
                    discarded: true
                });
                continue;
            }
            let snippet = null;
            try {
                const inj = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => ({
                        url: location.href,
                        title: document.title,
                        text: (document.body?.innerText || '').slice(0, 8000)
                    })
                });
                snippet = inj[0]?.result;
            } catch (e) {
                snippet = {
                    url: tab.url,
                    title: tab.title,
                    text: null,
                    error: e.message
                };
            }
            summarized.push({
                id: tab.id,
                active: tab.active,
                windowId: tab.windowId,
                ...snippet
            });
        }
        const activeTab = await getActiveTab();
        await fetch(`${BRIDGE_BASE}/state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                bridgeActive,
                extensionAlive: true,
                activeTab: activeTab
                    ? { id: activeTab.id, url: activeTab.url, title: activeTab.title }
                    : null,
                tabs: summarized
            })
        });
    } catch (e) {}
}

async function pollServer() {
    if (!bridgeActive || pollInFlight) return;
    pollInFlight = true;
    pollAbortController = new AbortController();

    try {
        await syncServerControlState();

        const response = await fetch(`${BRIDGE_BASE}/command?wait=${LONG_POLL_WAIT_MS}`, {
            signal: pollAbortController.signal
        });

        if (response.ok) {
            const cmd = await response.json();
            if (cmd && cmd.controlling && !cmd.action) {
                setControlled(true);
            }
            if (cmd && cmd.action) {
                isHandlingCommand = true;
                setControlled(true);
                await handleCommand(cmd);
                isHandlingCommand = false;
                await syncServerControlState();
                setControlled(isControlled);
            }
            chrome.action.setBadgeText({ text: controlActiveNow() ? '●' : '' });
        }
    } catch (err) {
        if (bridgeActive && err.name !== 'AbortError') {
            chrome.action.setBadgeText({ text: '?' });
            await extLog('Poll error: ' + err.message);
        }
    } finally {
        pollInFlight = false;
        pollAbortController = null;
        if (bridgeActive) {
            pollServer();
        }
    }
}

async function injectTelegramBotFatherModule(tabId) {
    await chrome.scripting.executeScript({
        target: { tabId },
        files: ['telegram-botfather-v5.js']
    });
}

async function callTelegramBotFatherApi(tabId, methodName, methodArgs = [], depth = 0) {
    if (depth > 4) return { error: 'navigate_depth_exceeded' };
    await injectTelegramBotFatherModule(tabId);
    const injection = await chrome.scripting.executeScript({
        target: { tabId },
        func: async (name, args) => {
            const api = window.__bridgeTelegramBotFather;
            if (!api || typeof api[name] !== 'function') {
                return { error: 'telegram-botfather.js not loaded', method: name };
            }
            return api[name](...args);
        },
        args: [methodName, methodArgs]
    });
    let result = injection[0]?.result ?? { error: 'No injection result' };
    if (!result?.navigateTo || depth >= 4) return result;

    await chrome.tabs.update(tabId, { url: result.navigateTo });
    await new Promise((r) => setTimeout(r, 10000));
    let afterNav = await callTelegramBotFatherApi(tabId, 'probe', [], depth + 1);
    if (
        afterNav?.hasActiveChat ||
        methodName === 'runStartQuest' ||
        methodName === 'runChatEnsure' ||
        methodName === 'runFullQuest' ||
        methodName === 'runBotQuest'
    ) {
        if (
            methodName === 'runChatEnsure' ||
            methodName === 'runStartQuest' ||
            methodName === 'runFullQuest' ||
            methodName === 'runBotQuest'
        ) {
            return callTelegramBotFatherApi(tabId, methodName, methodArgs, depth + 1);
        }
        return { opened: true, method: 'navigate', probe: afterNav, navigated: result.navigateTo };
    }
    if (result.fallbackNavigateTo) {
        await chrome.tabs.update(tabId, { url: result.fallbackNavigateTo });
        await new Promise((r) => setTimeout(r, 8000));
        afterNav = await callTelegramBotFatherApi(tabId, 'probe', [], depth + 1);
        if (
            methodName === 'runChatEnsure' ||
            methodName === 'runStartQuest' ||
            methodName === 'runFullQuest' ||
            methodName === 'runBotQuest'
        ) {
            return callTelegramBotFatherApi(tabId, methodName, methodArgs, depth + 1);
        }
    }
    return result;
}

async function handleCommand(cmd) {
    let result = null;
    try {
        await extLog('Handling command: ' + cmd.action);
        if (cmd.action === 'navigate') {
            const tab = await getActiveTab();
            if (tab) {
                await chrome.tabs.update(tab.id, { url: cmd.url });
                result = { status: 'navigated', url: cmd.url };
            } else {
                const created = await chrome.tabs.create({ url: cmd.url, active: true });
                result = { status: 'created', tabId: created.id, url: cmd.url };
            }
        } else if (cmd.action === 'get_storage') {
            const area = cmd.area || 'local';
            result = await chrome.storage[area].get(cmd.keys ?? null);
        } else if (cmd.action === 'set_storage') {
            const area = cmd.area || 'local';
            await chrome.storage[area].set(cmd.data);
            result = { status: 'stored' };
        } else if (cmd.action === 'get_data') {
            const tab = cmd.tabId ? { id: cmd.tabId } : await getActiveTab();
            if (tab?.id) {
                const tabInfo = await chrome.tabs.get(tab.id).catch(() => null);
                if (tabInfo?.discarded) {
                    await chrome.tabs.reload(tab.id);
                    await new Promise((r) => setTimeout(r, 500));
                }
                const injection = await chrome.scripting.executeScript({
                    target: { tabId: tab.id, allFrames: !!cmd.allFrames },
                    func: () => ({
                        url: location.href,
                        title: document.title,
                        text: (document.body?.innerText || '').slice(0, 50000)
                    })
                });
                result = injection.map((r) => r.result);
            } else {
                result = { error: 'No active tab' };
            }
        } else if (cmd.action === 'execute') {
            const tab = cmd.tabId ? { id: cmd.tabId } : await getActiveTab();
            if (tab?.id) {
                const injection = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: (code) => {
                        if (typeof code !== 'string') return 'ERROR: code must be string';
                        if (code.startsWith('click_text:')) {
                            const text = code.split('click_text:')[1].trim().toLowerCase();
                            if (text === 'start' && /botfather/i.test(location.href)) {
                                const mid = document.querySelector('#MiddleColumn');
                                if (mid) {
                                    for (const e of mid.querySelectorAll(
                                        'button, a, .Button, [role="button"]'
                                    )) {
                                        if (!e.offsetParent) continue;
                                        if ((e.innerText || '').trim().toLowerCase() !== 'start') continue;
                                        e.click();
                                        return 'clicked_chat_start';
                                    }
                                }
                            }
                            const roots = [];
                            const left = document.querySelector('#column-left');
                            if (left) roots.push(left);
                            roots.push(document.body);
                            const matches = [];
                            for (const root of roots) {
                                for (const e of root.querySelectorAll(
                                    'button, a, span, div, [role="button"]'
                                )) {
                                    if (!e.offsetParent) continue;
                                    const label = (e.innerText || '').trim();
                                    if (!label) continue;
                                    const low = label.toLowerCase();
                                    const exact = low === text;
                                    const partial = low.includes(text);
                                    if (!exact && !partial) continue;
                                    matches.push({ e, label, exact, len: label.length });
                                }
                            }
                            matches.sort((a, b) => {
                                if (a.exact !== b.exact) return a.exact ? -1 : 1;
                                return a.len - b.len;
                            });
                            const target = matches[0]?.e;
                            if (target) {
                                target.click();
                                return 'clicked';
                            }
                            return 'not_found';
                        }
                        try {
                            return eval(code);
                        } catch (e) {
                            return 'ERROR: ' + e.message;
                        }
                    },
                    args: [cmd.code]
                });
                result = injection[0]?.result;
            } else {
                result = { error: 'No active tab' };
            }
        } else if (cmd.action === 'extension_reload') {
            result = { status: 'reloading' };
            setTimeout(() => chrome.runtime.reload(), 150);
        } else if (cmd.action === 'telegram_send') {
            const tab = cmd.tabId ? { id: cmd.tabId } : await getActiveTab();
            if (tab?.id) {
                const injection = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: async (text) => {
                        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
                        const input =
                            document.querySelector('#editable-message-text') ||
                            document.querySelector('.input-message-input') ||
                            document.querySelector('[contenteditable="true"]');
                        if (!input) return { error: 'no_input' };
                        input.focus();
                        try {
                            document.execCommand('insertText', false, text);
                        } catch (e) {
                            input.innerText = text;
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                        input.dispatchEvent(
                            new KeyboardEvent('keydown', {
                                bubbles: true,
                                cancelable: true,
                                key: 'Enter',
                                code: 'Enter',
                                keyCode: 13
                            })
                        );
                        await sleep(3200);
                        return { sent: true, text };
                    },
                    args: [cmd.text || '/mybots']
                });
                result = injection[0]?.result ?? { error: 'No send result' };
            } else {
                result = { error: 'No active tab' };
            }
        } else if (cmd.action === 'telegram_botfather_chat') {
            const tab = cmd.tabId ? { id: cmd.tabId } : await getActiveTab();
            const createIfMissing = cmd.createIfMissing !== false;
            if (tab?.id) {
                result = await callTelegramBotFatherApi(tab.id, 'runChatEnsure', [createIfMissing]);
            } else {
                result = { error: 'No active tab' };
            }
        } else if (cmd.action === 'telegram_open_botfather') {
            const tab = cmd.tabId ? { id: cmd.tabId } : await getActiveTab();
            if (tab?.id) {
                result = await callTelegramBotFatherApi(tab.id, 'openBotFatherChat', []);
            } else {
                result = { error: 'No active tab' };
            }
        } else if (cmd.action === 'telegram_botfather_start') {
            const tab = cmd.tabId ? { id: cmd.tabId } : await getActiveTab();
            if (tab?.id) {
                result = await callTelegramBotFatherApi(tab.id, 'runStartQuest', [
                    cmd.displayName || '',
                    cmd.username || ''
                ]);
            } else {
                result = { error: 'No active tab' };
            }
        } else if (cmd.action === 'telegram_botfather_bots') {
            const tab = cmd.tabId ? { id: cmd.tabId } : await getActiveTab();
            if (tab?.id) {
                await callTelegramBotFatherApi(tab.id, 'probe', []);
                result = await callTelegramBotFatherApi(tab.id, 'probeBotsState', []);
            } else {
                result = { error: 'No active tab' };
            }
        } else if (cmd.action === 'telegram_botfather_bot_quest') {
            const tab = cmd.tabId ? { id: cmd.tabId } : await getActiveTab();
            if (tab?.id) {
                result = await callTelegramBotFatherApi(tab.id, 'runBotQuest', [
                    cmd.displayName || '',
                    cmd.username || ''
                ]);
            } else {
                result = { error: 'No active tab' };
            }
        } else if (cmd.action === 'telegram_botfather_token') {
            const tab = cmd.tabId ? { id: cmd.tabId } : await getActiveTab();
            if (tab?.id) {
                result = await callTelegramBotFatherApi(tab.id, 'runTokenQuest', []);
            } else {
                result = { error: 'No active tab' };
            }
        } else if (cmd.action === 'telegram_botfather_full') {
            const tab = cmd.tabId ? { id: cmd.tabId } : await getActiveTab();
            if (tab?.id) {
                result = await callTelegramBotFatherApi(tab.id, 'runFullQuest', [
                    {
                        displayName: cmd.displayName || '',
                        username: cmd.username || ''
                    }
                ]);
            } else {
                result = { error: 'No active tab' };
            }
        } else if (cmd.action === 'telegram_inject_version') {
            const tab = cmd.tabId ? { id: cmd.tabId } : await getActiveTab();
            if (tab?.id) {
                await injectTelegramBotFatherModule(tab.id);
                const injection = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => window.__bridgeTelegramBotFather?.VERSION || 'missing'
                });
                result = { version: injection[0]?.result };
            } else {
                result = { error: 'No active tab' };
            }
        } else if (cmd.action === 'telegram_botfather_debug') {
            const tab = cmd.tabId ? { id: cmd.tabId } : await getActiveTab();
            if (tab?.id) {
                result = await callTelegramBotFatherApi(tab.id, 'debugSearchType', []);
            } else {
                result = { error: 'No active tab' };
            }
        } else if (cmd.action === 'telegram_dom_scan') {
            const tab = cmd.tabId ? { id: cmd.tabId } : await getActiveTab();
            if (tab?.id) {
                result = await callTelegramBotFatherApi(tab.id, 'domScan', []);
            } else {
                result = { error: 'No active tab' };
            }
        } else if (cmd.action === 'telegram_probe') {
            const tab = cmd.tabId ? { id: cmd.tabId } : await getActiveTab();
            if (tab?.id) {
                const injection = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => {
                        const isPresent = (sel) => !!document.querySelector(sel);
                        const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
                        const isAppLoaded =
                            isPresent('.chatlist-container') ||
                            isPresent('#side-bar') ||
                            isPresent('.Sidebar') ||
                            isPresent('#LeftColumn') ||
                            isPresent('.ChatInput') ||
                            isPresent('.chat-list') ||
                            isPresent('.ListItem-chat') ||
                            isPresent('.Chat') ||
                            isPresent('#MiddleColumn') ||
                            isPresent('.tabs-container') ||
                            isPresent('.folders-tabs');
                        const qrLoginByText =
                            /log in to telegram by qr/i.test(bodyText) ||
                            /link desktop device/i.test(bodyText) ||
                            /point your phone at this screen/i.test(bodyText);
                        const onLoginPage = !isAppLoaded && qrLoginByText;
                        const loggedIn = isAppLoaded && !onLoginPage;
                        const titleMatch = /BotFather/i.test(bodyText);
                        const hashBf = window.location.hash.includes('BotFather');
                        const hasMessages =
                            isPresent('.bubbles-inner') ||
                            isPresent('.message-list') ||
                            isPresent('.Message');
                        const isBotFather = titleMatch || (hashBf && hasMessages);
                        const tokenMatch = bodyText.match(/\d{8,10}:[a-zA-Z0-9_-]{35}/);
                        const systemBots = new Set([
                            'botfather',
                            'botsupport',
                            'botnews',
                            'gif',
                            'stickers',
                            'telegram',
                            'youtube',
                            'pic',
                            'like'
                        ]);
                        const botButtons = Array.from(
                            document.querySelectorAll(
                                'a, button, .reply-markup-button, .Button, .btn, [role="button"]'
                            )
                        )
                            .filter((el) => {
                                const t = (el.innerText || '').trim();
                                if (!t || t.length > 64 || /\n/.test(t)) return false;
                                const m = t.match(/^@([a-zA-Z0-9_]+)$/i);
                                if (!m) return false;
                                const h = m[1].toLowerCase();
                                if (systemBots.has(h)) return false;
                                return /bot$/i.test(h);
                            })
                            .map((el) => (el.innerText || '').trim());
                        const hasBotList =
                            /choose a bot from the list/i.test(bodyText) ||
                            /edit bots/i.test(bodyText) ||
                            botButtons.length > 0;
                        const hasTokenMenu =
                            /api token/i.test(bodyText) ||
                            /token for/i.test(bodyText) ||
                            /revoke current token/i.test(bodyText);
                        return {
                            url: window.location.href,
                            loggedIn,
                            isLoginPage: onLoginPage,
                            isBotFather,
                            foundToken: tokenMatch ? tokenMatch[0] : null,
                            botButtons: botButtons.slice(-5),
                            hasBotList,
                            hasTokenMenu,
                            hasNoBots:
                                /you have no bots|no bots yet/i.test(bodyText) ||
                                botButtons.length === 0,
                            textSample: bodyText.slice(0, 500)
                        };
                    }
                });
                result = injection[0]?.result ?? { error: 'No probe result' };
            } else {
                result = { error: 'No active tab' };
            }
        } else if (cmd.action === 'list_tabs') {
            const tabs = await chrome.tabs.query({});
            result = tabs.map((t) => ({
                id: t.id,
                url: t.url,
                title: t.title,
                active: t.active,
                windowId: t.windowId,
                discarded: t.discarded
            }));
        } else if (cmd.action === 'activate_tab') {
            if (cmd.tabId) {
                await chrome.tabs.update(cmd.tabId, { active: true });
                const tab = await chrome.tabs.get(cmd.tabId);
                if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
                result = { status: 'activated', tabId: cmd.tabId };
            }
        } else {
            result = { error: 'Unknown action: ' + cmd.action };
        }
    } catch (e) {
        result = { error: 'CRITICAL_ERROR: ' + e.message };
        await extLog(result.error);
    }

    if (cmd.id) {
        await fetch(`${BRIDGE_BASE}/result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: cmd.id, result })
        }).catch(() => {});
    }

    await pushLiveState();
}

chrome.tabs.onActivated.addListener(() => {
    if (bridgeActive) pushLiveState();
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (bridgeActive && (changeInfo.status === 'complete' || changeInfo.url)) {
        pushLiveState();
    }
});
if (chrome.tabs?.onDiscarded) {
    chrome.tabs.onDiscarded.addListener(() => {
        if (bridgeActive) pushLiveState();
    });
}

if (chrome.webNavigation?.onCompleted) {
    chrome.webNavigation.onCompleted.addListener((details) => {
        if (!bridgeActive || details.frameId !== 0) return;
        const controlled = controlActiveNow();
        applyEyesToTab(details.tabId, {
            active: true,
            isBusy: controlled,
            eyeMode: controlled ? 'busy' : 'idle'
        }).then(() => {
            if (lastJustLoaded) {
                showBridgeOverlayOnTab(details.tabId);
                lastJustLoaded = false;
            }
        });
    });
}

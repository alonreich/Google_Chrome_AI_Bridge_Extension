/**
 * Local bridge server for Google Chrome Bridge extension.
 * Extension long-polls GET /command?wait=25000; AI queues via POST /queue.
 *
 * Run: node server.js
 * Default: http://127.0.0.1:5000
 */

const http = require('http');
const PORT = Number(process.env.BRIDGE_PORT) || 5000;
const HOST = process.env.BRIDGE_HOST || '127.0.0.1';
const IN_FLIGHT_TIMEOUT_MS = Number(process.env.BRIDGE_INFLIGHT_MS) || 90000;
const MAX_LONG_POLL_MS = 30000;

const commandQueue = [];
const commandWaiters = [];
const results = new Map();
const logs = [];
const MAX_LOGS = 500;

let inFlight = null;
let inFlightSince = null;

let liveState = {
    updatedAt: null,
    activeTab: null,
    tabs: []
};

function isControlling() {
    return commandQueue.length > 0 || inFlight !== null;
}

function clearStaleInFlight() {
    if (!inFlight || !inFlightSince) return false;
    if (Date.now() - inFlightSince < IN_FLIGHT_TIMEOUT_MS) return false;
    console.warn('[bridge] inFlight timeout, re-queueing', inFlight.id);
    commandQueue.unshift(inFlight);
    inFlight = null;
    inFlightSince = null;
    notifyCommandWaiters();
    return true;
}

function notifyCommandWaiters() {
    while (commandQueue.length > 0 && commandWaiters.length > 0) {
        const waiter = commandWaiters.shift();
        clearTimeout(waiter.timer);
        waiter.resolve(takeNextCommand());
    }
}

function takeNextCommand() {
    clearStaleInFlight();
    if (commandQueue.length > 0) {
        inFlight = commandQueue.shift();
        inFlightSince = Date.now();
        return { ...inFlight, controlling: true };
    }
    return { idle: true, controlling: isControlling() };
}

function waitForCommand(maxMs) {
    clearStaleInFlight();
    if (commandQueue.length > 0) {
        return Promise.resolve(takeNextCommand());
    }
    return new Promise((resolve) => {
        const waiter = { resolve, timer: null };
        waiter.timer = setTimeout(() => {
            const idx = commandWaiters.indexOf(waiter);
            if (idx >= 0) commandWaiters.splice(idx, 1);
            clearStaleInFlight();
            resolve({ idle: true, controlling: isControlling() });
        }, maxMs);
        commandWaiters.push(waiter);
    });
}

function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, status, data) {
    cors(res);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', (chunk) => {
            raw += chunk;
            if (raw.length > 2 * 1024 * 1024) {
                reject(new Error('Body too large'));
                req.destroy();
            }
        });
        req.on('end', () => {
            if (!raw) return resolve(null);
            try {
                resolve(JSON.parse(raw));
            } catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'OPTIONS') {
        cors(res);
        res.writeHead(204);
        res.end();
        return;
    }

    try {
        clearStaleInFlight();

        if (req.method === 'GET' && url.pathname === '/health') {
            return sendJson(res, 200, {
                ok: true,
                queueLength: commandQueue.length,
                controlling: isControlling(),
                inFlightId: inFlight?.id || null,
                inFlightAgeMs: inFlightSince ? Date.now() - inFlightSince : null,
                waiters: commandWaiters.length,
                liveUpdatedAt: liveState.updatedAt
            });
        }

        if (req.method === 'GET' && url.pathname === '/command') {
            const waitMs = Math.min(
                Math.max(0, parseInt(url.searchParams.get('wait'), 10) || 0),
                MAX_LONG_POLL_MS
            );
            const cmd = waitMs > 0 ? await waitForCommand(waitMs) : takeNextCommand();
            return sendJson(res, 200, cmd);
        }

        if (req.method === 'POST' && url.pathname === '/queue') {
            const body = await readBody(req);
            if (!body || !body.action) {
                return sendJson(res, 400, { error: 'Missing action' });
            }
            const id = body.id || `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const cmd = { ...body, id };
            commandQueue.push(cmd);
            console.log('[queue]', cmd.action, id);
            notifyCommandWaiters();
            return sendJson(res, 200, { queued: true, id });
        }

        if (req.method === 'POST' && url.pathname === '/result') {
            const body = await readBody(req);
            if (body && body.id !== undefined) {
                results.set(body.id, { result: body.result, at: Date.now() });
                if (inFlight && inFlight.id === body.id) {
                    inFlight = null;
                    inFlightSince = null;
                }
            }
            return sendJson(res, 200, { ok: true, controlling: isControlling() });
        }

        if (req.method === 'GET' && url.pathname.startsWith('/result/')) {
            const id = decodeURIComponent(url.pathname.slice('/result/'.length));
            const entry = results.get(id);
            if (!entry) return sendJson(res, 404, { error: 'Not found' });
            return sendJson(res, 200, entry);
        }

        if (req.method === 'POST' && url.pathname === '/log') {
            const body = await readBody(req);
            const line = body?.msg || body?.message || String(body);
            logs.unshift({ at: new Date().toISOString(), msg: line });
            if (logs.length > MAX_LOGS) logs.length = MAX_LOGS;
            console.log('[ext]', line);
            return sendJson(res, 200, { ok: true });
        }

        if (req.method === 'GET' && url.pathname === '/logs') {
            const limit = Math.min(Number(url.searchParams.get('limit')) || 100, MAX_LOGS);
            return sendJson(res, 200, { logs: logs.slice(0, limit) });
        }

        if (req.method === 'POST' && url.pathname === '/state') {
            const body = await readBody(req);
            liveState = {
                updatedAt: new Date().toISOString(),
                activeTab: body?.activeTab || null,
                tabs: body?.tabs || [],
                bridgeActive: body?.bridgeActive,
                extensionAlive: body?.extensionAlive !== false
            };
            return sendJson(res, 200, { ok: true });
        }

        if (req.method === 'GET' && url.pathname === '/live') {
            return sendJson(res, 200, liveState);
        }

        if (req.method === 'GET' && url.pathname === '/') {
            return sendJson(res, 200, {
                name: 'Google Chrome Bridge Server',
                endpoints: {
                    health: 'GET /health',
                    pollCommand: 'GET /command?wait=25000 (long-poll)',
                    queueCommand: 'POST /queue { action, ... }',
                    result: 'POST /result { id, result }',
                    getResult: 'GET /result/:id',
                    live: 'GET /live',
                    logs: 'GET /logs'
                }
            });
        }

        sendJson(res, 404, { error: 'Not found' });
    } catch (e) {
        sendJson(res, 500, { error: e.message });
    }
});

setInterval(clearStaleInFlight, 15000);

server.listen(PORT, HOST, () => {
    console.log(`Chrome Bridge server listening on http://${HOST}:${PORT}`);
});

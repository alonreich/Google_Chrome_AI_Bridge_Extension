# Google Chrome Bridge

Connects your **real Chrome** (with this extension) to automation on your PC via a local HTTP server on port **5000**.

## Quick start

1. **Start the server** (Node.js required):

   ```bash
   cd bridge-server
   node server.js
   ```

   You should see: `Chrome Bridge server listening on http://127.0.0.1:5000`

2. **Load the extension** in Chrome:
   - `chrome://extensions` → Developer mode → Load unpacked → select this folder.

3. **Turn the bridge ON** in the extension popup.
   - "Server OK" = server is running.
   - "Connected" = content script is active on the current tab.

4. **AI / scripts** use the HTTP API (see below).

## HTTP API (for Cursor / scripts)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Server alive |
| GET | `/live` | Latest page text/URLs from all http(s) tabs |
| GET | `/command` | Extension polls this (do not use from AI) |
| POST | `/queue` | Queue a command `{ "action": "...", "id": "optional" }` |
| POST | `/result` | Extension posts results (internal) |
| GET | `/result/:id` | Read result after queueing with `id` |
| GET | `/logs` | Extension log lines |

### Example: open a URL

```bash
curl -X POST http://127.0.0.1:5000/queue -H "Content-Type: application/json" -d "{\"action\":\"navigate\",\"url\":\"https://web.telegram.org\"}"
```

### Example: read active tab text

```bash
curl -X POST http://127.0.0.1:5000/queue -H "Content-Type: application/json" -d "{\"action\":\"get_data\",\"id\":\"g1\"}"
curl http://127.0.0.1:5000/result/g1
```

### Example: live snapshot (no queue)

```bash
curl http://127.0.0.1:5000/live
```

## Commands

- `navigate` — `{ "url": "https://..." }`
- `get_data` — page title, URL, body text (active tab)
- `execute` — `{ "code": "..." }` or `click_text:Button label`
- `list_tabs` / `activate_tab` — `{ "tabId": 123 }`
- `get_storage` / `set_storage` — extension storage areas

## Icon & overlay states

| State | Toolbar icon | Page overlay (bottom-right) |
|--------|----------------|-----------------------------|
| Bridge **OFF** | Grey eye | Hidden |
| Bridge **ON**, idle | Blue eye | Blue eye |
| **Remote control** (command queued or running) | Red eye | Red eye |

Restart the bridge server after updates so long-poll and `controlling` work correctly.

## Staying connected (v1.5+)

Chrome MV3 service workers sleep when idle. While the bridge is **ON**, the extension:

- **Long-polls** `GET /command?wait=25000` (keeps the worker alive during each wait)
- Runs an **offscreen keepalive** timer every 4s (live state + poll restart)
- Uses **chrome.alarms** every 20s as a backup wake
- **Page heartbeat** from content scripts every 20s on open tabs

Restart the bridge server after updating so long-poll is enabled.

## Privacy

All data stays on **localhost**. Nothing is sent to the cloud by this bridge unless you do so separately.

## Troubleshooting

- Popup shows **Server OFF** → run `node bridge-server/server.js`.
- Badge **?** on extension → server not reachable.
- **Injecting...** → refresh the page or open an `https://` tab.
- Icons missing → ensure `icons/` folder exists (copied from install package).
"# Google_Chrome_AI_Bridge_Extension" 

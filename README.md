# LightLink

Smart home lighting controller for ESP32 + Next.js.

This is a high-school (M.5) project submission.

## Features

- Secure server-controlled architecture
- HTTP API for device status and commands
- Real-time UI via WebSocket (Socket.IO) with automatic fallback to HTTP polling
- Mock Mode: simulate device without an ESP32
- Room light scheduling (on/off times per room)
- Token-based authorization across APIs

## Repository Structure

- `main.ino` — ESP32 firmware (C++/Arduino). Sends status and fetches commands.
- `web/` — Next.js app (UI + API routes)
  - `app/api/status` — GET current status, POST device status
  - `app/api/cmd` — POST commands from UI
  - `app/api/poll` — GET command queue for device
  - `pages/api/socket.io.ts` — WebSocket server (Socket.IO) to push live status to UI
  - `components/kokonutui/` — UI components
  - `lib/serverStore.ts` — In-memory status + command queue + broadcaster
  - `lib/api.ts` — Client helpers for HTTP

## How It Works

- ESP32 posts current status to `/api/status` and periodically polls `/api/poll` for commands.
- Next.js server stores the status in memory and queues commands from the UI.
- The UI connects via WebSocket to receive live status updates, and falls back to HTTP polling if needed.

## Quick Start (Development)

1) Install deps (run inside `web/`):

```
npm install
```

2) Set environment (file: `web/.env.local`):

```
LIGHTLINK_TOKEN="devtoken"
LIGHTLINK_MOCK=1
```

3) Run the app from the repository root:

```
npm run dev
```

4) Open the Dashboard at:

```
http://localhost:3000
```

- With `LIGHTLINK_MOCK=1`, you can test everything without an ESP32.

## ESP32 Setup (Development)

In `main.ino`:

```
String serverHost = "http://<your-pc-ip>"; // e.g., http://192.168.1.100
int serverPort = 3000;                      // Next.js dev port
String authToken = "devtoken";             // Must match LIGHTLINK_TOKEN in the web app
```

Upload to your ESP32. Ensure PC and ESP32 are on the same LAN and firewall allows port 3000.

## Production Deployment

- Place the Next.js app behind an HTTPS reverse proxy (Caddy/Nginx/Traefik) at your domain, e.g. `https://<your-domain>`.
- Build and start in `web/`:

```
npm run build
npm run start
```

- Configure the ESP32 (HTTPS):

```
String serverHost = "https://<your-domain>";
int serverPort = 443;                       // standard HTTPS
String authToken = "<your-strong-secret>";  // Must match LIGHTLINK_TOKEN
```

- For strong security on ESP32, use `WiFiClientSecure` with certificate pinning (replace `setInsecure()` with `setCACert(...)`).
- In production, do NOT set `LIGHTLINK_MOCK`.
- Enforce Authorization on all endpoints.

## API Summary

- `GET /api/status` — Return latest device status
- `POST /api/status` — Device posts current status (requires Authorization)
- `POST /api/cmd` — UI posts commands (requires Authorization; mock applies immediately)
- `GET /api/poll` — Device polls commands (requires Authorization)
- WebSocket: `/api/socket.io` — UI receives `{ type: "status" }` payloads as events `status`

## Environment Variables (web/.env.local)

- `LIGHTLINK_TOKEN` — Bearer token used by server and clients (ESP32) for Authorization
- `LIGHTLINK_MOCK` — `1` to enable mock mode (dev only), omit or `0` in production
- `NEXT_PUBLIC_SITE_URL` — Your domain (e.g., `<your-domain>`)

## Commands

From repository root (scripts proxy to `web/`):

```
npm run dev    # Start Next.js Dev Server
npm run build  # Build Next.js
npm run start  # Start Next.js in production mode
```

Inside `web/`:

```
npm install
npm run dev
npm run build
npm run start
```

## Security Notes

- Use HTTPS/WSS in production.
- Keep `LIGHTLINK_TOKEN` secret; rotate periodically.
- Consider separate tokens for device and UI, or JWT with short TTL.
- Add rate limiting on the reverse proxy.
- Enforce Authorization on all endpoints.

## License

MIT — see `LICENSE`.

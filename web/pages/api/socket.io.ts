import type { NextApiRequest, NextApiResponse } from "next"
import { Server as IOServer } from "socket.io"
import { getStore } from "@/lib/serverStore"
import { WebSocketServer, WebSocket } from "ws"

export const config = {
  api: {
    bodyParser: false,
  },
}

declare global {
  // eslint-disable-next-line no-var
  var ioInstance: IOServer | undefined
  // eslint-disable-next-line no-var
  var ioStoreSubscribed: boolean | undefined
  // eslint-disable-next-line no-var
  var ioConnectionHandlerBound: boolean | undefined
  // eslint-disable-next-line no-var
  var wsInstance: WebSocketServer | undefined
}

export default function handler(req: NextApiRequest, res: NextApiResponse & { socket: any }) {
  if (!res.socket) {
    res.status(500).end()
    return
  }
  if (!global.ioInstance) {
    const io = new IOServer(res.socket.server, {
      path: "/api/socket.io",
      cors: {
        origin: process.env.NEXT_PUBLIC_SITE_ORIGIN || true,
        methods: ["GET", "POST"],
        credentials: false,
      },
      transports: ["websocket", "polling"],
      allowEIO3: true,
      pingInterval: 25000,
      pingTimeout: 20000,
    })
    global.ioInstance = io

    const store = getStore()
    if (!global.ioStoreSubscribed) {
      store.subscribe((data: string) => {
        try {
          // SSE-style string: "data: {json}\n\n"
          const jsonLine = data.replace(/^data:\s*/, "").trim()
          const obj = JSON.parse(jsonLine)
          if (obj?.type === "status") {
            io.emit("status", obj.payload)
            try {
              // Broadcast to raw WS clients
              global.wsInstance?.clients.forEach((ws) => {
                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj))
              })
            } catch {}
          }
        } catch {}
      })
      global.ioStoreSubscribed = true
    }

    if (!global.ioConnectionHandlerBound) {
      io.on("connection", (socket) => {
        try {
          const cur = store.getStatus()
          if (cur) socket.emit("status", cur)
        } catch {}

        socket.on("cmd", (body) => {
          try {
            if (!body || typeof body !== "object") return
            const isMock = process.env.LIGHTLINK_MOCK === "1" || process.env.NEXT_PUBLIC_LIGHTLINK_MOCK === "1"
            if (isMock) {
              // Simulate same logic as POST /api/cmd (mock branch)
              const cur = (store.getStatus() || { device: "mock-lightlink", lights: [], updatedAt: Date.now() }) as any
              if (!Array.isArray(cur.lights) || cur.lights.length === 0) {
                cur.lights = [
                  { name: "kitchen", state: false, on: "18:00", off: "23:00", scheduleEnabled: false },
                  { name: "living", state: false, on: "18:00", off: "23:00", scheduleEnabled: false },
                  { name: "bedroom", state: false, on: "21:00", off: "07:00", scheduleEnabled: false },
                ]
              }
              if (body.action === "set") {
                const hasState = Object.prototype.hasOwnProperty.call(body, "state")
                if (body.target === "all") {
                  cur.lights = cur.lights.map((l: any) => ({ ...l, state: hasState ? !!body.state : !l.state }))
                } else {
                  cur.lights = cur.lights.map((l: any) => (l.name === body.target ? { ...l, state: hasState ? !!body.state : !l.state } : l))
                }
              }
              if (body.action === "schedule") {
                cur.lights = cur.lights.map((l: any) =>
                  l.name === body.room ? { ...l, on: body.on, off: body.off, scheduleEnabled: !!body.enabled } : l,
                )
              }
              cur.updatedAt = Date.now()
              store.setStatus(cur)
            } else {
              // Hand off to device via polling queue
              store.enqueueCmd(body)
            }
            // Broadcast command to all WS device clients via store subscription
            try { store.broadcast({ type: "cmd", payload: body }) } catch {}
            // Optionally acknowledge
            socket.emit("cmd_ack", { ok: true })
          } catch {}
        })
      })
      global.ioConnectionHandlerBound = true
    }

    // Initialize plain WebSocket server (for ESP32)
    if (!global.wsInstance) {
      const wss = new WebSocketServer({ noServer: true })
      // Upgrade handler
      const server = res.socket.server
      if (!(server as any)._wsUpgraded) {
        ;(server as any).on("upgrade", (req: any, socket: any, head: any) => {
          try {
            const url = new URL(req.url, `http://${req.headers.host}`)
            if (url.pathname !== "/api/ws") return
            const token = url.searchParams.get("token") || ""
            const valid = (process.env.LIGHTLINK_TOKEN || process.env.NEXT_PUBLIC_LIGHTLINK_TOKEN || "devtoken")
            if (token !== valid) {
              socket.destroy()
              return
            }
            wss.handleUpgrade(req, socket, head, (ws) => {
              wss.emit("connection", ws, req)
            })
          } catch {
            try { socket.destroy() } catch {}
          }
        })
        ;(server as any)._wsUpgraded = true
      }

      wss.on("connection", (ws) => {
        // Send current status immediately
        try {
          const cur = store.getStatus()
          if (cur) ws.send(JSON.stringify({ type: "status", payload: cur }))
        } catch {}

        ws.on("message", (data) => {
          try {
            const text = typeof data === "string" ? data : data.toString("utf8")
            const obj = JSON.parse(text)
            if (obj?.type === "status" && obj.payload) {
              store.setStatus(obj.payload)
            } else if (obj?.type === "cmd" && obj.payload) {
              const body = obj.payload
              const isMock = process.env.LIGHTLINK_MOCK === "1" || process.env.NEXT_PUBLIC_LIGHTLINK_MOCK === "1"
              if (isMock) {
                // Update store directly similar to mock
                const cur = (store.getStatus() || { device: "mock-lightlink", lights: [], updatedAt: Date.now() }) as any
                if (!Array.isArray(cur.lights) || cur.lights.length === 0) {
                  cur.lights = [
                    { name: "kitchen", state: false, on: "18:00", off: "23:00", scheduleEnabled: false },
                    { name: "living", state: false, on: "18:00", off: "23:00", scheduleEnabled: false },
                    { name: "bedroom", state: false, on: "21:00", off: "07:00", scheduleEnabled: false },
                  ]
                }
                if (body.action === "set") {
                  const hasState = Object.prototype.hasOwnProperty.call(body, "state")
                  if (body.target === "all") cur.lights = cur.lights.map((l: any) => ({ ...l, state: hasState ? !!body.state : !l.state }))
                  else cur.lights = cur.lights.map((l: any) => (l.name === body.target ? { ...l, state: hasState ? !!body.state : !l.state } : l))
                }
                if (body.action === "schedule") {
                  cur.lights = cur.lights.map((l: any) => (l.name === body.room ? { ...l, on: body.on, off: body.off, scheduleEnabled: !!body.enabled } : l))
                }
                cur.updatedAt = Date.now()
                store.setStatus(cur)
              } else {
                store.enqueueCmd(body)
              }
            }
          } catch {}
        })
      })
      global.wsInstance = wss
    }
  }

  res.end()
}

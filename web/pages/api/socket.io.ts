import type { NextApiRequest, NextApiResponse } from "next"
import { Server as IOServer } from "socket.io"
import { getStore } from "@/lib/serverStore"
import { WebSocketServer, WebSocket } from "ws"
import { getCollection } from "@/lib/mongo"

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
            // Handle catalog mutations from UI
              if (body.action === "add_light") {
                // Expect: { action:"add_light", name, pin, on, off, scheduleEnabled }
                const name = String(body.name || "").trim()
                const pin = Number(body.pin)
                const on = typeof body.on === "string" ? body.on : "00:00"
                const off = typeof body.off === "string" ? body.off : "00:00"
                const scheduleEnabled = !!body.scheduleEnabled
                const allowed = new Set([19, 21, 22, 23])
                if (!name || !Number.isInteger(pin) || !allowed.has(pin)) {
                  socket.emit("cmd_ack", { ok: false, error: "invalid_add_light" })
                  return
                }
                getCollection("lights").then(async (col) => {
                  await col.updateOne({ name }, { $set: { name, pin, on, off, scheduleEnabled, updatedAt: Date.now() } }, { upsert: true })
                  // Ask devices to reload lights
                  try { store.broadcast({ type: "cmd", payload: { action: "reload_lights" } }) } catch {}
                  socket.emit("cmd_ack", { ok: true })
                }).catch(() => socket.emit("cmd_ack", { ok: false }))
                return
              }
              if (body.action === "delete_light") {
                // Expect: { action:"delete_light", name }
                const name = String(body.name || "").trim()
                if (!name) { socket.emit("cmd_ack", { ok: false, error: "invalid_delete_light" }); return }
                getCollection("lights").then(async (col) => {
                  await col.deleteOne({ name })
                  try { store.broadcast({ type: "cmd", payload: { action: "reload_lights" } }) } catch {}
                  socket.emit("cmd_ack", { ok: true })
                }).catch(() => socket.emit("cmd_ack", { ok: false }))
                return
              }
            // Non-catalog commands hand off to device queue and WS
            store.enqueueCmd(body)
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
              store.enqueueCmd(body)
            }
          } catch {}
        })
      })
      global.wsInstance = wss
    }
  }

  res.end()
}

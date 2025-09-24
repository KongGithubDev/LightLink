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
    console.log("[socket.io] initialized at /api/socket.io")

    const store = getStore()

    async function buildMergedStatus() {
      try {
        const cur = store.getStatus()
        const col = await getCollection("lights")
        const catalog = await col.find({}, { projection: { _id: 0 } }).toArray()
        const byName = new Map<string, any>()
        for (const l of cur?.lights || []) byName.set(l.name, { ...l })
        const merged: any = { device: cur?.device || "unknown", lights: [], updatedAt: Date.now() }
        for (const c of catalog) {
          const ex = byName.get(c.name)
          if (ex) {
            merged.lights.push({
              name: ex.name,
              state: !!ex.state,
              on: (ex as any).on ?? c.on ?? "00:00",
              off: (ex as any).off ?? c.off ?? "00:00",
              scheduleEnabled: typeof (ex as any).scheduleEnabled === "boolean" ? (ex as any).scheduleEnabled : !!c.scheduleEnabled,
              pin: (ex as any).pin ?? c.pin,
              schedules: Array.isArray(c.schedules) ? c.schedules : (c.on && c.off ? [{ on: c.on, off: c.off }] : []),
            })
          } else {
            merged.lights.push({ name: c.name, state: false, on: c.on || "00:00", off: c.off || "00:00", scheduleEnabled: !!c.scheduleEnabled, pin: c.pin, schedules: Array.isArray(c.schedules) ? c.schedules : (c.on && c.off ? [{ on: c.on, off: c.off }] : []) })
          }
        }
        for (const l of cur?.lights || []) {
          if (!catalog.find((c: any) => c.name === l.name)) merged.lights.push(l)
        }
        return merged
      } catch {
        return store.getStatus()
      }
    }
    if (!global.ioStoreSubscribed) {
      store.subscribe((data: string) => {
        try {
          // SSE-style string: "data: {json}\n\n"
          const jsonLine = data.replace(/^data:\s*/, "").trim()
          const obj = JSON.parse(jsonLine)
          if (obj?.type === "status") {
            // Always emit merged status to UI so DB-only lights are preserved
            Promise.resolve(buildMergedStatus()).then((merged) => {
              if (merged) io.emit("status", merged)
            }).catch(() => {
              // fallback to raw
              io.emit("status", obj.payload)
            })
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
        console.log("[socket.io] client connected", { id: socket.id })
        try {
          // Send merged status so UI sees DB lights even if device hasn't posted yet
          Promise.resolve(buildMergedStatus()).then((merged) => {
            if (merged) socket.emit("status", merged)
          })
        } catch {}

        socket.on("cmd", async (body) => {
          try {
            if (!body || typeof body !== "object") return
            console.log("[socket.io] cmd from UI", body)
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
              try {
                const col = await getCollection("lights")
                // Enforce unique pin
                const pinInUse = await col.findOne({ pin, name: { $ne: name } })
                if (pinInUse) { socket.emit("cmd_ack", { ok: false, error: "pin_in_use" }); return }
                await col.updateOne({ name }, { $set: { name, pin, on, off, scheduleEnabled, updatedAt: Date.now() } }, { upsert: true })
                // Broadcast merged status to UI immediately
                try {
                  const merged = await buildMergedStatus()
                  io.emit("status", merged)
                } catch {}
                // Ask devices to reload lights
                try {
                  const msg = JSON.stringify({ type: "cmd", payload: { action: "reload_lights" } })
                  global.wsInstance?.clients.forEach((ws) => { if (ws.readyState === WebSocket.OPEN) ws.send(msg) })
                } catch {}
                socket.emit("cmd_ack", { ok: true })
              } catch {
                socket.emit("cmd_ack", { ok: false })
              }
              return
            }

            if (body.action === "delete_light") {
              // Expect: { action:"delete_light", name }
              const name = String(body.name || "").trim()
              if (!name) { socket.emit("cmd_ack", { ok: false, error: "invalid_delete_light" }); return }
              try {
                const col = await getCollection("lights")
                await col.deleteOne({ name })
                // Broadcast merged status to UI immediately
                try {
                  const merged = await buildMergedStatus()
                  io.emit("status", merged)
                } catch {}
                try {
                  const msg = JSON.stringify({ type: "cmd", payload: { action: "reload_lights" } })
                  global.wsInstance?.clients.forEach((ws) => { if (ws.readyState === WebSocket.OPEN) ws.send(msg) })
                } catch {}
                socket.emit("cmd_ack", { ok: true })
              } catch {
                socket.emit("cmd_ack", { ok: false })
              }
              return
            }
            // Non-catalog commands
            // Persist schedule changes
            if (body.action === "schedule") {
              const room = String(body.room || "").trim()
              const on = typeof body.on === "string" ? body.on : "00:00"
              const off = typeof body.off === "string" ? body.off : "00:00"
              const enabled = !!body.enabled
              if (room) {
                try {
                  const col = await getCollection("lights")
                  await col.updateOne({ name: room }, { $set: { name: room, on, off, scheduleEnabled: enabled, updatedAt: Date.now() } }, { upsert: true })
                  // Emit merged status so UI updates immediately
                  try {
                    const merged = await buildMergedStatus()
                    io.emit("status", merged)
                  } catch {}
                } catch {}
              }
            }
            if (body.action === "schedule_multi") {
              // Expect: { action:"schedule_multi", room, enabled, intervals: [{on,off}, ...] }
              const room = String(body.room || "").trim()
              const enabled = !!body.enabled
              const intervals = Array.isArray(body.intervals) ? body.intervals : []
              const parseHM = (s: string) => {
                const m = /^([0-2]?\d):(\d{2})$/.exec(String(s || "00:00"))
                if (!m) return null; const hh = Math.min(23, Math.max(0, parseInt(m[1]||"0",10))); const mm = Math.min(59, Math.max(0, parseInt(m[2]||"0",10))); return hh*60+mm;
              }
              const normSegs = (onM: number, offM: number) => offM >= onM ? [[onM, offM]] : [[onM, 1440],[0, offM]]
              // Validate
              const segs: Array<{on:number,off:number}> = []
              for (const it of intervals) {
                const a = parseHM(it?.on); const b = parseHM(it?.off);
                if (a === null || b === null || a === b) { socket.emit("cmd_ack", { ok: false, error: "invalid_interval" }); return }
                segs.push({ on: a, off: b })
              }
              // Check overlaps
              const expanded: Array<[number,number]> = []
              for (const s of segs) for (const seg of normSegs(s.on, s.off)) expanded.push(seg as [number,number])
              for (let i=0;i<expanded.length;i++) for (let j=i+1;j<expanded.length;j++) {
                const [s1,e1] = expanded[i], [s2,e2] = expanded[j]
                if (Math.max(s1,s2) < Math.min(e1,e2)) { socket.emit("cmd_ack", { ok: false, error: "interval_overlap" }); return }
              }
              try {
                const col = await getCollection("lights")
                const first = segs[0] || { on: 0, off: 0 }
                const toHM = (m:number) => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`
                const on = toHM(first.on); const off = toHM(first.off)
                await col.updateOne({ name: room }, { $set: { name: room, scheduleEnabled: enabled, schedules: intervals, on, off, updatedAt: Date.now() } }, { upsert: true })
                try {
                  const merged = await buildMergedStatus()
                  io.emit("status", merged)
                } catch {}
                socket.emit("cmd_ack", { ok: true })
              } catch {
                socket.emit("cmd_ack", { ok: false })
              }
              return
            }
            store.enqueueCmd(body)
            try {
              const msg = JSON.stringify({ type: "cmd", payload: body })
              global.wsInstance?.clients.forEach((ws) => { if (ws.readyState === WebSocket.OPEN) ws.send(msg) })
            } catch {}
            // Optionally acknowledge
            socket.emit("cmd_ack", { ok: true })
          } catch {}
        })

        socket.on("disconnect", (reason) => {
          console.log("[socket.io] client disconnected", { id: socket.id, reason })
        })
      })
      global.ioConnectionHandlerBound = true
    }

    // Initialize plain WebSocket server (for ESP32)
    if (!global.wsInstance) {
      const wss = new WebSocketServer({ noServer: true })
      console.log("[ws] raw WebSocket server initialized at /api/ws")
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
              console.warn("[ws] upgrade rejected: invalid token", { tokenPresent: !!token })
              socket.destroy()
              return
            }
            console.log("[ws] upgrade accepted", { ip: req.socket?.remoteAddress })
            wss.handleUpgrade(req, socket, head, (ws) => {
              wss.emit("connection", ws, req)
            })
          } catch {
            console.error("[ws] upgrade error")
            try { socket.destroy() } catch {}
          }
        })
        ;(server as any)._wsUpgraded = true
      }

      wss.on("connection", (ws) => {
        console.log("[ws] device connected", { clients: wss.clients.size })
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
              console.log("[ws] status received from device")
              store.setStatus(obj.payload)
            } else if (obj?.type === "cmd" && obj.payload) {
              console.log("[ws] cmd received from device", obj.payload)
              const body = obj.payload
              store.enqueueCmd(body)
            }
          } catch {}
        })

        ws.on("close", () => {
          console.log("[ws] device disconnected", { clients: wss.clients.size })
        })
      })
      global.wsInstance = wss
    }
  }

  res.end()
}

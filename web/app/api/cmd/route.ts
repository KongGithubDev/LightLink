import { NextRequest, NextResponse } from "next/server"
import { getStore, type DeviceStatus } from "@/lib/serverStore"

function authorize(req: NextRequest) {
  const token = process.env.LIGHTLINK_TOKEN || process.env.NEXT_PUBLIC_LIGHTLINK_TOKEN || "devtoken"
  const hdr = req.headers.get("authorization") || ""
  return hdr === `Bearer ${token}`
}

function isMock() {
  return (process.env.LIGHTLINK_MOCK === "1" || process.env.NEXT_PUBLIC_LIGHTLINK_MOCK === "1")
}

function isSameOrigin(req: NextRequest) {
  const ref = req.headers.get("referer") || ""
  try {
    return new URL(ref).origin === new URL(req.url).origin
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    // allow same-origin without Authorization only in MOCK mode
    if (!(isMock() && isSameOrigin(req))) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    }
  }
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "invalid_json" }, { status: 400 })

  // Accept actions similar to previous MQTT commands
  // { action: "set"|"toggle"|"schedule"|"get_status", ... }
  const store = getStore()
  if (body.action === "get_status") {
    return NextResponse.json(store.getStatus() || { device: "unknown", lights: [] })
  }
  if (isMock()) {
    // simulate applying command to device state
    const cur = (store.getStatus() || { device: "mock-lightlink", lights: [], updatedAt: Date.now() }) as DeviceStatus
    // ensure default lights exist in mock
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
        cur.lights = cur.lights.map((l) => ({ ...l, state: hasState ? !!body.state : !l.state }))
      } else {
        cur.lights = cur.lights.map((l) => (l.name === body.target ? { ...l, state: hasState ? !!body.state : !l.state } : l))
      }
    }
    if (body.action === "schedule") {
      cur.lights = cur.lights.map((l) =>
        l.name === body.room ? { ...l, on: body.on, off: body.off, scheduleEnabled: !!body.enabled } : l,
      )
    }
    cur.updatedAt = Date.now()
    store.setStatus(cur)
  } else {
    store.enqueueCmd(body)
  }
  return NextResponse.json({ ok: true })
}

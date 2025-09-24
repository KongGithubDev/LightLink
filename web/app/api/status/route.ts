import { NextRequest, NextResponse } from "next/server"
import { getStore, type DeviceStatus } from "@/lib/serverStore"
import { getCollection } from "@/lib/mongo"

function authorize(req: NextRequest) {
  const token = process.env.LIGHTLINK_TOKEN || process.env.NEXT_PUBLIC_LIGHTLINK_TOKEN || "devtoken"
  const hdr = req.headers.get("authorization") || ""
  return hdr === `Bearer ${token}`
}

function isMock() {
  return (process.env.LIGHTLINK_MOCK === "1" || process.env.NEXT_PUBLIC_LIGHTLINK_MOCK === "1")
}

function isSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin") || ""
  try {
    if (origin) return origin === new URL(req.url).origin
  } catch {}
  const ref = req.headers.get("referer") || ""
  try {
    return new URL(ref).origin === new URL(req.url).origin
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  if (!authorize(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const status = (await req.json().catch(() => null)) as DeviceStatus | null
  if (!status || !Array.isArray(status.lights)) return NextResponse.json({ error: "bad_status" }, { status: 400 })

  getStore().setStatus(status)
  return NextResponse.json({ ok: true })
}

export async function GET(req: NextRequest) {
  if (!isMock() && !authorize(req) && !isSameOrigin(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const store = getStore()
  let cur = store.getStatus()
  if (!cur && isMock()) {
    const mock: DeviceStatus = {
      device: "mock-lightlink",
      lights: [
        { name: "kitchen", state: false, on: "18:00", off: "23:00", scheduleEnabled: false },
        { name: "living", state: false, on: "18:00", off: "23:00", scheduleEnabled: false },
        { name: "bedroom", state: false, on: "21:00", off: "07:00", scheduleEnabled: false },
      ],
      updatedAt: Date.now(),
    }
    store.setStatus(mock)
    cur = mock
  }
  // Merge DB lights catalog so the UI can display/manage lights even if the device hasn't posted yet
  try {
    const col = await getCollection("lights")
    const catalog = await col.find({}, { projection: { _id: 0 } }).toArray()
    const byName = new Map<string, any>()
    const merged = { device: cur?.device || "unknown", lights: [] as any[], updatedAt: cur?.updatedAt || Date.now() }
    for (const l of cur?.lights || []) {
      byName.set(l.name, { ...l })
    }
    for (const c of catalog) {
      const existing = byName.get(c.name)
      if (existing) {
        // fill schedule fields from device first, otherwise keep DB defaults
        merged.lights.push({
          name: existing.name,
          state: !!existing.state,
          on: (existing as any).on ?? c.on ?? "00:00",
          off: (existing as any).off ?? c.off ?? "00:00",
          scheduleEnabled: typeof (existing as any).scheduleEnabled === "boolean" ? (existing as any).scheduleEnabled : !!c.scheduleEnabled,
        })
      } else {
        merged.lights.push({
          name: c.name,
          state: false,
          on: c.on || "00:00",
          off: c.off || "00:00",
          scheduleEnabled: !!c.scheduleEnabled,
        })
      }
    }
    // Include any device lights that are not in DB as well
    for (const l of cur?.lights || []) {
      if (!catalog.find((c: any) => c.name === l.name)) {
        merged.lights.push(l)
      }
    }
    return NextResponse.json(merged)
  } catch {
    // If DB fails, return current store status
    return NextResponse.json(cur || { device: "unknown", lights: [] })
  }
}

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
  return NextResponse.json(cur || { device: "unknown", lights: [] })
}

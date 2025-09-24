import { NextRequest, NextResponse } from "next/server"
import { getStore } from "@/lib/serverStore"

function authorize(req: NextRequest) {
  const token = process.env.LIGHTLINK_TOKEN || process.env.NEXT_PUBLIC_LIGHTLINK_TOKEN || "devtoken"
  const hdr = req.headers.get("authorization") || ""
  return hdr === `Bearer ${token}`
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
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "invalid_json" }, { status: 400 })

  // Accept actions similar to previous MQTT commands
  // { action: "set"|"toggle"|"schedule"|"get_status", ... }
  const store = getStore()
  if (body.action === "get_status") {
    return NextResponse.json(store.getStatus() || { device: "unknown", lights: [] })
  }
  store.enqueueCmd(body)
  return NextResponse.json({ ok: true })
}

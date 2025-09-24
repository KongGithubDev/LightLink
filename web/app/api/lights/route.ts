import { NextRequest, NextResponse } from "next/server"
import { getCollection } from "@/lib/mongo"

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

export async function GET(req: NextRequest) {
  // Allow same-origin reads without auth; otherwise require token
  if (!isSameOrigin(req) && !authorize(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const col = await getCollection("lights")
  const docs = await col.find({}, { projection: { _id: 0 } }).toArray()
  return NextResponse.json({ lights: docs })
}

export async function POST(req: NextRequest) {
  if (!authorize(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body || typeof body.name !== "string") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 })
  }
  const name = String(body.name).trim()
  const pin = Number(body.pin)
  const on = typeof body.on === "string" ? body.on : "00:00"
  const off = typeof body.off === "string" ? body.off : "00:00"
  const scheduleEnabled = !!body.scheduleEnabled
  if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 })
  const allowedPins = new Set([19, 21, 22, 23])
  if (!Number.isInteger(pin) || !allowedPins.has(pin))
    return NextResponse.json({ error: "invalid_pin", allowed: [19,21,22,23] }, { status: 400 })

  const col = await getCollection("lights")
  const existing = await col.findOne({ name })
  if (existing) return NextResponse.json({ error: "name_exists" }, { status: 409 })

  const doc = { name, pin, on, off, scheduleEnabled, createdAt: Date.now() }
  await col.insertOne(doc)
  return NextResponse.json({ ok: true, light: doc })
}

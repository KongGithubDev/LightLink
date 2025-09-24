import { NextRequest, NextResponse } from "next/server"
import { getCollection } from "@/lib/mongo"

function authorize(req: NextRequest) {
  const token = process.env.LIGHTLINK_TOKEN || process.env.NEXT_PUBLIC_LIGHTLINK_TOKEN || "devtoken"
  const hdr = req.headers.get("authorization") || ""
  return hdr === `Bearer ${token}`
}

export async function PATCH(req: NextRequest, { params }: { params: { name: string } }) {
  if (!authorize(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const name = decodeURIComponent(params.name)
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "invalid_json" }, { status: 400 })

  const update: any = {}
  if (typeof body.pin === "number") {
    const allowedPins = new Set([19, 21, 22, 23])
    if (!Number.isInteger(body.pin) || !allowedPins.has(body.pin)) {
      return NextResponse.json({ error: "invalid_pin", allowed: [19,21,22,23] }, { status: 400 })
    }
    update.pin = body.pin
  }
  if (typeof body.on === "string") update.on = body.on
  if (typeof body.off === "string") update.off = body.off
  if (typeof body.scheduleEnabled === "boolean") update.scheduleEnabled = body.scheduleEnabled

  if (Object.keys(update).length === 0) return NextResponse.json({ error: "no_updates" }, { status: 400 })

  const col = await getCollection("lights")
  const res = await col.findOneAndUpdate({ name }, { $set: update }, { projection: { _id: 0 }, returnDocument: "after" })
  if (!res) return NextResponse.json({ error: "not_found" }, { status: 404 })
  return NextResponse.json({ ok: true, light: res })
}

export async function DELETE(req: NextRequest, { params }: { params: { name: string } }) {
  if (!authorize(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const name = decodeURIComponent(params.name)
  const col = await getCollection("lights")
  const res = await col.deleteOne({ name })
  if (res.deletedCount === 0) return NextResponse.json({ error: "not_found" }, { status: 404 })
  return NextResponse.json({ ok: true })
}

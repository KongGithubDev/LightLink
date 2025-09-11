import { NextResponse } from "next/server"

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "lightlink-web",
    env: process.env.NODE_ENV,
    mock: process.env.LIGHTLINK_MOCK === "1" || process.env.NEXT_PUBLIC_LIGHTLINK_MOCK === "1",
    time: Date.now(),
  })
}

export async function HEAD() {
  return new Response(null, { status: 200 })
}

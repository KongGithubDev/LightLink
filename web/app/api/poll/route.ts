import { NextRequest, NextResponse } from "next/server"
import { getStore } from "@/lib/serverStore"

function authorize(req: NextRequest) {
  const token = process.env.LIGHTLINK_TOKEN || process.env.NEXT_PUBLIC_LIGHTLINK_TOKEN || "devtoken"
  const hdr = req.headers.get("authorization") || ""
  return hdr === `Bearer ${token}`
}

export async function GET(req: NextRequest) {
  if (!authorize(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const cmds = getStore().drainCmds()
  return NextResponse.json({ cmds })
}

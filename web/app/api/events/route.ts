import { NextRequest } from "next/server"
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

export async function GET(req: NextRequest) {
  if (!authorize(req) && !isSameOrigin(req)) {
    return new Response("unauthorized", { status: 401 })
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      const send = (data: string) => controller.enqueue(encoder.encode(data))

      // subscribe
      const store = getStore()
      store.subscribe(send)

      // send initial ping to open stream
      send(`event: ping\ndata: ok\n\n`)

      // heartbeat every 25s
      const hb = setInterval(() => {
        try { send(`event: ping\ndata: ${Date.now()}\n\n`) } catch {}
      }, 25000)

      const close = () => {
        clearInterval(hb)
        store.unsubscribe(send)
        try { controller.close() } catch {}
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}

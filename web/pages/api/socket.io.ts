import type { NextApiRequest, NextApiResponse } from "next"
import { Server as IOServer } from "socket.io"
import { getStore } from "@/lib/serverStore"

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

    const store = getStore()
    if (!global.ioStoreSubscribed) {
      store.subscribe((data: string) => {
        try {
          // SSE-style string: "data: {json}\n\n"
          const jsonLine = data.replace(/^data:\s*/, "").trim()
          const obj = JSON.parse(jsonLine)
          if (obj?.type === "status") {
            io.emit("status", obj.payload)
          }
        } catch {}
      })
      global.ioStoreSubscribed = true
    }

    if (!global.ioConnectionHandlerBound) {
      io.on("connection", (socket) => {
        try {
          const cur = store.getStatus()
          if (cur) socket.emit("status", cur)
        } catch {}
      })
      global.ioConnectionHandlerBound = true
    }
  }

  res.end()
}

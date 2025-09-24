"use client"

import { Clock, Home } from "lucide-react"
import RoomLightControls from "./room-light-controls"
import LightScheduler from "./light-scheduler"
import { useEffect, useRef, useState } from "react"
import { io, Socket } from "socket.io-client"

export default function Content() {
  type ConnState = "connected" | "connecting" | "disconnected"
  const [state, setState] = useState<ConnState>("connecting")
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    const socket: Socket = io(undefined, { path: "/api/socket.io", transports: ["websocket", "polling"] })
    socketRef.current = socket
    const onConnect = () => setState("connected")
    const onDisconnect = () => setState("disconnected")
    const onError = () => setState((s) => (s === "connected" ? "connected" : "disconnected"))
    setState("connecting")
    socket.on("connect", onConnect)
    socket.on("disconnect", onDisconnect)
    socket.on("connect_error", onError)
    return () => {
      socket.off("connect", onConnect)
      socket.off("disconnect", onDisconnect)
      socket.off("connect_error", onError)
      socket.close()
      socketRef.current = null
    }
  }, [])

  const isReady = state === "connected"
  return (
    <div className="relative">
      {/* Overlay messages */}
      {!isReady && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <div className={`px-4 py-2 rounded-md text-sm ${state === 'connecting' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-700'}`}>
            {state === "connecting" ? "Connecting..." : "Offline"}
          </div>
        </div>
      )}

      {/* Blurred content until connected */}
      <div className={`${isReady ? '' : 'blur-sm pointer-events-none select-none'} space-y-4`}>
        <div className="bg-white dark:bg-[#0F0F12] rounded-xl p-4 sm:p-6 flex flex-col border border-gray-200 dark:border-[#1F1F23]">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4 text-left flex items-center gap-2">
            <Home className="w-3.5 h-3.5 text-zinc-900 dark:text-zinc-50" />
            Room Lighting Control
          </h2>
          <div className="flex-1">
            <RoomLightControls className="h-full" />
          </div>
        </div>

        <div className="bg-white dark:bg-[#0F0F12] rounded-xl p-4 sm:p-6 flex flex-col items-start justify-start border border-gray-200 dark:border-[#1F1F23]">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4 text-left flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-zinc-900 dark:text-zinc-50" />
            Light Scheduling
          </h2>
          <LightScheduler />
        </div>
      </div>
    </div>
  )
}

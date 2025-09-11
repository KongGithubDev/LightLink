"use client"

import { useEffect, useState } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Wifi, WifiOff, Activity, Server } from "lucide-react"
import { cn } from "@/lib/utils"
import { getStatus } from "@/lib/api"
import { io, Socket } from "socket.io-client"

interface Props { className?: string }

type ConnState = "connected" | "disconnected" | "connecting"

export default function ServerStatus({ className }: Props) {
  const [state, setState] = useState<ConnState>("connecting")
  const [lastUpdate, setLastUpdate] = useState<string>("-")
  const [lightsCount, setLightsCount] = useState<number>(0)

  const refresh = async () => {
    try {
      const data = await getStatus()
      setLightsCount(Array.isArray(data?.lights) ? data.lights.length : 0)
      setLastUpdate(new Date().toLocaleTimeString())
    } catch {}
  }

  useEffect(() => {
    refresh()
    const socket: Socket = io(undefined, { path: "/api/socket.io", transports: ["websocket", "polling"] })
    const onStatus = (payload: any) => {
      setLightsCount(Array.isArray(payload?.lights) ? payload.lights.length : 0)
      setLastUpdate(new Date().toLocaleTimeString())
      setState("connected")
    }
    const onConnect = () => setState("connected")
    const onDisconnect = () => setState("disconnected")
    socket.on("status", onStatus)
    socket.on("connect", onConnect)
    socket.on("disconnect", onDisconnect)
    return () => {
      socket.off("status", onStatus)
      socket.off("connect", onConnect)
      socket.off("disconnect", onDisconnect)
      socket.close()
    }
  }, [])

  const getStatusColor = () => {
    switch (state) {
      case "connected": return "bg-green-500"
      case "connecting": return "bg-yellow-500"
      case "disconnected": return "bg-red-500"
    }
  }

  const getStatusIcon = () => {
    switch (state) {
      case "connected": return <Wifi className="w-4 h-4" />
      case "connecting": return <Activity className="w-4 h-4 animate-pulse" />
      case "disconnected": return <WifiOff className="w-4 h-4" />
    }
  }

  return (
    <div className={cn("space-y-4", className)}>
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {getStatusIcon()}
            <span className="font-medium text-sm">Server Status</span>
          </div>
          <Badge variant={state === "connected" ? "default" : "secondary"}>{state}</Badge>
        </div>

        <div className="space-y-2 text-xs text-muted-foreground">
          <div className="flex justify-between">
            <span>Lights Known:</span>
            <span className="font-mono">{lightsCount}</span>
          </div>
          <div className="flex justify-between">
            <span>Last Update:</span>
            <span>{lastUpdate}</span>
          </div>
        </div>

        <Button variant="outline" size="sm" onClick={refresh} className="w-full mt-3 text-xs bg-transparent">
          Refresh
        </Button>
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Server className="w-4 h-4" />
          <span className="font-medium text-sm">Endpoints</span>
        </div>
        <div className="space-y-2 text-xs text-muted-foreground">
          <div className="flex justify-between"><span>GET</span><span className="font-mono">/api/status</span></div>
          <div className="flex justify-between"><span>POST</span><span className="font-mono">/api/status</span></div>
          <div className="flex justify-between"><span>GET</span><span className="font-mono">/api/poll</span></div>
          <div className="flex justify-between"><span>POST</span><span className="font-mono">/api/cmd</span></div>
        </div>
      </Card>
    </div>
  )
}

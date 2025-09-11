"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Lightbulb, LightbulbOff } from "lucide-react"
import { cn } from "@/lib/utils"
import { getStatus, sendCommand } from "@/lib/api"
import { io, Socket } from "socket.io-client"

interface UILight {
  id: string // device name (e.g., "kitchen")
  label: string // pretty label
  isOn: boolean
}

interface RoomLightControlsProps {
  className?: string
}

export default function RoomLightControls({ className }: RoomLightControlsProps) {
  const [lights, setLights] = useState<Record<string, UILight>>({})
  const [logLines, setLogLines] = useState<string[]>([])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const socketRef = useRef<Socket | null>(null)
  const wsConnectedRef = useRef(false)

  const pushLog = (msg: string) => {
    const t = new Date().toLocaleTimeString()
    setLogLines((prev) => [`[${t}] ${msg}`, ...prev.slice(0, 19)])
  }

  const refresh = async () => {
    try {
      const data = await getStatus()
      if (Array.isArray(data?.lights)) {
        const next: Record<string, UILight> = {}
        ;(data.lights as any[]).forEach((l) => {
          const id = String(l.name)
          next[id] = { id, label: prettyLabel(id), isOn: !!l.state }
        })
        setLights(next)
      }
    } catch (e) {
      pushLog(`status error`)
    }
  }

  useEffect(() => {
    // helpers
    const startPolling = () => {
      if (pollRef.current) return
      pollRef.current = setInterval(refresh, 2000)
      pushLog("polling: /api/status")
    }
    const stopPolling = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
        pushLog("polling stopped")
      }
    }

    // initial fetch
    refresh()

    // attempt websocket
    const socket: Socket = io(undefined, { path: "/api/socket.io", transports: ["websocket", "polling"] })
    socketRef.current = socket

    const onStatus = (payload: any) => {
      if (Array.isArray(payload?.lights)) {
        const next: Record<string, UILight> = {}
        ;(payload.lights as any[]).forEach((l) => {
          const id = String(l.name)
          next[id] = { id, label: prettyLabel(id), isOn: !!l.state }
        })
        setLights(next)
      }
    }
    const onConnect = () => {
      wsConnectedRef.current = true
      pushLog("ws connected")
      stopPolling()
    }
    const onDisconnect = () => {
      wsConnectedRef.current = false
      pushLog("ws disconnected -> fallback polling")
      startPolling()
    }
    const onError = () => {
      if (!wsConnectedRef.current) {
        pushLog("ws error -> start polling")
        startPolling()
      }
    }

    socket.on("connect", onConnect)
    socket.on("disconnect", onDisconnect)
    socket.on("connect_error", onError)
    socket.on("status", onStatus)

    // safety timeout: if not connected within 4s, start polling
    const t = setTimeout(() => {
      if (!wsConnectedRef.current) startPolling()
    }, 4000)

    return () => {
      clearTimeout(t)
      stopPolling()
      socket.off("connect", onConnect)
      socket.off("disconnect", onDisconnect)
      socket.off("connect_error", onError)
      socket.off("status", onStatus)
      socket.close()
      socketRef.current = null
    }
  }, [])

  const toggleLight = async (id: string, newState: boolean) => {
    setLights((prev) => ({ ...prev, [id]: { ...prev[id], isOn: newState } }))
    await sendCommand({ action: "set", target: id, state: newState })
    pushLog(`cmd set ${id} -> ${newState}`)
    // server will be polled to confirm
  }

  const toggleAll = async () => {
    const allOn = Object.values(lights).every((l) => l.isOn)
    await sendCommand({ action: "set", target: "all", state: !allOn })
    pushLog(`cmd set all -> ${!allOn}`)
    refresh()
  }

  const onCount = Object.values(lights).filter((l) => l.isOn).length
  const total = Object.keys(lights).length

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex justify-between items-center mb-4">
        <span className="text-sm text-muted-foreground">
          {onCount} of {total} lights on
        </span>
        <Button variant="outline" size="sm" onClick={toggleAll} className="text-xs bg-transparent">
          Toggle All
        </Button>
      </div>

      <div className="space-y-3">
        {Object.values(lights).map((room) => (
          <Card key={room.id} className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {room.isOn ? (
                  <Lightbulb className="w-4 h-4 text-yellow-400" />
                ) : (
                  <LightbulbOff className="w-4 h-4 text-muted-foreground" />
                )}
                <span className="font-medium text-sm">{room.label}</span>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={room.isOn} onCheckedChange={(v) => toggleLight(room.id, v)} />
              </div>
            </div>
          </Card>
        ))}
        {total === 0 && (
          <Card className="p-4 text-sm text-muted-foreground">Waiting for device status...</Card>
        )}
      </div>

      {logLines.length > 0 && (
        <div className="mt-4 p-3 bg-muted rounded-lg">
          <h4 className="text-xs font-medium mb-2">Recent Server Logs</h4>
          <div className="space-y-1">
            {logLines.slice(0, 5).map((msg, index) => (
              <div key={index} className="text-xs font-mono text-muted-foreground">
                {msg}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function prettyLabel(id: string) {
  const map: Record<string, string> = {
    kitchen: "Kitchen",
    living: "Living Room",
    bedroom: "Bedroom",
  }
  return map[id] || id
}

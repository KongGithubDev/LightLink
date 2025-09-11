"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Clock } from "lucide-react"
import { getStatus, sendCommand } from "@/lib/api"
import { io, Socket } from "socket.io-client"

type DeviceLight = {
  name: string
  state: boolean
  on?: string
  off?: string
  scheduleEnabled?: boolean
}

export default function LightScheduler() {
  const [lights, setLights] = useState<Record<string, DeviceLight>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const socketRef = useRef<Socket | null>(null)
  const wsConnectedRef = useRef(false)

  const refresh = async () => {
    try {
      const data = await getStatus()
      if (Array.isArray(data?.lights)) {
        const next: Record<string, DeviceLight> = {}
        ;(data.lights as any[]).forEach((l) => {
          const id = String(l.name)
          next[id] = {
            name: id,
            state: !!l.state,
            on: l.on,
            off: l.off,
            scheduleEnabled: !!l.scheduleEnabled,
          }
        })
        setLights(next)
      }
    } catch {}
  }

  useEffect(() => {
    const startPolling = () => {
      if (pollRef.current) return
      pollRef.current = setInterval(refresh, 3000)
    }
    const stopPolling = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }

    // initial load
    refresh()

    // connect websocket
    const socket: Socket = io(undefined, { path: "/api/socket.io", transports: ["websocket", "polling"] })
    socketRef.current = socket
    const onStatus = (payload: any) => {
      if (Array.isArray(payload?.lights)) {
        const next: Record<string, DeviceLight> = {}
        ;(payload.lights as any[]).forEach((l) => {
          const id = String(l.name)
          next[id] = {
            name: id,
            state: !!l.state,
            on: l.on,
            off: l.off,
            scheduleEnabled: !!l.scheduleEnabled,
          }
        })
        setLights(next)
      }
    }
    const onConnect = () => {
      wsConnectedRef.current = true
      stopPolling()
    }
    const onDisconnect = () => {
      wsConnectedRef.current = false
      startPolling()
    }
    const onError = () => {
      if (!wsConnectedRef.current) startPolling()
    }

    socket.on("connect", onConnect)
    socket.on("disconnect", onDisconnect)
    socket.on("connect_error", onError)
    socket.on("status", onStatus)

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

  const setLightField = (id: string, field: keyof DeviceLight, value: any) => {
    setLights((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
  }

  const saveSchedule = async (id: string) => {
    const L = lights[id]
    if (!L) return
    setSaving((s) => ({ ...s, [id]: true }))
    try {
      const payload = {
        action: "schedule",
        room: id,
        on: L.on || "00:00",
        off: L.off || "00:00",
        enabled: !!L.scheduleEnabled,
      }
      await sendCommand(payload)
      await refresh()
    } finally {
      setTimeout(() => setSaving((s) => ({ ...s, [id]: false })), 500)
    }
  }

  const entries = Object.values(lights)

  return (
    <div className="w-full space-y-3">
      {entries.length === 0 && (
        <Card className="p-4 text-sm text-muted-foreground">Waiting for device status...</Card>
      )}

      {entries.map((l) => (
        <Card key={l.name} className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              <span className="font-medium text-sm">{prettyLabel(l.name)} Schedule</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Enabled</span>
              <Switch
                checked={!!l.scheduleEnabled}
                onCheckedChange={(v) => setLightField(l.name, "scheduleEnabled", v)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">On Time</Label>
              <Input
                type="time"
                value={l.on || "00:00"}
                onChange={(e) => setLightField(l.name, "on", e.target.value)}
                className="text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Off Time</Label>
              <Input
                type="time"
                value={l.off || "00:00"}
                onChange={(e) => setLightField(l.name, "off", e.target.value)}
                className="text-sm"
              />
            </div>
            <div className="flex items-end">
              <Button onClick={() => saveSchedule(l.name)} disabled={!!saving[l.name]} className="text-sm w-full">
                {saving[l.name] ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </Card>
      ))}
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

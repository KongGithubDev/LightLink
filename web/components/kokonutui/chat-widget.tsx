"use client"

import { useEffect, useRef, useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { io, Socket } from "socket.io-client"

interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

export default function ChatWidget() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "สวัสดี" },
    { role: "assistant", content: "สวัสดีค่ะ! มีอะไรให้ฉันช่วยเหลือเกี่ยวกับระบบ LightLink ไหมคะ? 😊" },
  ])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const socketRef = useRef<Socket | null>(null)
  const [deviceReady, setDeviceReady] = useState<boolean>(false)

  useEffect(() => {
    const socket: Socket = io(undefined, { path: "/api/socket.io", transports: ["websocket", "polling"] })
    socketRef.current = socket
    const onStatus = (payload: any) => {
      if (payload && typeof payload.deviceConnected === 'boolean') setDeviceReady(!!payload.deviceConnected)
    }
    socket.on("status", onStatus)
    return () => {
      socket.off("status", onStatus)
      socket.close(); socketRef.current = null
    }
  }, [])

  const append = (m: ChatMessage) => setMessages((prev) => [...prev, m])

  async function send() {
    const text = input.trim()
    if (!text) return
    setInput("")
    append({ role: "user", content: text })
    setBusy(true)
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: messages }),
      })
      const data = await res.json()
      if (!res.ok) {
        append({ role: "assistant", content: `ขอโทษค่ะ มีข้อผิดพลาดจากเซิร์ฟเวอร์ (${data?.error || res.status})` })
        return
      }
      // Perform intent if present; if executed, suppress Chatbase reply to avoid duplicates
      let executed = false
      if (data?.intent && typeof data.intent === "object") {
        executed = executeIntent(data.intent)
      }
      if (!executed && data?.reply) {
        append({ role: "assistant", content: String(data.reply) })
      }
    } catch (e: any) {
      append({ role: "assistant", content: `ขอโทษค่ะ ส่งข้อความไม่สำเร็จ: ${String(e?.message || e)}` })
    } finally {
      setBusy(false)
    }
  }

  function executeIntent(intent: any): boolean {
    const s = socketRef.current
    if (!s) return false
    const type = String(intent?.type || "")
    const allowedPins = new Set([19, 21, 22, 23])
    if (type === "create") {
      const name = String(intent?.name || "").trim()
      const pin = Number(intent?.pin)
      if (!name || !Number.isInteger(pin)) { append({ role: "assistant", content: "โปรดระบุชื่อไฟและ PIN ที่ถูกต้อง (เช่น: add light tester pin 23)" }); return false }
      if (!allowedPins.has(pin)) {
        append({ role: "assistant", content: `ขออภัยค่ะ PIN ${pin} ไม่สามารถใช้งานได้ กรุณาเลือก PIN ที่ใช้งานได้คือ 19, 21, 22 หรือ 23 ค่ะ 😊` })
        return false
      }
      const onT = typeof intent?.on === 'string' ? intent.on : "18:00"
      const offT = typeof intent?.off === 'string' ? intent.off : "23:00"
      const scheduleEnabled = typeof intent?.on === 'string' && typeof intent?.off === 'string'
      s.emit("cmd", { action: "add_light", name, pin, on: onT, off: offT, scheduleEnabled })
      try { s.emit("cmd", { action: "get_status" }) } catch {}
      // Always follow training spec verification line
      const cmd = `CREATED LIGHT NAME ${name.toUpperCase()} PIN ${pin} SCHEDULE ${onT}-${offT} ENABLED ${scheduleEnabled}`
      append({ role: "assistant", content: cmd })
      return true
    }
    if (type === "delete") {
      const name = String(intent?.name || "").trim()
      const pin = intent?.pin !== undefined ? Number(intent.pin) : undefined
      if (!name) { append({ role: "assistant", content: "โปรดระบุชื่อไฟที่จะลบค่ะ เช่น \"ลบไฟ kitchen\" 😊" }); return false }
      s.emit("cmd", { action: "delete_light", name })
      try { s.emit("cmd", { action: "get_status" }) } catch {}
      const cmd = `DELETED LIGHT NAME ${name.toUpperCase()}`
      append({ role: "assistant", content: cmd })
      return true
    }
    if (type === "toggle") {
      const name = intent?.name ? String(intent.name).trim() : undefined
      const pin = Number(intent?.pin)
      const state = !!intent?.state
      if (Number.isInteger(pin)) {
        s.emit("cmd", { action: "set_pin", pin, state })
        try { s.emit("cmd", { action: "get_status" }) } catch {}
        const cmd = state ? `TURN ON LIGHT PIN ${pin}` : `TURN OFF LIGHT PIN ${pin}`
        append({ role: "assistant", content: cmd })
        // also send by name if provided
        if (name) s.emit("cmd", { action: "set", target: name, state })
        return true
      }
      if (name) {
        s.emit("cmd", { action: "set", target: name, state })
        try { s.emit("cmd", { action: "get_status" }) } catch {}
        const cmd = state ? `TURN ON LIGHT NAME ${name.toUpperCase()}` : `TURN OFF LIGHT NAME ${name.toUpperCase()}`
        append({ role: "assistant", content: cmd })
        return true
      }
      append({ role: "assistant", content: "โปรดระบุชื่อไฟหรือ PIN (เช่น: turn on tester หรือ turn off pin 23)" })
      return false
    }
    return false
  }

  return (
    <Card className="p-3 sm:p-4">
      <div className="font-medium text-sm mb-2">AI Chat</div>
      <div className="h-56 sm:h-64 overflow-y-auto rounded-md border bg-background p-2 space-y-2 text-sm">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
            <div className={`inline-block px-2 py-1 rounded-md ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
              {m.content}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="พิมพ์สั่งงาน เช่น: เปิด tester หรือ add light kitchen pin 22" onKeyDown={(e) => { if (e.key === "Enter") send() }} />
        <Button onClick={send} disabled={busy || !input.trim()}>Send</Button>
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">รองรับ: create/delete light, turn on/off โดยระบุชื่อหรือ PIN</div>
    </Card>
  )
}

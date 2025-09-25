import { NextRequest, NextResponse } from "next/server"

// Minimal Chatbase proxy with graceful fallback when not configured.
// Env required:
// - CHATBASE_API_KEY
// - CHATBASE_BOT_ID
// Optional:
// - CHATBASE_API_URL (default: https://www.chatbase.co/api/v1/chat)

export async function POST(req: NextRequest) {
  const { message, history } = await req.json().catch(() => ({ message: "", history: [] }))
  if (!message || typeof message !== "string") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 })
  }

  const key = process.env.CHATBASE_API_KEY
  const botId = process.env.CHATBASE_BOT_ID
  const apiUrl = process.env.CHATBASE_API_URL || "https://www.chatbase.co/api/v1/chat"

  if (!key || !botId) {
    // Fallback local echo and naive intent detection on server when Chatbase is not configured
    const intent = extractIntent(message)
    return NextResponse.json({ reply: `Chatbase not configured. Local intent parsed: ${intent.type}`, intent })
  }

  try {
    const payload: any = {
      chatbotId: botId,
      stream: false,
      // messages in OpenAI-like shape
      messages: [
        ...(Array.isArray(history) ? history : []).filter((m: any) => m && typeof m.role === "string" && typeof m.content === "string"),
        { role: "user", content: message },
      ],
    }
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      return NextResponse.json({ error: "chatbase_error", status: res.status, body: text.slice(0, 500) }, { status: 502 })
    }
    const data = await res.json().catch(() => ({}))
    // Chatbase typical field: data.text or data.message; support both
    const reply = data?.text || data?.message || ""
    // Also provide naive server-side intent so client can act immediately
    const intent = extractIntent(message)
    return NextResponse.json({ reply, intent })
  } catch (err: any) {
    return NextResponse.json({ error: "proxy_failed", message: String(err?.message || err) }, { status: 500 })
  }
}

// Very simple rule-based intent extraction to cover core commands
function extractIntent(input: string): { type: string; name?: string; pin?: number; state?: boolean } {
  const s = (input || "").toLowerCase()
  // English captures
  const nameMatchEn = /(?:light|room|name)\s*([a-z0-9_-]{1,32})/i.exec(input)
  const pinMatchCommon = /(pin|พิน)\s*(\d{1,2})/i.exec(input)
  const turnOnEn = /(turn\s*on|switch\s*on|open|start|enable)/i.test(input)
  const turnOffEn = /(turn\s*off|switch\s*off|close|stop|disable)/i.test(input)
  const createEn = /(create|add)\s+(light|room)/i.test(s)
  const delEn = /(delete|remove)\s+(light|room)/i.test(s)

  // Thai captures
  const turnOnTh = /(เปิด(ไฟ)?)/i.test(input)
  // Avoid matching 'ปิด' inside 'เปิด' by requiring no leading 'เ'
  const turnOffTh = /(?<!เ)ปิด(ไฟ)?/i.test(input)
  const createTh = /(สร้าง|เพิ่ม)\s*(ไฟ|ห้อง)?/i.test(input)
  const delTh = /(ลบ|ลบไฟ|เอาออก)\s*(ไฟ|ห้อง)?/i.test(input)
  const nameMatchTh = /ไฟ\s*([a-zA-Z0-9_-]{1,32})/i.exec(input)

  const name = nameMatchEn?.[1] || nameMatchTh?.[1]
  const pin = pinMatchCommon ? Number(pinMatchCommon[2]) : undefined
  const turnOn = turnOnEn || turnOnTh
  const turnOff = turnOffEn || turnOffTh
  const create = createEn || createTh
  const del = delEn || delTh

  if (create) {
    return { type: "create", name: name, pin }
  }
  if (del) {
    return { type: "delete", name: name }
  }
  if (turnOn || turnOff) {
    const state = !!turnOn && !turnOff
    return { type: "toggle", state, name, pin }
  }
  return { type: "chat" }
}

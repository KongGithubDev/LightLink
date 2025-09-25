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
    // Try to parse UPPERCASE command lines from reply for execution.
    // Support multi-line: collect actionable lines in order.
    const lines = String(reply || "").split(/\r?\n/)
    const intentsFromReply: ReturnType<typeof parseIntentFromTokens>[] = []
    for (const line of lines) {
      const cand = parseIntentFromTokens(line)
      if (cand) intentsFromReply.push(cand)
    }
    // Fallback: parse from user's message if none found in reply
    const fallback = intentsFromReply.length === 0 ? parseIntentFromTokens(message) : null
    const intent: any = intentsFromReply.length > 0 ? intentsFromReply : fallback
    return NextResponse.json({ reply, intent })
  } catch (err: any) {
    return NextResponse.json({ error: "proxy_failed", message: String(err?.message || err) }, { status: 500 })
  }
}

// Token-based parser (no regex) for core commands. Supports both EN and TH keywords.
function parseIntentFromTokens(text: string): { type: string; name?: string; pin?: number; state?: boolean; on?: string; off?: string } | null {
  if (!text || typeof text !== "string") return null
  const norm = (text || "").trim()
  if (!norm) return null
  // Normalize: remove punctuation into spaces, uppercase for compare
  const cleaned = norm
    .replace(/[\t\r\n]/g, " ")
    // keep ':' and '-' to preserve time ranges like 06:00 - 20:00
    .replace(/[.,;!?#()[\]{}<>_/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  const upper = cleaned.toUpperCase()
  const tokens = upper.split(" ")
  const rawTokens = cleaned.split(" ") // keep original-case-ish for names

  const has = (...keys: string[]) => keys.every(k => tokens.includes(k))
  const findIndex = (key: string) => tokens.findIndex(t => t === key)

  // TURN ON LIGHT PIN 19 / TURN OFF LIGHT PIN 19
  if (tokens[0] === "TURN" && tokens[1] === "ON" && tokens.includes("PIN")) {
    const pIdx = findIndex("PIN")
    const v = Number(tokens[pIdx + 1])
    if (Number.isFinite(v)) return { type: "toggle", pin: v, state: true }
  }
  if (tokens[0] === "TURN" && tokens[1] === "OFF" && tokens.includes("PIN")) {
    const pIdx = findIndex("PIN")
    const v = Number(tokens[pIdx + 1])
    if (Number.isFinite(v)) return { type: "toggle", pin: v, state: false }
  }

  // Thai: เปิด/ปิด PIN 19
  if ((tokens[0] === "เปิด" || tokens[0] === "ปิด") && (tokens[1] === "PIN" || tokens[1] === "พิน")) {
    const v = Number(tokens[2])
    if (Number.isFinite(v)) return { type: "toggle", pin: v, state: tokens[0] === "เปิด" }
  }

  // CREATE/CREATED LIGHT NAME <name> PIN <n> [ON 06:00 - 20:00]
  if (tokens[0] === "CREATE" || tokens[0] === "CREATED" || tokens[0] === "ADD" || tokens[0] === "สร้าง" || tokens[0] === "เพิ่ม") {
    // name is the token after LIGHT (optional) and before PIN
    let name: string | undefined
    const lightIdx = findIndex("LIGHT")
    const nameIdx = tokens.findIndex(t => t === "NAME")
    const pinIdx = tokens.findIndex(t => t === "PIN" || t === "พิน")
    if (pinIdx > 0) {
      if (nameIdx >= 0 && pinIdx - nameIdx >= 2) name = rawTokens[nameIdx + 1]
      else if (lightIdx >= 0 && pinIdx - lightIdx >= 2) name = rawTokens[lightIdx + 1]
      else if (lightIdx < 0 && nameIdx < 0 && pinIdx >= 1) name = rawTokens[1]
      const v = Number(tokens[pinIdx + 1])
      // Optional time range after PIN: look for 'ON' token
      let on: string | undefined
      let off: string | undefined
      const onIdx = findIndex("ON")
      const isHM = (s: string) => /\d{1,2}:\d{2}/.test(s)
      if (onIdx >= 0 && rawTokens[onIdx + 1]) {
        const t1 = rawTokens[onIdx + 1]
        const t2 = rawTokens[onIdx + 2] === '-' ? rawTokens[onIdx + 3] : rawTokens[onIdx + 2]
        if (t1 && isHM(t1) && t2 && isHM(t2)) { on = t1; off = t2 }
      }
      if (name && Number.isFinite(v)) return { type: "create", name, pin: v, ...(on && off ? { on, off } : {}) }
    }
  }

  // DELETE LIGHT kitchen / ลบ ไฟ kitchen
  if (tokens[0] === "DELETE" || tokens[0] === "DELETED" || tokens[0] === "REMOVE" || tokens[0] === "ลบ" || tokens[0] === "เอาออก") {
    const nameIdx = tokens.findIndex(t => t === "NAME")
    const lightIdx = findIndex("LIGHT")
    if (nameIdx >= 0 && rawTokens[nameIdx + 1]) return { type: "delete", name: rawTokens[nameIdx + 1] }
    if (lightIdx >= 0 && rawTokens[lightIdx + 1]) return { type: "delete", name: rawTokens[lightIdx + 1] }
    if (rawTokens[1]) return { type: "delete", name: rawTokens[1] }
  }

  // TURN ON tester / TURN OFF kitchen
  if (tokens[0] === "TURN" && (tokens[1] === "ON" || tokens[1] === "OFF") && rawTokens[2]) {
    return { type: "toggle", name: rawTokens[2], state: tokens[1] === "ON" }
  }

  // Thai: เปิด tester / ปิด kitchen
  if ((tokens[0] === "เปิด" || tokens[0] === "ปิด") && rawTokens[1]) {
    return { type: "toggle", name: rawTokens[1], state: tokens[0] === "เปิด" }
  }

  // SCHEDULE LIGHT NAME <name> <on>-<off>
  if (tokens[0] === "SCHEDULE" && tokens[1] === "LIGHT") {
    let name: string | undefined
    const nameIdx = tokens.findIndex(t => t === "NAME")
    if (nameIdx >= 0 && rawTokens[nameIdx + 1]) name = rawTokens[nameIdx + 1]
    // find any token that looks like HH:MM and the next (or +2 if '-')
    const isHM = (s: string) => /\d{1,2}:\d{2}/.test(s)
    let on: string | undefined
    let off: string | undefined
    for (let i = nameIdx + 2; i < rawTokens.length; i++) {
      const t1 = rawTokens[i]
      const t2 = rawTokens[i + 1]
      const t3 = rawTokens[i + 2]
      if (t1 && isHM(t1)) {
        if (t2 === '-' && t3 && isHM(t3)) { on = t1; off = t3; break }
        if (t2 && isHM(t2)) { on = t1; off = t2; break }
      }
    }
    if (name && on && off) return { type: "schedule", name, on, off }
  }

  return null
}

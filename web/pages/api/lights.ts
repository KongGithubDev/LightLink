import type { NextApiRequest, NextApiResponse } from "next"
import { getCollection } from "@/lib/mongo"

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]) 
    return res.status(405).json({ error: "method_not_allowed" })
  }
  try {
    // Simple bearer token check to match device
    const auth = req.headers["authorization"] || ""
    const token = (process.env.LIGHTLINK_TOKEN || "KongPassword@")
    if (!auth.toString().startsWith("Bearer ") || auth.toString().slice(7) !== token) {
      return res.status(401).json({ error: "unauthorized" })
    }

    const col = await getCollection("lights")
    const docs = await col.find({}, { projection: { _id: 0 } }).toArray()
    // Normalize response fields for device
    const lights = (docs || []).map((d: any) => ({
      name: d.name,
      pin: d.pin,
      on: d.on || "00:00",
      off: d.off || "00:00",
      scheduleEnabled: !!d.scheduleEnabled,
    }))
    return res.status(200).json({ lights })
  } catch (err) {
    return res.status(500).json({ error: "server_error" })
  }
}

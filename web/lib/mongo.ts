import { MongoClient, Db } from "mongodb"

let client: MongoClient | null = null
let db: Db | null = null

export async function getDb(): Promise<Db> {
  if (db) return db
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error("MONGODB_URI is not set")
  const dbName = process.env.MONGODB_DB || "lightlink"
  if (!client) {
    client = new MongoClient(uri)
  }
  if (!client.topology?.isConnected()) {
    await client.connect()
  }
  db = client.db(dbName)
  return db
}

export async function getCollection<T = any>(name: string) {
  const database = await getDb()
  return database.collection<T>(name)
}

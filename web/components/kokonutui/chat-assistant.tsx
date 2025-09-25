"use client"

import { useState } from "react"
import ChatWidget from "./chat-widget"
import { Button } from "@/components/ui/button"

export default function ChatAssistant() {
  const [open, setOpen] = useState(false)
  return (
    <>
      {/* Floating button */}
      <div className="fixed bottom-4 right-4 z-40">
        <Button size="sm" onClick={() => setOpen(true)} className="shadow-lg">AI Assistant</Button>
      </div>

      {/* Simple modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative z-10 w-[96%] max-w-lg mx-auto">
            <div className="rounded-xl overflow-hidden border border-border bg-background">
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <div className="font-medium">AI Assistant</div>
                <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Close</Button>
              </div>
              <div className="p-3 sm:p-4">
                <ChatWidget />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

import { Clock, Home } from "lucide-react"
import RoomLightControls from "./room-light-controls"
import LightScheduler from "./light-scheduler"

export default function () {
  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-[#0F0F12] rounded-xl p-6 flex flex-col border border-gray-200 dark:border-[#1F1F23]">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4 text-left flex items-center gap-2">
          <Home className="w-3.5 h-3.5 text-zinc-900 dark:text-zinc-50" />
          Room Lighting Control
        </h2>
        <div className="flex-1">
          <RoomLightControls className="h-full" />
        </div>
      </div>

      <div className="bg-white dark:bg-[#0F0F12] rounded-xl p-6 flex flex-col items-start justify-start border border-gray-200 dark:border-[#1F1F23]">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4 text-left flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-zinc-900 dark:text-zinc-50" />
          Light Scheduling
        </h2>
        <LightScheduler />
      </div>
    </div>
  )
}

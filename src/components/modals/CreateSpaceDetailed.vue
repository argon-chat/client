<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="sm:max-w-[720px] rounded-2xl p-0 
             bg-gradient-to-br from-black/90 via-zinc-900/90 to-black/90 backdrop-blur-2xl flex flex-col"
    >
      <!-- Header -->
      <div class="p-6 text-center shrink-0">
        <h2 class="text-3xl font-extrabold text-white tracking-wide">
          {{ t("choose_server_type") }}
        </h2>
        <p class="text-gray-400 text-sm">
          Pick the type of server that fits your needs ⚡
        </p>
      </div>

      <!-- Tabs -->
      <div class="flex flex-col flex-1 overflow-hidden px-6 pb-6">
        <div class="flex justify-center mb-6 border-b border-white/10">
          <button
            v-for="s in serverTypes"
            :key="s.key"
            @click="active = s.key"
            class="px-4 py-2 text-sm font-medium transition-colors"
            :class="active === s.key 
              ? 'text-blue-400 border-b-2 border-blue-500' 
              : 'text-gray-400 hover:text-white'"
          >
            {{ s.name }}
          </button>
        </div>

        <!-- Active Tab Content -->
        <div class="flex-1 overflow-y-auto">
          <div
            v-if="activeServer"
            class="min-h-[720px] max-w-3xl mx-auto rounded-2xl border border-white/10 bg-zinc-900/70 p-8 space-y-6"
          >
            <div class="text-center space-y-2">
              <h3 class="text-2xl font-bold text-white">{{ activeServer.name }}</h3>
              <p class="text-gray-400 text-sm">{{ activeServer.limits }}</p>
            </div>

            <!-- Features -->
            <div class="grid grid-cols-2 gap-6 text-sm">
              <!-- Pluses -->
              <div>
                <h4 class="font-semibold text-green-400 mb-2 flex items-center gap-2">
                  <span class="i-lucide-check-circle"></span> Features
                </h4>
                <ul class="space-y-2">
                  <li
                    v-for="p in activeServer.features.filter(f => f.good)"
                    :key="p.text"
                    class="flex items-center gap-2"
                  >
                    <span class="i-lucide-plus text-green-400" />
                    <span>{{ p.text }}</span>
                  </li>
                </ul>
              </div>

              <!-- Minuses -->
              <div>
                <h4 class="font-semibold text-red-400 mb-2 flex items-center gap-2">
                  <span class="i-lucide-x-circle"></span> Limitations
                </h4>
                <ul class="space-y-2">
                  <li
                    v-for="m in activeServer.features.filter(f => !f.good)"
                    :key="m.text"
                    class="flex items-center gap-2"
                  >
                    <span class="i-lucide-minus text-red-400" />
                    <span>{{ m.text }}</span>
                  </li>
                </ul>
              </div>
            </div>

            <!-- Action -->
            <div class="pt-6">
              <Button
                v-if="activeServer.redirect"
                class="w-full bg-purple-600 hover:bg-purple-500 text-white rounded-xl"
                @click.stop="redirectEnterprise"
              >
                <span class="i-lucide-external-link mr-2"></span>
                {{ t("enterprise_only") }}
              </Button>
              <Button
                v-else
                class="w-full bg-blue-600 hover:bg-blue-500 text-white rounded-xl"
                @click.stop="selectType(activeServer.key)"
              >
                <span class="i-lucide-check mr-2"></span>
                {{ t("choose") }}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import { Dialog, DialogContent } from "@argon/ui/dialog"
import { Button } from "@argon/ui/button"
import { useLocale } from "@/store/localeStore"

const { t } = useLocale()
const open = defineModel<boolean>("open", { type: Boolean, default: false })

const active = ref("local")

function selectType(type: string) {
  console.log("Selected:", type)
  open.value = false
}
function redirectEnterprise() {
  window.open("https://your-enterprise-landing.com", "_blank")
}

const serverTypes = [
  {
    "key": "local",
    "name": "Local",
    "limits": "Up to 100 users",
    "features": [
      { "text": "Private, invite-only", "good": true },
      { "text": "Minimal moderation tools", "good": true },
      { "text": "Custom emojis support", "good": true },
      { "text": "No public search or discovery", "good": false },
      { "text": "Limited growth (100 users max)", "good": false }
    ]
  },
   {
    "key": "class",
    "name": "Class",
    "limits": "Up to 50 users",
    "features": [
      { "text": "Teacher tools (polls, quizzes)", "good": true },
      { "text": "Role separation: Teacher/Student", "good": true },
      { "text": "Mute-all / Quiet mode for lessons", "good": true },
      { "text": "Support for class diary (homework, grades)", "good": true },
      { "text": "Schedule management (lessons, reminders)", "good": true },
      { "text": "Shared file storage for study materials", "good": true },
      { "text": "Small group size (50 users max)", "good": false },
      { "text": "Channel limit (20 channels)", "good": false },
      { "text": "Limited external integrations", "good": false }
    ]
  },
  {
    "key": "work",
    "name": "Workplace",
    "limits": "Enterprise only",
    "redirect": true,
    "features": [
      { "text": "Business workflows", "good": true },
      { "text": "Integrations with team tools", "good": true },
      { "text": "Advanced roles & permissions", "good": true },
      { "text": "Enterprise subscription required", "good": false },
      { "text": "Not available in free version", "good": false }
    ]
  },
  {
    "key": "community",
    "name": "Community",
    "limits": "Unlimited users",
    "features": [
      { "text": "Public discoverability & promotion", "good": true },
      { "text": "Unlimited members", "good": true },
      { "text": "Bots and role management", "good": true },
      { "text": "Requires constant moderation", "good": false },
      { "text": "Risk of spam/raids", "good": false }
    ]
  },
  {
    "key": "creator",
    "name": "Creator / Fanbase",
    "limits": "Unlimited (1 per creator)",
    "features": [
      { "text": "Verified creator badge", "good": true },
      { "text": "Dedicated announcement channel", "good": true },
      { "text": "Monetization (donations, paid roles)", "good": true },
      { "text": "Only one server allowed per creator", "good": false },
      { "text": "Requires identity verification", "good": false }
    ]
  }
]


const activeServer = computed(() => serverTypes.find(s => s.key === active.value))
</script>

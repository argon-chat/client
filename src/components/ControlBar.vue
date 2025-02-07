<template>
    <div class="relative min-w-[280px]" style="z-index: 1; padding-bottom: 10px;" v-if="me.me">
        <div class="control-bar">
            <div class="controls">
                <button v-if="voice.isConnected" @click="voice.disconnectFromChannel()" class="active">
                    <PhoneOffIcon class="w-5 h-5" />
                </button>
                <button @click="sys.toggleMicrophoneMute" :class="{ active: sys.microphoneMuted }">
                    <MicOff v-if="sys.microphoneMuted" class="w-5 h-5" />
                    <Mic v-else class="w-5 h-5" />
                </button>
                <button @click="sys.toggleHeadphoneMute" :class="{ active: sys.headphoneMuted }">
                    <HeadphoneOff v-if="sys.headphoneMuted" class="w-5 h-5" />
                    <Headphones v-else class="w-5 h-5" />
                </button>
                <button @click="voice.startScreenShare">
                    <ScreenShareOff v-if="voice.isSharing" class="w-5 h-5" />
                    <ScreenShare v-else class="w-5 h-5" />
                </button>
                <button @click="windows.settingsOpen = true">
                    <Settings2Icon class="w-5 h-5" />
                </button>
            </div>
        </div>
        <div>
            <div v-show="voice.isConnected || voice.isBeginConnect" v-motion-slide-visible-bottom
                class="connection-card absolute text-white rounded-t-lg p-3 shadow-2xl flex flex-col items-center z-[-1]"
                style="bottom: 100%; margin-bottom: -5px;">
                <div class="flex items-center space-x-2">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger as-child>
                                <div>
                                    <Signal class="w-4 h-4 text-green-500" v-if="voice.qualityConnection == 'GREEN'" />
                                    <Signal class="w-4 h-4 text-orange-500"
                                        v-else-if="voice.qualityConnection == 'ORANGE'" />
                                    <Signal class="w-4 h-4 text-red-500" v-else-if="voice.qualityConnection == 'RED'" />
                                    <Signal class="w-4 h-4 text-gray-500" v-else />
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p v-if="voice.isConnected">{{ voice.ping }}</p>
                                <p v-if="voice.isBeginConnect">??? ms</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                    <span class="font-semibold">{{ voice.activeChannel?.Name }}</span>
                </div>
                <span v-if="voice.isConnected" class="text-timer text-[#a2a6a8]">{{ sessionTimerStore.sessionTimer
                    }}</span>
                <span class="text-xs text-lime-400 mt-1"
                    v-if="voice.isConnected && !voice.currentlyReconnect">Connected</span>
                <span class="text-xs text-orange-400 mt-1"
                    v-if="voice.isBeginConnect && !voice.currentlyReconnect">Connecting...</span>
                <span class="text-xs text-orange-400 mt-1" v-if="voice.currentlyReconnect">Reconnect...</span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Mic, MicOff, HeadphoneOff, Headphones, Signal, PhoneOffIcon, ScreenShareOff, ScreenShare, Settings2Icon } from 'lucide-vue-next';

import { useMe } from "@/store/meStore";
import { useSystemStore } from "@/store/systemStore";
import { useVoice } from "@/store/voiceStore";
import { useSessionTimer } from '@/store/sessionTimer'
import { useWindow } from "@/store/windowStore";

const me = useMe();
const sys = useSystemStore();
const voice = useVoice();
const sessionTimerStore = useSessionTimer()
const windows = useWindow();
</script>

<style scoped>

.control-bar {
    background-color: #2f3136;
    border-radius: 15px;
    padding: 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    position: relative;
}

.bad {
    color: #f04747;
}

.moderate {
    color: #f0d747
}

.good {
    color: #43b581;
}

.online {
    color: #43b581;
}

.away {
    color: #276e9e;
}

.ingame {
    color: #279e3b;
}

.offline {
    color: #635d5d;
}

.donotdisturb {
    color: #f04747;
}

.listen {
    color: #279e3b;
}

.touchgrass {
    color: #90279e;
}

.controls button {
    background: none;
    border: none;
    color: #fff;
    font-size: 16px;
    cursor: pointer;
    margin-left: 5px;
    transition: color 0.3s;
    margin: 5px;
}

.controls {
    justify-content: center;
    display: flex;
    gap: 10px;
    flex: auto;
}

.controls button:hover {
    color: #5865f2;
}

.controls button.active {
    color: #f04747;
}

.connection-card {
    background-color: #414242;
    text-align: center;
    margin-bottom: -5px;
    left: 10%;
    bottom: 100%;
    width: calc(100% - 50px);
}
</style>
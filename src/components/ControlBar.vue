<template>
    <div class="relative" style="z-index: 1; padding-bottom: 10px;" v-if="me.me">
        <div class="control-bar">
            <div class="controls">
                <button :disabled="!voice.isConnected" @click="voice.disconnectFromChannel()" class="active">
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
                <Dialog>
                    <DialogTrigger as-child>
                        <button @click="openShareSettings = true" :class="{ active: voice.isSharing }">
                            <ScreenShareOff v-if="voice.isSharing" class="w-5 h-5" />
                            <ScreenShare v-else class="w-5 h-5" />
                        </button>
                    </DialogTrigger>
                    <DialogContent class="sm:max-w-md">
                        <Tabs default-value="monitors">
                            <TabsList class="w-full flex">
                                <TabsTrigger value="monitors" class="flex-1">Мониторы</TabsTrigger>
                                <TabsTrigger value="windows" class="flex-1">Окна</TabsTrigger>
                            </TabsList>

                            <TabsContent value="monitors" class="mt-4">
                                <div class="h-40 flex items-center justify-center bg-gray-200 rounded-lg">
                                    <span class="text-gray-500">Превью мониторов</span>
                                </div>
                                <div class="mt-4">
                                    <Label class="text-sm">Качество</Label>
                                    <Select v-model="quality">
                                        <SelectTrigger>
                                            <SelectValue placeholder="Выберите качество" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="low">Низкое</SelectItem>
                                            <SelectItem value="medium">Среднее</SelectItem>
                                            <SelectItem value="high">Высокое</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    
                                </div>
                                <div class="mt-4 flex items-center gap-2">
                                        <Switch v-model="includeAudio" />
                                        <Label>Включить системный звук</Label>
                                    </div>
                            </TabsContent>

                            <TabsContent value="windows" class="mt-4">
                                <div class="h-40 flex items-center justify-center bg-gray-200 rounded-lg">
                                    <span class="text-gray-500">Превью окон</span>
                                </div>
                                <div class="mt-4 flex items-center gap-2">
                                    <Switch v-model="includeAudio" />
                                    <Label>Включить системный звук</Label>
                                </div>
                            </TabsContent>
                        </Tabs>
                        <DialogFooter class="sm:justify-start">
                            <DialogClose as-child>
                                <Button type="button" variant="secondary">
                                    Close
                                </Button>
                            </DialogClose>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
                <button :disabled="true">
                    <TicketPercent class="w-5 h-5" />
                </button>
            </div>
        </div>
        <div>
            <div v-show="voice.isConnected || voice.isBeginConnect" v-motion-slide-visible-bottom
                class="connection-card absolute text-white rounded-t-lg p-3 shadow-2xl flex flex-col items-center z-[-1] "
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
import { Mic, MicOff, HeadphoneOff, Headphones, Signal, PhoneOffIcon, ScreenShareOff, ScreenShare, TicketPercent } from 'lucide-vue-next';

import { useMe } from "@/store/meStore";
import { useSystemStore } from "@/store/systemStore";
import { useVoice } from "@/store/voiceStore";
import { useSessionTimer } from '@/store/sessionTimer'
import { useWindow } from "@/store/windowStore";
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogClose,
} from '@/components/ui/dialog'
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from '@/components/ui/tabs'
import { ref } from "vue";

const me = useMe();
const sys = useSystemStore();
const voice = useVoice();
const sessionTimerStore = useSessionTimer();
const window = useWindow();

const openShareSettings = ref(false);
const includeAudio = ref(false);
const quality = ref("");

async function toggleShare() {
    if (!voice.isConnected)
        return;
    if (voice.isOtherUserSharing)
        return;

    if (voice.isSharing)
        voice.stopScreenShare();
    else
        await voice.startScreenShare();
}

</script>

<style scoped>
.control-bar {
    background-color: #161616;
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

.controls button:disabled {
    color: #4d4c4c;
    cursor: not-allowed;
}

.connection-card {
    background-color: #272626;
    text-align: center;
    margin-bottom: -5px;
    left: 10%;
    bottom: 100%;
    width: calc(100% - 50px);
}
</style>
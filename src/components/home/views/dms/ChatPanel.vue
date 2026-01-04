<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, toRef } from "vue";
import { usePoolStore } from "@/store/poolStore";
import SmartArgonAvatar from "@/components/SmartArgonAvatar.vue";
import { useUnifiedCall } from "@/store/unifiedCallStore";
import { PhPhoneDisconnect } from "@phosphor-icons/vue";
import { HeadphoneOffIcon, MicOffIcon, MaximizeIcon, Minimize2Icon } from "lucide-vue-next";
import { useSystemStore } from "@/store/systemStore";

const emit = defineEmits<{ (e: "end"): void }>();

const dm = useUnifiedCall();
const pool = usePoolStore();
const sys = useSystemStore();

const videoRefs = ref(new Map<string, HTMLVideoElement>());
const isFullscreen = ref(false);
const focusedUserId = ref<string | null>(null);

function setVideoRef(el: any, userId: string) {
    if (!el) {
        const old = videoRefs.value.get(userId);
        const track = dm.videoTracks.get(userId);
        if (old && track) track.detach(old);
        videoRefs.value.delete(userId);
        return;
    }
    if (el instanceof HTMLVideoElement) {
        videoRefs.value.set(userId, el);
        const track = dm.videoTracks.get(userId);
        if (track) track.attach(el);
    }
}

const participants = computed(() => {
    const arr: Array<{ userId: string; displayName: string; muted: boolean; mutedAll: boolean; screencase: boolean; }> = [];

    const r = dm.room;
    if (r && r.localParticipant) {
        const uid = r.localParticipant.identity;
        const u = pool.getUserReactive(toRef(uid));

        arr.push({
            userId: uid,
            displayName: u?.value?.displayName ?? "You",
            muted: sys.microphoneMuted,
            mutedAll: sys.headphoneMuted,
            screencase: false
        });
    }

    for (const [uid, data] of dm.participants) {
        const u = pool.getUserReactive(toRef(uid));

        arr.push({
            userId: uid,
            displayName: u?.value?.displayName ?? data.displayName,
            muted: data.muted,
            mutedAll: data.mutedAll,
            screencase: data.screencast
        });
    }

    return arr;
});

const activeStream = computed(() => {
    if (focusedUserId.value) {
        const participant = participants.value.find(p => p.userId === focusedUserId.value);
        if (participant) return participant;
    }
    return participants.value.find(p => p.screencase);
});

const otherParticipants = computed(() => {
    if (!activeStream.value) return participants.value;
    return participants.value.filter(p => p.userId !== activeStream.value!.userId);
});

const hasActiveStream = computed(() => !!activeStream.value);

const panelHeight = computed(() => {
    if (isFullscreen.value) return '100vh';
    return hasActiveStream.value ? '500px' : '320px';
});

const speakingRingClass = 'ring-2 ring-lime-400/80 shadow-[0_0_15px_rgba(132,255,90,0.3)]';
const mutedIconClass = 'text-red-400 drop-shadow-[0_0_4px_rgba(255,0,0,0.6)]';

function toggleFocus(userId: string) {
    if (focusedUserId.value === userId) {
        focusedUserId.value = null;
    } else {
        focusedUserId.value = userId;
    }
}

function toggleFullscreen() {
    isFullscreen.value = !isFullscreen.value;
}

function isSpeaking(uid: string) {
    return dm.speaking.has(uid);
}
function hasVideo(uid: string) {
    return dm.videoTracks.has(uid);
}

onUnmounted(() => {
    for (const [uid, el] of videoRefs.value) {
        const t = dm.videoTracks.get(uid);
        if (t) t.detach(el);
    }
    videoRefs.value.clear();
});
</script>

<template>
    <div class="flex flex-col bg-card border border-border rounded-xl p-4 mb-3 select-none transition-all duration-300"
        :class="isFullscreen ? 'fixed inset-0 z-50 m-0 rounded-none' : ''"
        :style="{ height: panelHeight }">

        <div v-if="hasActiveStream && activeStream" class="flex gap-3 flex-1 overflow-hidden">
            <div class="flex-1 relative rounded-xl overflow-hidden bg-card border border-border flex items-center justify-center group">
                <video v-if="activeStream && hasVideo(activeStream.userId)" 
                    :ref="el => activeStream && setVideoRef(el, activeStream.userId)"
                    autoplay playsinline class="w-full h-full object-contain" />

                <SmartArgonAvatar v-else-if="activeStream" :user-id="activeStream.userId" :overrided-size="120"
                    class="transition-transform duration-200 group-hover:scale-110" />

                <div v-if="activeStream" class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-background/70 to-transparent py-2 px-3">
                    <span class="text-foreground font-semibold">
                        {{ activeStream.displayName }}
                        <span v-if="activeStream.screencase" class="text-xs text-lime-400 ml-2">📺 Sharing screen</span>
                    </span>
                </div>

                <div class="absolute top-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button @click="toggleFullscreen"
                        class="p-2 rounded-lg bg-muted border border-border hover:bg-accent text-foreground transition-colors">
                        <MaximizeIcon v-if="!isFullscreen" :size="20" />
                        <Minimize2Icon v-else :size="20" />
                    </button>
                </div>

                <div v-if="activeStream" class="absolute top-2 left-2 flex gap-2">
                    <MicOffIcon v-if="activeStream.muted" width="24" height="24" :class="mutedIconClass" />
                    <HeadphoneOffIcon v-if="activeStream.mutedAll" width="24" height="24" :class="mutedIconClass" />
                </div>
            </div>

            <div class="flex flex-col gap-2 overflow-y-auto w-[200px]">
                <div v-for="p in otherParticipants" :key="p.userId"
                    class="relative rounded-xl overflow-hidden bg-card border border-border flex items-center justify-center group transition-all cursor-pointer h-[120px] min-h-[120px]"
                    :class="{ [speakingRingClass]: isSpeaking(p.userId) }" @click="toggleFocus(p.userId)">
                    <video v-if="hasVideo(p.userId)" :ref="el => setVideoRef(el, p.userId)" autoplay playsinline
                        class="w-full h-full object-cover" />

                    <SmartArgonAvatar v-else :user-id="p.userId" :overrided-size="60"
                        class="transition-transform duration-200 group-hover:scale-110" />

                    <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-background/70 to-transparent py-1 px-2">
                        <span class="text-foreground font-semibold text-xs truncate block">{{ p.displayName }}</span>
                    </div>

                    <div class="absolute top-1 right-1 flex gap-1">
                        <MicOffIcon v-if="p.muted" width="18" height="18" :class="mutedIconClass" />
                        <HeadphoneOffIcon v-if="p.mutedAll" width="18" height="18" :class="mutedIconClass" />
                    </div>
                </div>
            </div>
        </div>

        <div v-else class="grid gap-3 flex-1 overflow-hidden"
            :class="{
                'grid-cols-1': participants.length === 1,
                'grid-cols-2': participants.length >= 2 && participants.length <= 4,
                'grid-cols-3': participants.length > 4
            }">
            <div v-for="p in participants" :key="p.userId"
                class="relative rounded-xl overflow-hidden bg-card border border-border flex items-center justify-center group transition-all cursor-pointer max-h-full min-h-[120px]"
                :class="{ 'ring-2 ring-lime-400/80 shadow-[0_0_20px_rgba(132,255,90,0.3)] scale-[1.02]': isSpeaking(p.userId) }" 
                @click="toggleFocus(p.userId)">
                <video v-if="hasVideo(p.userId)" :ref="el => setVideoRef(el, p.userId)" autoplay playsinline
                    class="w-full h-full object-cover" />

                <SmartArgonAvatar v-else :user-id="p.userId" :overrided-size="80"
                    class="transition-transform duration-200 group-hover:scale-110" />

                <div class="absolute bottom-0 left-0 right-0 text-center bg-gradient-to-t from-background/70 to-transparent py-1">
                    <span class="text-foreground font-semibold text-sm">{{ p.displayName }}</span>
                </div>

                <div class="absolute top-2 right-2 flex gap-2">
                    <MicOffIcon v-if="p.muted" width="24" height="24" :class="mutedIconClass" />
                    <HeadphoneOffIcon v-if="p.mutedAll" width="24" height="24" :class="mutedIconClass" />
                </div>
            </div>
        </div>

        <div class="flex justify-center mt-3 gap-3">
            <button @click="$emit('end')"
                class="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-full font-semibold shadow-lg">
                <PhPhoneDisconnect width="24" height="24" />
            </button>
        </div>
    </div>
</template>

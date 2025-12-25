<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, toRef } from "vue";
import { usePoolStore } from "@/store/poolStore";
import SmartArgonAvatar from "@/components/SmartArgonAvatar.vue";
import { useUnifiedCall } from "@/store/unifiedCallStore";
import { PhPhoneDisconnect } from "@phosphor-icons/vue";
import { HeadphoneOffIcon, MicOffIcon } from "lucide-vue-next";
import { useSystemStore } from "@/store/systemStore";

const emit = defineEmits<{ (e: "end"): void }>();

const dm = useUnifiedCall();
const pool = usePoolStore();
const sys = useSystemStore();

const videoRefs = ref(new Map<string, HTMLVideoElement>());

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

function isSpeaking(uid: string) {
    return dm.speaking.has(uid);
}
function hasVideo(uid: string) {
    return dm.videoTracks.has(uid);
}

const gridClass = computed(() => {
    const n = participants.value.length;
    if (n <= 1) return "grid-cols-1";
    if (n === 2) return "grid-cols-2";
    if (n <= 4) return "grid-cols-2";
    return "grid-cols-3";
});

onMounted(() => {
    /*dm.onVideoCreated.add(({ userId, track }) => {
        const el = videoRefs.value.get(userId);
        if (el) track.attach(el);
    });

    dm.onVideoDestroyed.add(({ userId, track }) => {
        const el = videoRefs.value.get(userId);
        if (el) track.detach(el);
        videoRefs.value.delete(userId);
    });*/
});

onUnmounted(() => {
    for (const [uid, el] of videoRefs.value) {
        const t = dm.videoTracks.get(uid);
        if (t) t.detach(el);
    }
    videoRefs.value.clear();
});
</script>

<template>
    <div class="flex flex-col bg-[#0f0f0f]/90 backdrop-blur-md rounded-xl p-4 mb-3 select-none" style="height: 320px;">
        <div class="grid gap-3 flex-1 overflow-hidden" :class="gridClass">
            <div v-for="p in participants" :key="p.userId"
                class="relative rounded-xl overflow-hidden bg-black/60 flex items-center justify-center group transition-all m-3"
                :class="{
                    'ring-2 ring-lime-400/80 shadow-[0_0_20px_rgba(132,255,90,0.3)] scale-[1.02]': isSpeaking(p.userId),
                }" style="max-height: 100%; min-height: 120px;">
                <video v-if="hasVideo(p.userId)" :ref="el => setVideoRef(el, p.userId)" autoplay playsinline
                    class="w-full h-full object-cover" />

                <SmartArgonAvatar v-else :user-id="p.userId" :overrided-size="80"
                    class="transition-transform duration-200 group-hover:scale-110" />

                <div
                    class="absolute bottom-0 left-0 right-0 text-center bg-gradient-to-t from-black/70 to-transparent py-1">
                    <span class="text-white font-semibold text-sm">
                        {{ p.displayName }}
                    </span>
                </div>

                <div class="absolute top-2 right-2 flex gap-2">
                    <MicOffIcon v-if="p.muted" width="24" height="24"
                        class="text-red-400 drop-shadow-[0_0_4px_rgba(255,0,0,0.6)]" />
                    <HeadphoneOffIcon v-if="p.mutedAll" width="24" height="24"
                        class="text-red-400 drop-shadow-[0_0_4px_rgba(255,0,0,0.6)]" />
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

<script setup lang="ts">
import SmartArgonAvatar from "@/components/SmartArgonAvatar.vue";
import { RealtimeUser } from "@/store/db/dexie";
import { usePoolStore } from "@/store/poolStore";
import { IconPhone, IconVideo, IconUser } from "@tabler/icons-vue";
import { onMounted, ref } from "vue";

const pool = usePoolStore();

const props = defineProps({
    userId: { type: String, required: true }
});

const user = ref(null as RealtimeUser | null);

const emit = defineEmits<{
    (e: "call"): void;
    (e: "videoCall"): void;
    (e: "toggleProfile"): void;
}>();

onMounted(async () => {
    user.value = (await pool.getUser(props.userId)) ?? null;
})

</script>

<template>
    <div class="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div class="flex items-center gap-3">
            <div
                class="w-10 h-10 rounded-full overflow-hidden bg-neutral-800 flex items-center justify-center text-white font-semibold">
                <SmartArgonAvatar :user-id="userId" />
            </div>

            <div class="font-bold text-lg">
                {{ user?.displayName }}
            </div>
        </div>

        <div class="flex items-center gap-3">
            <button class="p-2 rounded-full bg-neutral-800 hover:bg-neutral-700" @click="$emit('toggleProfile')">
                <IconUser class="w-5 h-5" />
            </button>
            <button class="p-2 rounded-full bg-neutral-800 hover:bg-neutral-700" @click="emit('call')">
                <IconPhone class="w-5 h-5" />
            </button>

            <button class="p-2 rounded-full bg-neutral-800 hover:bg-neutral-700" @click="emit('videoCall')">
                <IconVideo class="w-5 h-5" />
            </button>
        </div>
    </div>
</template>

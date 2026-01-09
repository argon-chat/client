<template>
    <div class="activity-log-viewer text-white rounded-lg space-y-6">
        <h2 class="text-2xl font-bold">Activity Logs</h2>

        <!-- Filters -->
        <div class="flex flex-row gap-4 items-end">
            <!-- Kind -->
            <div class="flex flex-col gap-1">
                <label class="text-sm text-muted-foreground">Kind</label>

                <Select v-model="kind">
                    <SelectTrigger class="w-[200px]">
                        <SelectValue placeholder="Select kind" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem v-for="k in kinds" :key="k.value" :value="k.value">
                            {{ k.label }}
                        </SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <!-- Search -->
            <div class="flex flex-col gap-1 flex-1">
                <label class="text-sm text-muted-foreground">Search</label>
                <Input v-model="search" placeholder="Search…" class="w-full" />
            </div>

            <Button @click="load" variant="outline" class="h-[40px]">
                Refresh
            </Button>
        </div>

        <div class="rounded-lg border p-4 space-y-4 max-h-[600px] overflow-auto">
            <div v-for="(log, idx) in logs" :key="idx"
                class="flex flex-col border-b last:border-none pb-3 cursor-pointer" @click="toggle(idx)">
                <div class="flex flex-row justify-between items-center">
                    <div class="flex items-center gap-2">
                        <Badge :variant="levelColor(log.logLevel)">
                            {{ ActivityLogLevel[log.logLevel] }}
                        </Badge>
                        <span class="text-sm text-muted-foreground">
                            {{ formatTime(log.time) }}
                        </span>
                    </div>

                    <span class="text-muted-foreground/10 text-xs">
                        {{ expanded.has(idx) ? "▲" : "▼" }}
                    </span>
                </div>

                <div class="text-base mt-1">
                    {{ log.template }}
                </div>

                <div v-if="expanded.has(idx)" class="mt-2 pl-2 border-l border-gray-600 space-y-2">
                    <div v-if="log.args?.length" class="flex flex-row gap-2 mt-1 flex-wrap">
                        <span v-for="(a, argIdx) in log.args" :key="argIdx"
                            class="text-xs bg-gray-700 rounded px-2 py-1">
                            {{ a }}
                        </span>
                    </div>
                </div>
            </div>

            <div v-if="logs.length === 0" class="text-muted-foreground text-center py-4">
                No logs found
            </div>
        </div>

        <!-- Pagination -->
        <div class="flex justify-between items-center">
            <Button :disabled="offset === 0" @click="prev">Prev</Button>
            <span class="text-sm">{{ offset }} – {{ offset + limit }}</span>
            <Button @click="next">Next</Button>
        </div>
    </div>
</template>
<style lang="css" scoped>
.activity-log-viewer {
    overflow-y: auto;
}

/* Chrome, Edge, Safari */
.activity-log-viewer::-webkit-scrollbar {
    width: 6px;
}

.activity-log-viewer::-webkit-scrollbar-track {
    background: transparent;
}

.activity-log-viewer::-webkit-scrollbar-thumb {
    background: #3d3d3d;
    /* темно-серый */
    border-radius: 8px;
}

.activity-log-viewer::-webkit-scrollbar-thumb:hover {
    background: #555;
}

/* Firefox */
.activity-log-viewer {
    scrollbar-width: thin;
    scrollbar-color: #3d3d3d transparent;
}
</style>

<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@argon/ui/select";
import { Input } from "@argon/ui/input";
import { Button } from "@argon/ui/button";
import { Badge } from "@argon/ui/badge";
import { ActivityKind, ActivityLogEntity, ActivityLogLevel } from "@argon/glue/ipc";
import { native } from "@argon/glue/native";

const kinds = [
    { value: String(ActivityKind.GameActivity), label: "Game Activity" },
    { value: String(ActivityKind.MusicActivity), label: "Music Activity" },
    { value: String(ActivityKind.HotKeysActivity), label: "HotKeys Activity" },
    { value: String(ActivityKind.SystemActivity), label: "System Activity" },
    { value: String(ActivityKind.NetworkActivity), label: "Network Activity" },
];

// state
const kind = ref<string>(String(ActivityKind.SystemActivity));
const logs = ref<ActivityLogEntity[]>([]);
const search = ref<string>("");
const limit = 50;
const offset = ref(0);
const expanded = ref<Set<number>>(new Set());

function toggle(idx: number) {
    if (expanded.value.has(idx)) {
        expanded.value.delete(idx);
    } else {
        expanded.value.add(idx);
    }
}

// API
async function load() {
    logs.value = await native.hostProc.getActivityDiagnostic(
        parseInt(kind.value),
        limit,
        offset.value,
        search.value || null
    );
}

function prev() {
    offset.value = Math.max(0, offset.value - limit);
    load();
}

function next() {
    offset.value += limit;
    load();
}

watch([kind, search], () => {
    offset.value = 0;
    load();
});

onMounted(load);

function formatTime(t: { date: Date; offsetMinutes: number }) {
    const corrected = new Date(t.date.getTime() + 0 * 60_000);

    return corrected.toLocaleString();
}

function levelColor(level: ActivityLogLevel) {
    switch (level) {
        case ActivityLogLevel.Error:
            return "destructive";
        case ActivityLogLevel.Warn:
            return "secondary";
        default:
            return "default";
    }
}
</script>

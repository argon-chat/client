<template>
    <Badge variant="secondary" class="flex items-center gap-1" v-for="badge in badges" :key="badge">
        <TooltipProvider :delayDuration="300" :ignoreNonKeyboardFocus="true" v-if="badge === 'staff'">
            <Tooltip>
                <TooltipTrigger>
                    <IconCat class="w-4 h-4 align-middle" />
                </TooltipTrigger>
                <TooltipContent>
                    <p>Argon Staff</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
        <TooltipProvider :delayDuration="300" :ignoreNonKeyboardFocus="true" v-if="badge == 'contributor'">
            <Tooltip>
                <TooltipTrigger>
                    <IconCpu class="w-4 h-4 align-middle" />
                </TooltipTrigger>
                <TooltipContent>
                    <p>Argon Contributor</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
        <template v-if="badge == 'staff'">Argon Staff</template>
        <template v-if="badge == 'contributor'">Argon Contributor</template>
    </Badge>
</template>
<script setup lang="ts">
import Badge from '@/components/ui/badge/Badge.vue';
import Tooltip from '@/components/ui/tooltip/Tooltip.vue';
import TooltipContent from '@/components/ui/tooltip/TooltipContent.vue';
import TooltipProvider from '@/components/ui/tooltip/TooltipProvider.vue';
import TooltipTrigger from '@/components/ui/tooltip/TooltipTrigger.vue';
import { IconCat, IconCpu } from '@tabler/icons-vue';


const props = defineProps<{
    badges: string[],
}>()
</script>
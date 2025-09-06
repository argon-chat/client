<template>
    <div v-bind="$attrs">
        <Alert class="flex justify-between items-center h-auto">
            <AlertTitle class="flex items-center gap-2 text-lg font-semibold">
                <IconCookieManFilled />
                Friends
            </AlertTitle>

            <AlertDescription class="ml-auto">
                <Input type="search" placeholder="Search" class="w-full" />
            </AlertDescription>
        </Alert>
        <br />
        <ScrollArea class="h-2/3 w-full">
            <div class="p-4">

                <div v-if="tags.length != 0" v-for="tag in tags" :key="tag">
                    <div class="text-sm">
                        {{ tag }}
                    </div>
                    <Separator class="my-2" />
                </div>

                <div v-else>
                    <div class="text-sm text-muted-foreground italic">
                        You don’t have any friends… even Clippy uninstalled himself...
                    </div>
                </div>
            </div>
        </ScrollArea>
    </div>
</template>
<script setup lang="ts">
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { IconMessageChatbotFilled, IconCookieManFilled, IconTriangleInvertedFilled, IconUserScan, IconNotification } from "@tabler/icons-vue"
import Input from "@/components/ui/input/Input.vue"
defineOptions({ inheritAttrs: false })
const tags: string[] = []
</script>
<template>
    <div class="relative" style="z-index: 1;" v-if="me.me" v-show="pex.has('ManageServer')">
        <div class="control-bar">
            <div class="controls">
                <button @click="openServerSettings">
                    <SettingsIcon class="w-5 h-5" />
                </button>
                <button @click="addChannelOpened = true">
                    <CirclePlusIcon class="w-5 h-5" />
                </button>
                <button>
                    <NotebookTabsIcon class="w-5 h-5" />
                </button>
                <button>
                    <UsersIcon class="w-5 h-5" />
                </button>
                <button>
                    <ShieldCheck class="w-5 h-5 good" />
                </button>
            </div>
        </div>
    </div>
    <Dialog v-model:open="addChannelOpened">
        <DialogContent class="sm:max-w-[425px]">
            <DialogHeader>
                <DialogTitle>Add channel</DialogTitle>
            </DialogHeader>
            <div class="grid gap-4 py-4">
                <div class="grid grid-cols-4 items-center gap-4">
                    <Label for="channel-name" class="text-right">
                        Name
                    </Label>
                    <Input id="channel-name" v-model="channelName" class="col-span-3" />
                </div>
                <div class="grid grid-cols-4 items-center gap-4">
                    <Label for="channel-type" class="text-right">
                        Type
                    </Label>
                    <RadioGroup id="channel-type" v-model="channelType" :orientation="'vertical'">
                        <div class="flex items-center space-x-2">
                            <RadioGroupItem id="r1" value="Text" />
                            <Label for="r1">
                                <Badge>Text</Badge>
                            </Label>
                        </div>
                        <div class="flex items-center space-x-2">
                            <RadioGroupItem id="r2" value="Voice" />
                            <Label for="r2">
                                <Badge>Voice</Badge>
                            </Label>
                        </div>
                        <div class="flex items-center space-x-2">
                            <RadioGroupItem id="r3" value="Announcement" />
                            <Label for="r3">
                                <Badge>Announcement</Badge>
                            </Label>
                        </div>
                    </RadioGroup>
                </div>
            </div>
            <DialogFooter>
                <DialogClose as-child>
                    <Button type="button" variant="secondary">
                        Cancel
                    </Button>
                </DialogClose>
                <Button type="submit" @click="addChannel">
                    Create Channel
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>

<script setup lang="ts">
import {
  SettingsIcon,
  CirclePlusIcon,
  ShieldCheck,
  NotebookTabsIcon,
  UsersIcon,
} from "lucide-vue-next";

import { useMe } from "@/store/meStore";
import { useLocale } from "@/store/localeStore";
import { logger } from "@/lib/logger";
import { useServerStore } from "@/store/serverStore";
import { useWindow } from "@/store/windowStore";
import { usePexStore } from "@/store/permissionStore";
import { ref } from "vue";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ChannelType } from "@/lib/glue/argonChat";

const { t } = useLocale();

const me = useMe();
const windows = useWindow();
const servers = useServerStore();
const addChannel_Loading = ref(false);
const addChannelOpened = ref(false);
const pex = usePexStore();

const channelType = ref("Text");
const channelName = ref("");
async function openServerSettings() {
  windows.serverSettingsOpen = true;
}

const addChannel = () => {
  addChannel_Loading.value = true;
  logger.info(`Creation channel: ${channelType.value}, ${channelName.value}`);
  servers.addChannelToServer(channelName.value, ChannelType.Text);

  setTimeout(() => {
    addChannel_Loading.value = false;
    addChannelOpened.value = false;
  }, 1000);
};
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
    gap: 6px;
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
</style>
<template>
    <div class="flex flex-col space-y-4">
        <div class="flex justify-between items-center">
            <h2 class="text-lg font-semibold">{{ t("invite_codes") }}</h2>
            <Button @click="addInvite" :disabled="loading || !pex.has('ManageServer')" variant="default" class="px-4 py-2">
                {{ t("add_invite") }}
            </Button>
        </div>

        <ul class="space-y-2">
            <div class="spinner-container" v-if="loading">
                <AtomSpinner class="text-center" />
            </div>
            <li v-if="!loading" v-for="invite in invites" :key="invite.code.inviteCode"
                class="flex justify-between items-center rounded-lg px-4 py-2">
                <Input readonly :model-value="`https://argon.gl/i/${invite.code.inviteCode}/`" />
                <Button @click="removeInvite(invite.code.inviteCode)" variant="ghost" class="text-red-500">
                    {{ t("remove") }}
                </Button>
            </li>
            <li v-if="!loading && invites.length == 0">
                <br />
                <br />
                <p class="text-sm text-muted-foreground text-center">
                    {{ t("no_any_invite_codes_created") }}
                </p>
            </li>
        </ul>
    </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Button } from "@/components/ui/button";
import { useServerStore } from "@/store/serverStore";
//@ts-ignore
import { AtomSpinner } from "epic-spinners";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/store/localeStore";
import { usePexStore } from "@/store/permissionStore";
import { InviteCodeEntity } from "@/lib/glue/argonChat";

const { t } = useLocale();
const servers = useServerStore();
const loading = ref(true);
const pex = usePexStore();

onMounted(async () => {
  await refreshInvites();
});

const refreshInvites = async () => {
  loading.value = true;
  const result = await servers.getServerInvites();
  invites.value = result;

  console.log(invites);
  loading.value = false;
};

const invites = ref<InviteCodeEntity[]>([]);

const addInvite = async () => {
  await servers.addInvite();
  await refreshInvites();
};

const removeInvite = (id: string) => {};
</script>

<style scoped>
.spinner-container {
    display: flex;
    justify-content: center;
    align-items: center;
}

.flex {
    display: flex;
}

.space-y-4>*+* {
    margin-top: 1rem;
}

.bg-gray-800 {
    background-color: #1f2937;
}

.rounded-lg {
    border-radius: 0.5rem;
}

.px-4 {
    padding-left: 1rem;
    padding-right: 1rem;
}

.py-2 {
    padding-top: 0.5rem;
    padding-bottom: 0.5rem;
}
</style>
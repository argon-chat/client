<template>
    <div class="modal-overlay">
        <PixelCard class="absolute inset-0 bg-zinc-900 " id="background" style="position: absolute;" />
        <div
            class="modal-content p-6 text-white rounded-lg shadow-lg max-w-lg w-full space-y-6 rounded-md border border-dashed grid w-full gap-2 z-[50] bg-black">
            <h2 class="text-2xl font-bold text-center">{{ t('join_or_create_server') }}</h2>

            <Button @click="createServer">
                {{ t('create_new_server') }}
            </Button>
            <div class="divider text-gray-400 text-center"> {{ t('or') }} </div>
            <div class="grid w-full gap-2">
                <Label for="invite-code">{{ t('invite_code') }}</Label>
                <Input id="invite-code" v-model="inviteCode" placeholder="e.g., XDq2-17jS-KJj2" />
                <br />
                <Button @click="joinServer">
                    {{ t('join_to_server') }}
                </Button>
            </div>



        </div>
        <div class="mt-6 pt-4 logout-button">
            <Button variant="destructive" class="w-full" @click="logout">
                Logout
            </Button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useServerStore } from '@/store/serverStore';
import { logger } from '@/lib/logger';
import router from '@/router';
import { toast } from '@/components/ui/toast';
import { useLocale } from '@/store/localeStore';
import PixelCard from '@/components/PixelCard.vue';

const { t } = useLocale();

const inviteCode = ref('');
const serverStore = useServerStore();


const logout = async () => {
    await pruneDatabases(true);
}


const pruneDatabases = async (pruneLocalStorage: boolean = true) => {
    const allIndexDbs = await indexedDB.databases();

    for (let db of allIndexDbs) {
        try {
            indexedDB.deleteDatabase(db.name!);
        } catch (e) {
            logger.error(e);
        }
    }

    const allStorages = await navigator.storageBuckets.keys();


    for (let storage of allStorages) {
        try {
            navigator.storageBuckets.delete(storage);
        } catch (e) {
            logger.error(e);
        }
    }

    if (pruneLocalStorage)
        localStorage.clear();

    location.reload();
}


const joinServer = async () => {
    if (!inviteCode.value.trim()) {
        toast({
            title: "Please enter a valid invite code."
        });
        return;
    }
    logger.log(`Joined server with invite code: ${inviteCode.value}`)
    const result = await serverStore.joinToServer(inviteCode.value.trim());
    inviteCode.value = '';

    if (!result)
        return;
    router.push({ path: "/master.pg" });
};

const createServer = () => {
    toast({
        title: "Insufficient Permissions",
        variant: "destructive",
        description: "You are not allowed this action!"
    });
};
</script>

<style scoped>
.modal-overlay {
    width: 100vw;
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
}

.modal-content {
    padding: 20px;
    border-radius: 8px;
    width: 100%;
    max-width: 500px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.input-field {
    width: 100%;
    padding: 8px;
    border: 1px solid #4a5568;
    border-radius: 4px;
    background-color: #2d3748;
    color: white;
    font-size: 1rem;
    margin-top: 8px;
}

.input-field::placeholder {
    color: #a0aec0;
}

.button {
    font-size: 1rem;
    font-weight: 500;
}

.divider {
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
}

.logout-button {
    position: fixed;
    bottom: 0;
    left: 0;
    width: 100px;
    margin: 10px;
}

.divider::before,
.divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: #4a5568;
    margin: 0 8px;
}
</style>

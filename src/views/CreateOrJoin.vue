<template>
    <div class="modal-overlay">
        <div
            class="modal-content p-6 text-white rounded-lg shadow-lg max-w-lg w-full space-y-6 rounded-md border border-dashed grid w-full gap-2">
            <h2 class="text-2xl font-bold text-center">Join or Create a Server</h2>

            <Button @click="createServer">
                Create New Server
            </Button>
            <div class="divider text-gray-400 text-center">or</div>
            <div class="grid w-full gap-2">
                <Label for="invite-code">Invite Code</Label>
                <Input id="invite-code" v-model="inviteCode"  placeholder="e.g., XDq2-17jS-KJj2" />
                <br/>
                <Button @click="joinServer">
                    Join Server
                </Button>
            </div>

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

const inviteCode = ref(''); 
const serverStore = useServerStore();


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
    router.push({ path: "/master" });
};

const createServer = () => {
};
</script>

<style scoped>
.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
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

.divider::before,
.divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: #4a5568;
    margin: 0 8px;
}
</style>

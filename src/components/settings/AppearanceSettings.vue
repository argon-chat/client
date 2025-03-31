<template>
    <div class="profile-settings p-6  text-white rounded-lg space-y-6" v-if="me.me">
        <h2 class="text-2xl font-bold">Profile Settings</h2>
        <div class="avatar-username flex items-center space-x-4">
            <div class="avatar">
                <ArgonAvatar :fallback="me.me.DisplayName" :file-id="me.me?.AvatarFileId!"
                        :user-id="me.me.Id" alt="User Avatar" class="user-avatar w-20 h-20 rounded-full border border-gray-500"  />
            </div>
            <div>
                <label class="block font-semibold mb-1">Username</label>
                <Input v-model="me.me.Username" type="text" class="input-field" placeholder="Enter username" />
            </div>
        </div>
        <div>
            <label class="block font-semibold mb-1">Display Name</label>
            <Input v-model="me.me.DisplayName" type="text" class="input-field" placeholder="Enter display name" />
        </div>
        <div>
            <label class="block font-semibold mb-1">Email</label>
            <Input v-model="me.me.Email" type="email" class="input-field" placeholder="Enter email" />
        </div>
        <div v-if="false">
            <label class="block font-semibold mb-1">Password</label>
            <Input type="password" class="input-field" placeholder="Enter new password" />
        </div>
        <div v-if="false">
            <label class="block font-semibold mb-1">Phone Number</label>
            <Input v-model="user.phoneNumber" type="tel" class="input-field" placeholder="Enter phone number" />
        </div>

        <div class="otp-settings" v-if="false">
            <label class="block font-semibold mb-1">Two-Factor Authentication (OTP)</label>
            <button @click="toggleOTP" class="button bg-blue-500 text-white rounded px-4 py-2 hover:bg-blue-600">
                {{ user.otpEnabled ? 'Disable OTP' : 'Enable OTP' }}
            </button>
        </div>

        <div class="delete-account">
            <label class="block font-semibold mb-1">Delete Account</label>
            <button @click="deleteAccount" class="button bg-red-500 text-white rounded px-4 py-2 hover:bg-red-600">
                Delete Account
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { Input } from '@/components/ui/input'
import ArgonAvatar from '../ArgonAvatar.vue';
import { useMe } from '@/store/meStore';
import { useToast } from '@/components/ui/toast/use-toast'
const me = useMe();
const toast = useToast();


const user = ref({
    avatar: 'https://placehold.co/100x100',
    username: 'User123',
    displayName: 'Display Name',
    email: 'user@example.com',
    password: '',
    phoneNumber: '+1234567890',
    otpEnabled: false
});

const toggleOTP = () => {
    user.value.otpEnabled = !user.value.otpEnabled;
    alert(`OTP has been ${user.value.otpEnabled ? 'enabled' : 'disabled'}.`);
};

const deleteAccount = () => {
    toast.toast({
        title: "Охуел?",
        variant: "destructive",
        description: "Обойдешься, мы не соблюдаем GRPD чисто по приколу"
    });
};
</script>

<style scoped>
.profile-settings {
    max-width: 600px;
    margin: 0 auto;
}
.button {
    padding: 10px 16px;
    font-size: 1rem;
    font-weight: 500;
}

.avatar img {
    border-radius: 50%;
    border: 2px solid #4a5568;
}
</style>

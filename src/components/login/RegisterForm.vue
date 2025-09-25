<script setup lang="ts">
import Button from "../ui/button/Button.vue";
import Card from "../ui/card/Card.vue";
import CardContent from "../ui/card/CardContent.vue";
import CardFooter from "../ui/card/CardFooter.vue";
import CardHeader from "../ui/card/CardHeader.vue";
import CardTitle from "../ui/card/CardTitle.vue";
import CardDescription from "../ui/card/CardDescription.vue";
import Input from "../ui/input/Input.vue";
import Label from "../ui/label/Label.vue";
import { Checkbox } from "../ui/checkbox";
import { ReloadIcon } from "@radix-icons/vue";
import { vMaska } from "maska/vue";

const props = defineProps<{
    auth: ReturnType<typeof import("@/composables/useAuthForm").useAuthForm>;
}>();


const {
    email,
    password,
    username,
    displayName,
    allowSendMeOptionalEmails,
    agreeTos,
    isLoading,
    brithDate,
    onSubmit,
} = props.auth;

</script>

<template>
    <div class="flex justify-center items-center min-h-screen">
        <form @submit.prevent="onSubmit" class="w-[500px] p-6 flex flex-col">
            <Card class="rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl shadow-2xl overflow-hidden">
                <CardHeader class="text-center space-y-1">
                    <CardTitle class="text-2xl font-bold text-white">Create Account</CardTitle>
                    <CardDescription class="text-gray-400">
                        Join Argon and start your journey ✨
                    </CardDescription>
                </CardHeader>

                <CardContent class="space-y-4 pt-6">
                    <div class="space-y-1">
                        <Label for="email" class="text-gray-200">Email *</Label>
                        <Input id="email" v-model="email" type="email" placeholder="example@email.com" class="h-11 rounded-xl bg-black/50 border-gray-700 text-white placeholder-gray-500
                     focus:border-blue-500 focus:ring focus:ring-blue-500/30" :disabled="isLoading" />
                    </div>

                    <div class="space-y-1">
                        <Label for="displayName" class="text-gray-200">Display Name *</Label>
                        <Input id="displayName" v-model="displayName" type="text" placeholder="John Doe" class="h-11 rounded-xl bg-black/50 border-gray-700 text-white placeholder-gray-500
                     focus:border-blue-500 focus:ring focus:ring-blue-500/30" :disabled="isLoading" />
                    </div>

                    <div class="space-y-1">
                        <Label for="username" class="text-gray-200">Username *</Label>
                        <Input id="username" v-model="username" type="text" placeholder="username" class="h-11 rounded-xl bg-black/50 border-gray-700 text-white placeholder-gray-500
                     focus:border-blue-500 focus:ring focus:ring-blue-500/30" :disabled="isLoading" />
                    </div>

                    <div class="space-y-1">
                        <Label for="password" class="text-gray-200">Password *</Label>
                        <Input id="password" v-model="password" type="password" placeholder="••••••••" class="h-11 rounded-xl bg-black/50 border-gray-700 text-white placeholder-gray-500
                     focus:border-blue-500 focus:ring focus:ring-blue-500/30" :disabled="isLoading" />
                    </div>

                    <!-- Date of Birth -->
                    <div class="space-y-1">
                        <Label class="text-gray-200">Date of Birth *</Label>
                        <Input v-model="brithDate" v-maska="'##/##/####'" class="h-11 rounded-xl bg-black/50 border-gray-700 text-white placeholder-gray-500 text-center
                     focus:border-blue-500 focus:ring focus:ring-blue-500/30" :disabled="isLoading" />
                    </div>

                    <div class="flex gap-x-2 items-start">
                        <Checkbox v-model:checked="allowSendMeOptionalEmails" />
                        <span class="text-sm text-gray-300">
                            Receive optional emails with updates & news
                        </span>
                    </div>
                </CardContent>

                <CardFooter class="flex-col items-start gap-4">
                    <div class="flex gap-x-2 items-start">
                        <Checkbox v-model:checked="agreeTos" aria-required="true" />
                        <span class="text-sm text-gray-300">
                            Accept
                            <a href="/tos" class="text-blue-400 hover:text-blue-300">Terms</a> and
                            <a href="/privacy" class="text-blue-400 hover:text-blue-300">Privacy Policy</a> *
                        </span>
                    </div>

                    <Button :disabled="isLoading" class="w-full hover:opacity-90 transition">
                        <ReloadIcon v-if="isLoading" class="w-4 h-4 mr-2 animate-spin" />
                        Register
                    </Button>

                    <p class="text-xs text-gray-400 text-center w-full">
                        Already have an account?
                        <a @click="props.auth.goBackToLogin()"
                            class="cursor-pointer text-blue-400 hover:text-blue-300 transition">
                            Sign in
                        </a>
                    </p>
                </CardFooter>
            </Card>
        </form>
    </div>
</template>

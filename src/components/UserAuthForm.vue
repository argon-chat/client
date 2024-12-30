<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription
} from '@/components/ui/card'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/store/authStore'
import { useRouter } from 'vue-router';
import { useServerStore } from '@/store/serverStore'
import { Checkbox } from '@/components/ui/checkbox'
import { ReloadIcon } from '@radix-icons/vue'
import {
  PinInput,
  PinInputGroup,
  PinInputInput,
  PinInputSeparator,
} from '@/components/ui/pin-input'
import { logger } from '@/lib/logger'

const router = useRouter();
const server = useServerStore();

const isLoading = ref(false);
const tabValue = ref<"login" | "register" | "otp-code">('login');
const isRegister = computed(() => tabValue.value === 'register');

const authStore = useAuthStore();

const email = ref('');
const password = ref('');
const username = ref('');
const allowSendMeOptionalEmails = ref(false);
const agreeTos = ref(false);
const displayName = ref('');
const otpModel = ref<string[]>([]);
const otpCode = ref<string>("");
const handleCompleteOtpCode = (e: string[]) => {
  otpCode.value = e.join("");
  onSubmit(null);
};

async function onSubmit(event: Event | null) {
  event?.preventDefault();
  isLoading.value = true;

  try {

    logger.info("Do submit, ", { isRegister: isRegister.value, event });
    if (isRegister.value) {
      await authStore.register({
        AgreeOptionalEmails: allowSendMeOptionalEmails.value,
        AgreeTos: agreeTos.value,
        BirthDate: new Date(),
        DisplayName: displayName.value,
        Email: email.value,
        Password: password.value,
        Username: username.value
      });
    } else {
      await authStore.login(email.value, password.value, !!otpCode.value ? otpCode.value : undefined, undefined);
      if (authStore.isRequiredOtp && tabValue.value == "login") {
        tabValue.value = "otp-code";
      }
    }
    if (server.servers.length === 0) {
      router.push({ path: '/create-or-join' });
    } else {
      router.push({ path: '/master' });
    }
  } catch (error) {
    console.error('Error when login/register:', error);
  } finally {
    isLoading.value = false;
  }
}
</script>
<template>
  <div class="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[450px]">
    <div class="flex flex-col space-y-2 text-center" v-if="tabValue == 'login'">
      <h1 class="text-2xl font-semibold tracking-tight">
        Login into an account
      </h1>
      <p class="text-sm text-muted-foreground">
        Enter your email and password below to login your account
      </p>
    </div>
    <div class="flex flex-col space-y-2 text-center" v-if="tabValue == 'register'">
      <h1 class="text-2xl font-semibold tracking-tight">
        Register new account
      </h1>
      <p class="text-sm text-muted-foreground">
        Enter your email and password below to register your account
      </p>
    </div>

    <Tabs default-value="login" v-model:model-value="tabValue">
      <TabsList class="grid w-full grid-cols-2">
        <TabsTrigger value="login" :disabled="authStore.isRequiredOtp">
          Sign In
        </TabsTrigger>
        <TabsTrigger value="register" v-if="!authStore.isRequiredOtp">
          Register
        </TabsTrigger>
        <TabsTrigger value="otp-code" v-if="authStore.isRequiredOtp">
          Otp Code
        </TabsTrigger>
      </TabsList>
      <TabsContent value="login">
        <form @submit="(e) => onSubmit(e)" class="transition-all duration-500 ease-in-out transform"
          v-if="!authStore.isRequiredOtp">
          <Card>
            <CardHeader>
            </CardHeader>
            <CardContent class="space-y-2">
              <div class="space-y-1">
                <Label for="email">Email</Label>
                <Input id="email" v-model="email" placeholder="example@email.com" type="email" auto-complete="email"
                  :disabled="isLoading" />
              </div>
              <div class="space-y-1">
                <Label for="password">Password</Label>
                <Input id="password" v-model="password" placeholder="••••••••" type="password"
                  auto-complete="current-password" :disabled="isLoading" />
              </div>
            </CardContent>
            <CardFooter>
              <Button :disabled="isLoading" class="w-full">
                <ReloadIcon v-if="isLoading" class="w-4 h-4 mr-2 animate-spin" />
                Sign In
              </Button>
            </CardFooter>
          </Card>
        </form>
      </TabsContent>
      <TabsContent value="otp-code">
        <form @submit="(e) => onSubmit(e)" class="transition-all duration-500 ease-in-out transform">
          <Card>
            <CardHeader>
              <CardTitle>Enter your OTP code</CardTitle>
              <CardDescription>It has been sent to your email.</CardDescription>
            </CardHeader>
            <CardContent class="space-y-2">
              <PinInput id="pin-input" class="justify-center" v-model="otpModel" placeholder="○"
                @complete="handleCompleteOtpCode">
                <PinInputGroup class="gap-1">
                  <template v-for="(id, index) in 6" :key="id">
                    <PinInputInput class="rounded-md border bg-zinc-900" :index="index" />
                    <template v-if="index !== 5">
                      <PinInputSeparator />
                    </template>
                  </template>
                </PinInputGroup>
              </PinInput>
            </CardContent>
            <CardFooter>
              <Button :disabled="isLoading" class="w-full">
                <ReloadIcon v-if="isLoading" class="w-4 h-4 mr-2 animate-spin" />
                Sign In
              </Button>
            </CardFooter>
          </Card>
        </form>
      </TabsContent>
      <TabsContent value="register">
        <form @submit="(e) => onSubmit(e)" class="transition-all duration-500 ease-in-out transform">
          <Card>
            <br />
            <CardContent class="space-y-2">
              <div class="space-y-1">
                <Label for="email" class="flex">Email <div class="text-red-500 pl-1">*</div></Label>
                <Input id="email" v-model="email" placeholder="example@email.com" type="email" auto-complete="email"
                  :disabled="isLoading" />
              </div>
              <div class="space-y-1">
                <Label for="displayName" class="flex">Display Name <div class="text-red-500 pl-1">*</div></Label>
                <Input id="displayName" v-model="displayName" placeholder="Name" type="displayName"
                  :disabled="isLoading" />
              </div>
              <div class="space-y-1">
                <Label for="username" class="flex">Username <div class="text-red-500 pl-1">*</div></Label>
                <Input id="username" v-model="username" placeholder="username" type="username" :disabled="isLoading" />
              </div>
              <div class="space-y-1">
                <Label for="password" class="flex">Password <div class="text-red-500 pl-1">*</div></Label>
                <Input id="password" v-model="password" placeholder="••••••••" type="password"
                  auto-complete="new-password" :disabled="isLoading" />
              </div>
              <br />
              <div class="space-y-1">
                <div class="items-top flex gap-x-2">
                  <Checkbox id="terms1" v-model:checked="allowSendMeOptionalEmails" />
                  <div class="grid gap-1.5 leading-none">
                    <label for="terms1"
                      class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                      Receive optional emails
                    </label>
                    <p class="text-sm text-muted-foreground">
                      I don't mind receiving emails with news, as well as newsletters and special offers
                    </p>
                  </div>
                </div>
              </div>

            </CardContent>
            <CardFooter>
              <div class="items-top flex gap-x-2">
                <Checkbox id="tos1" v-model:checked="agreeTos" />
                <div class="grid gap-1.5 leading-none">
                  <label for="tos1"
                    class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex">
                    Accept terms and conditions <div class="text-red-500 pl-1">*</div>
                  </label>
                  <p class="text-sm text-muted-foreground">
                    You agree to our Terms of Service and Privacy Policy.
                  </p>
                </div>
              </div>
              <Button :disabled="isLoading">
                <ReloadIcon v-if="isLoading" class="w-4 h-4 mr-2 animate-spin" />
                Register
              </Button>
            </CardFooter>
          </Card>
        </form>
      </TabsContent>
    </Tabs>
  </div>

</template>
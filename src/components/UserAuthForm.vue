<script setup lang="ts">
import { computed, ref } from "vue";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/authStore";
import { useRouter } from "vue-router";
import { Checkbox } from "@/components/ui/checkbox";
import { ReloadIcon } from "@radix-icons/vue";
import {
  PinInput,
  PinInputGroup,
  PinInputInput,
  PinInputSeparator,
} from "@/components/ui/pin-input";
import { logger } from "@/lib/logger";
import { IonMaybe } from "@argon-chat/ion.webcore";

const router = useRouter();

const isLoading = ref(false);
const tabValue = ref<
  "login" | "register" | "otp-code" | "otp-reset" | "pass-reset"
>("login");
const isRegister = computed(() => tabValue.value === "register");
const isResetPass = computed(
  () => tabValue.value === "otp-reset" || tabValue.value === "pass-reset",
);

const authStore = useAuthStore();

const email = ref("");
const password = ref("");
const username = ref("");
const allowSendMeOptionalEmails = ref(false);
const agreeTos = ref(false);
const displayName = ref("");
const otpModel = ref<string[]>([]);
const otpCode = ref<string>("");
const handleCompleteOtpCode = (e: string[]) => {
  otpCode.value = e.join("");
  onSubmit(null);
};
const handleCompleteResetCode = (e: string[]) => {
  otpCode.value = e.join("");
};

async function onSubmit(event: Event | null) {
  event?.preventDefault();
  isLoading.value = true;

  try {
    logger.info("Do submit, ", { isRegister: isRegister.value, event });

    if (isResetPass.value) {
      if (tabValue.value === "otp-reset") {
        await authStore.resetPass(email.value, password.value, otpCode.value);
      } else {
        await authStore.beginResetPass(email.value);
        tabValue.value = "otp-reset";
      }
      if (authStore.isAuthenticated) {
        window.location.reload();
      }
      return;
    }

    if (isRegister.value) {
      await authStore.register({
        argreeOptionalEmails: allowSendMeOptionalEmails.value,
        argreeTos: agreeTos.value,
        displayName: displayName.value,
        email: email.value,
        password: password.value,
        username: username.value,
        captchaToken: null
      });
    } else {
      await authStore.login(
        email.value,
        password.value,
        otpCode.value ? otpCode.value : undefined,
        undefined,
      );
      if (authStore.isRequiredOtp && tabValue.value === "login") {
        tabValue.value = "otp-code";
        return;
      }
    }
    if (authStore.isAuthenticated) {
      /*const serverStore = usePoolStore();
      await serverStore.loadServerDetails();

      const servers = await serverStore.allServerAsync;

      if (servers.length == 0) {
        router.push({ path: '/create-or-join.pg' });
        return;
      }
      router.push({ path: "/master.pg" });*/
      window.location.reload();
      //(window as any).restartApp();
    }
  } catch (error) {
    console.error("Error when login/register:", error);
  } finally {
    isLoading.value = false;
  }
}

const goToResetPass = () => {
  tabValue.value = "pass-reset";
};
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
        <TabsTrigger value="login" :disabled="authStore.isRequiredOtp" v-if="!isResetPass">
          Sign In
        </TabsTrigger>
        <TabsTrigger value="register" v-if="!authStore.isRequiredOtp && !isResetPass">
          Register
        </TabsTrigger>
        <TabsTrigger value="otp-code" v-if="authStore.isRequiredOtp && !isResetPass">
          Otp Code
        </TabsTrigger>
        <TabsTrigger value="pass-reset" v-if="isResetPass" disabled>
          Reset Password
        </TabsTrigger>
        <TabsTrigger value="otp-reset" v-if="authStore.isRequiredFormResetPass || isResetPass" disabled>
          Enter Reset Code
        </TabsTrigger>
      </TabsList>
      <TabsContent value="login">
        <form @submit="(e) => onSubmit(e)" class="transition-all duration-500 ease-in-out transform"
          v-if="!authStore.isRequiredOtp">
          <Card>
            <br />
            <CardContent class="space-y-2">
              <div class="space-y-1">
                <Label for="email">Email</Label>
                <Input id="email" v-model="email" placeholder="example@email.com" type="email" auto-complete="email"
                  pattern="^[^\s@]+@[^\s@]+\.[^\s@]{1,}$" title="Please enter valid email address"
                  :disabled="isLoading" />
              </div>
              <div class="space-y-1">
                <Label for="password">Password</Label>
                <Input id="password" v-model="password" placeholder="••••••••" type="password"
                  auto-complete="current-password" :disabled="isLoading" />
                <a @click="goToResetPass" class="cursor-pointer text-gray-500 text-xs">Forgot password?</a>
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
                  pattern="^[^\s@]+@[^\s@]+\.[^\s@]{1,}$" title="Please enter valid email address"
                  :disabled="isLoading" />
              </div>
              <div class="space-y-1">
                <Label for="displayName" class="flex">Display Name <div class="text-red-500 pl-1">*</div></Label>
                <Input id="displayName" v-model="displayName" placeholder="Name" type="displayName"
                  :disabled="isLoading" />
              </div>
              <div class="space-y-1">
                <Label for="username" class="flex">Username <div class="text-red-500 pl-1">*</div></Label>
                <Input id="username" v-model="username" placeholder="username" type="username" :disabled="isLoading"
                  pattern="^[a-zA-Z][a-zA-Z0-9_]{2,19}$"
                  title="The user's name must start with a letter and contain from 3 to 20 characters: letters, numbers, and underscores." />
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
                <Checkbox id="tos1" v-model:checked="agreeTos" aria-required="true" />
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


      <!-- reset pass flow -->
      <TabsContent value="otp-reset">
        <form @submit="(e) => onSubmit(e)" class="transition-all duration-500 ease-in-out transform">
          <Card>
            <CardHeader>
              <CardTitle>Enter reset code</CardTitle>
              <CardDescription>It has been sent to your email.</CardDescription>
            </CardHeader>
            <CardContent class="space-y-2">
              <PinInput id="pin-input" class="justify-center" v-model="otpModel" placeholder="○"
                @complete="handleCompleteResetCode">
                <PinInputGroup class="gap-1">
                  <template v-for="(id, index) in 6" :key="id">
                    <PinInputInput class="rounded-md border bg-zinc-900" :index="index" />
                    <template v-if="index !== 5">
                      <PinInputSeparator />
                    </template>
                  </template>
                </PinInputGroup>
              </PinInput>
              <br/>
              <div class="space-y-1">
                <Label for="password" class="flex">Password <div class="text-red-500 pl-1">*</div></Label>
                <Input id="password" v-model="password" placeholder="••••••••" type="password"
                  auto-complete="new-password" :disabled="isLoading" />
              </div>
            </CardContent>
            <CardFooter>
              <Button :disabled="isLoading" class="w-full">
                <ReloadIcon v-if="isLoading" class="w-4 h-4 mr-2 animate-spin" />
                Reset Password
              </Button>
            </CardFooter>
          </Card>
        </form>
      </TabsContent>
      <TabsContent value="pass-reset">
        <form @submit="(e) => onSubmit(e)" class="transition-all duration-500 ease-in-out transform">
          <Card>
            <CardHeader>
              <CardTitle>Enter email</CardTitle>
              <CardDescription>We will send you a password reset code.</CardDescription>
            </CardHeader>
            <CardContent class="space-y-2">
              <div class="space-y-1">
                <Label for="email" class="flex">Email <div class="text-red-500 pl-1">*</div></Label>
                <Input id="email" v-model="email" placeholder="example@email.com" type="email" auto-complete="email"
                  pattern="^[^\s@]+@[^\s@]+\.[^\s@]{1,}$" title="Please enter valid email address"
                  :disabled="isLoading" />
              </div>
            </CardContent>
            <CardFooter>
              <Button :disabled="isLoading" class="w-full" type="submit">
                <ReloadIcon v-if="isLoading" class="w-4 h-4 mr-2 animate-spin" />
                Reset Password
              </Button>
            </CardFooter>
          </Card>
        </form>
      </TabsContent>
    </Tabs>
  </div>

</template>
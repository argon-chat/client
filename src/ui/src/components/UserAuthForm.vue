<script setup lang="ts">
import { ref } from 'vue'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader
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

const router = useRouter();
const server = useServerStore();

const isLoading = ref(false);
const isRegister = ref(false);

const authStore = useAuthStore();

const email = ref('');
const password = ref('');
const username = ref('');
const allowSendMeOptionalEmails = ref(false);
const agreeTos = ref(false);
const displayName = ref('');
const tabValue = ref('login');
async function onSubmit(event: Event) {
  event.preventDefault();
  isLoading.value = true;

  try {
    if (isRegister.value) {
      await authStore.register({ 
        agreeOptionalEmails: allowSendMeOptionalEmails.value,  
        agreeTos: agreeTos.value,
        birthDate: new Date(),
        displayNane: displayName.value,
        email: email.value,
        machineKey: "",
        password: password.value,
        phone: "",
        username: username.value
      });
    } else {
      await authStore.login(email.value, password.value);
    }
    if (server.servers.length === 0) {
      router.push({ path: '/create-or-join' });
    } else {
      router.push({ path: '/master' });
    }
  } catch (error) {
    console.error('Ошибка авторизации/регистрации:', error);
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
        <TabsTrigger value="login">
          Sign In
        </TabsTrigger>
        <TabsTrigger value="register">
          Register
        </TabsTrigger>
      </TabsList>
      <TabsContent value="login">
        <form @submit="(e) => onSubmit(e)" class="transition-all duration-500 ease-in-out transform">
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
      <TabsContent value="register">
        <form @submit="(e) => onSubmit(e)" class="transition-all duration-500 ease-in-out transform">
          <Card>
           <br/>
            <CardContent class="space-y-2">
              <div class="space-y-1">
                <Label for="email" class="flex">Email <div class="text-red-500 pl-1">*</div></Label>
                <Input id="email" v-model="email" placeholder="example@email.com" type="email" auto-complete="email"
                  :disabled="isLoading" />
              </div>
              <div class="space-y-1">
                <Label for="password"  class="flex">Display Name  <div class="text-red-500 pl-1">*</div></Label>
                <Input id="displayName" v-model="displayName" placeholder="Name" type="displayName"
                  :disabled="isLoading" />
              </div>
              <div class="space-y-1">
                <Label for="password" class="flex">Username  <div class="text-red-500 pl-1">*</div></Label>
                <Input id="username" v-model="username" placeholder="username" type="username" :disabled="isLoading" />
              </div>
              <div class="space-y-1">
                <Label for="password" class="flex">Password  <div class="text-red-500 pl-1">*</div></Label>
                <Input id="password" v-model="password" placeholder="••••••••" type="password"
                  auto-complete="new-password" :disabled="isLoading" />
              </div>
              <br/>
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
                <Checkbox id="tos1" v-model:checked="agreeTos"/>
                <div class="grid gap-1.5 leading-none">
                  <label for="tos1"
                    class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex">
                    Accept terms and conditions  <div class="text-red-500 pl-1">*</div>
                  </label>
                  <p class="text-sm text-muted-foreground">
                    You agree to our Terms of Service and Privacy Policy.
                  </p>
                </div>
              </div>
              <Button :disabled="isLoading" >
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
<template>
  <div>
    <div class="profile-settings-container">
      <div v-if="!me.me" class="flex items-center justify-center min-h-[400px]">
        <div class="text-muted-foreground">Loading...</div>
      </div>

      <div v-else class="space-y-6">
        <!-- Profile Header & Info Container -->
        <div class="flex flex-col lg:flex-row gap-6">
          <!-- Profile Header & Avatar Card -->
          <div class="setting-card profile-header p-0 overflow-hidden lg:w-[400px] flex-shrink-0">
            <ProfileHeaderUploader :header-file-id="me.meProfile?.bannerFileID ?? null" :user-id="me.me.userId"
              @header-updated="onProfileUpdated" />

            <div class="p-6">
              <div class="flex items-start gap-4 -mt-12">
                <div class="relative">
                  <AvatarUploader :fallback="me.me.displayName" :avatar-file-id="me.me?.avatarFileId"
                    :user-id="me.me.userId" @avatar-updated="onProfileUpdated" />
                </div>

                <div class="flex-1 mt-8">
                  <div class="flex items-center gap-2 mb-1">
                    <h3 class="text-xl font-bold">{{ me.me.displayName }}</h3>

                    <!-- Badges inline with name -->
                    <div v-if="me.meProfile?.badges && me.meProfile.badges.length > 0"
                      class="flex items-center gap-1.5">
                      <img v-for="badge in me.meProfile.badges" :key="badge" :src="getBadgeIcon(badge)" :alt="badge"
                        class="w-6 h-6 object-contain transition-transform hover:scale-110 cursor-help"
                        :title="badge" />
                    </div>
                  </div>
                  <p class="text-sm text-muted-foreground">@{{ me.me.username }}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Profile Information Card -->
          <div class="setting-card flex-1">
            <div class="flex items-center gap-2 mb-4">
              <UserIcon class="w-5 h-5 text-primary" />
              <h3 class="text-lg font-semibold">{{ t("profile_information") }}</h3>
            </div>

            <div class="space-y-4">
              <div class="setting-item">
                <div class="flex-1">
                  <div class="text-sm font-medium">{{ t("username") }}</div>
                  <div class="text-xs text-muted-foreground">{{ t("username_desc") }}</div>
                </div>
                <Input readonly disabled v-model="me.me.username" type="text" class="w-[250px]"
                  placeholder="username" />
              </div>

              <div class="setting-item">
                <div class="flex-1">
                  <div class="text-sm font-medium">{{ t("display_name") }}</div>
                  <div class="text-xs text-muted-foreground">{{ t("display_name_desc") }}</div>
                </div>
                <Input readonly disabled v-model="me.me.displayName" type="text" class="w-[250px]"
                  placeholder="Display Name" />
              </div>
            </div>
          </div>
        </div>

        <!-- Security & Authentication Card -->
        <div class="setting-card">
          <div class="flex items-center gap-2 mb-4">
            <ShieldIcon class="w-5 h-5 text-primary" />
            <h3 class="text-lg font-semibold">{{ t("security_authentication") }}</h3>
          </div>

          <div class="space-y-4">
            <!-- Two-Factor Authentication -->
            <div class="flex flex-row items-center justify-between rounded-lg border p-4">
              <div class="space-y-0.5">
                <div class="text-sm font-medium">{{ t("two_factor_auth") }}</div>
                <div class="text-xs text-muted-foreground">
                  {{ t("two_factor_auth_desc") }}
                </div>
              </div>
              <div class="flex items-center gap-2">
                <Badge v-if="otpEnabled" variant="outline" class="bg-green-500/10 text-green-500 border-green-500/30">
                  {{ t("enabled") }}
                </Badge>
                <Badge v-else variant="outline" class="bg-gray-500/10 text-gray-400 border-gray-500/30">
                  {{ t("disabled") }}
                </Badge>
                <Button @click="toggleOTP" variant="outline" size="sm">
                  {{ otpEnabled ? t("disable") : t("enable") }}
                </Button>
              </div>
            </div>

            <!-- Phone Number Section -->
            <div class="rounded-lg border p-4 space-y-4">
              <div class="flex items-center justify-between">
                <div class="space-y-0.5">
                  <div class="text-sm font-medium flex items-center gap-2">
                    <PhoneIcon class="w-4 h-4" />
                    {{ t("phone_number") }}
                  </div>
                  <div class="text-xs text-muted-foreground">
                    {{ t("phone_number_desc") }}
                  </div>
                </div>
                <Button @click="showChangePhoneDialog = true" variant="outline" size="sm">
                  {{ userPhone ? t("change") : t("add") }}
                </Button>
              </div>

              <!-- Phone Display -->
              <div v-if="userPhone" class="flex items-center justify-between p-3 rounded-md bg-gradient-to-r from-blue-500/5 to-purple-500/5 border border-blue-500/20">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                    <PhoneIcon class="w-5 h-5 text-blue-500" />
                  </div>
                  <div>
                    <div class="text-sm font-medium flex items-center gap-2">
                      {{ maskPhone(userPhone) }}
                      <CheckCircle2Icon class="w-4 h-4 text-green-500" />
                    </div>
                    <div class="text-xs text-muted-foreground">
                      {{ t("verified") }}
                    </div>
                  </div>
                </div>
              </div>

              <div v-else class="text-center py-6 text-sm text-muted-foreground">
                {{ t("no_phone_added") }}
              </div>
            </div>

            <!-- Email Address Section -->
            <div class="rounded-lg border p-4 space-y-4">
              <div class="flex items-center justify-between">
                <div class="space-y-0.5">
                  <div class="text-sm font-medium flex items-center gap-2">
                    <MailIcon class="w-4 h-4" />
                    {{ t("email") }}
                  </div>
                  <div class="text-xs text-muted-foreground">
                    {{ t("email_desc") }}
                  </div>
                </div>
                <Button @click="showChangeEmailDialog = true" variant="outline" size="sm">
                  {{ t("change") }}
                </Button>
              </div>

              <!-- Email Display -->
              <div class="flex items-center justify-between p-3 rounded-md bg-gradient-to-r from-purple-500/5 to-pink-500/5 border border-purple-500/20">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center">
                    <MailIcon class="w-5 h-5 text-purple-500" />
                  </div>
                  <div>
                    <div class="text-sm font-medium flex items-center gap-2">
                      {{ maskEmail(userEmail) }}
                      <CheckCircle2Icon class="w-4 h-4 text-green-500" />
                    </div>
                    <div class="text-xs text-muted-foreground">
                      {{ t("verified") }}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Passkeys Section -->
            <div class="rounded-lg border p-4 space-y-4">
              <div class="flex items-center justify-between">
                <div class="space-y-0.5">
                  <div class="text-sm font-medium flex items-center gap-2">
                    <KeyRoundIcon class="w-4 h-4" />
                    {{ t("passkeys") }}
                  </div>
                  <div class="text-xs text-muted-foreground">
                    {{ t("passkeys_desc") }}
                  </div>
                </div>
                <Button @click="showAddPasskeyDialog = true" variant="outline" size="sm">
                  <PlusIcon class="w-4 h-4 mr-1" />
                  {{ t("add_passkey") }}
                </Button>
              </div>

              <!-- Passkeys List -->
              <div v-if="passkeys.length > 0" class="space-y-2 mt-4">
                <div v-for="passkey in passkeys" :key="passkey.id"
                  class="flex items-center justify-between p-3 rounded-md bg-muted/50 hover:bg-muted transition-colors">
                  <div class="flex items-center gap-3">
                    <KeyRoundIcon class="w-4 h-4 text-muted-foreground" />
                    <div>
                      <div class="text-sm font-medium">{{ passkey.name }}</div>
                      <div class="text-xs text-muted-foreground">
                        {{ t("created") }}: {{ formatDate(passkey.createdAt) }}
                      </div>
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    <Button @click="testPasskey(passkey.id)" variant="outline" size="sm">
                      {{ t("test") }}
                    </Button>
                    <Button @click="removePasskey(passkey.id)" variant="ghost" size="icon"
                      class="h-8 w-8 text-destructive hover:text-destructive">
                      <TrashIcon class="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <div v-else class="text-center py-6 text-sm text-muted-foreground">
                {{ t("no_passkeys") }}
              </div>
            </div>
            <!-- Password Change -->
            <div class="flex flex-row items-center justify-between rounded-lg border p-4">
              <div class="space-y-0.5">
                <div class="text-sm font-medium">{{ t("password") }}</div>
                <div class="text-xs text-muted-foreground">
                  {{ t("change_password_desc") }}
                </div>
              </div>
              <Button @click="showChangePasswordDialog = true" variant="outline" size="sm">
                {{ t("change_password") }}
              </Button>
            </div>
          </div>
        </div>

        <!-- Account Actions Card -->
        <div class="setting-card border-destructive/50">
          <div class="flex items-center gap-2 mb-4">
            <AlertTriangleIcon class="w-5 h-5 text-destructive" />
            <h3 class="text-lg font-semibold text-destructive">{{ t("danger_zone") }}</h3>
          </div>

          <div class="space-y-3">
            <!-- Auto-delete account -->
            <div class="flex flex-row items-center justify-between rounded-lg border border-destructive/30 p-4">
              <div class="space-y-0.5 flex-1">
                <div class="text-sm font-medium">{{ t("auto_delete_account") }}</div>
                <div class="text-xs text-muted-foreground">
                  {{ t("auto_delete_account_desc") }}
                </div>
              </div>
              <div class="flex items-center gap-2">
                <Select v-model="autoDeletePeriod" @update:modelValue="updateAutoDeletePeriod">
                  <SelectTrigger class="w-[180px]">
                    <SelectValue :placeholder="t('select_period')" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="disabled">{{ t("disabled") }}</SelectItem>
                      <SelectItem value="1">1 {{ t("month") }}</SelectItem>
                      <SelectItem value="3">3 {{ t("months") }}</SelectItem>
                      <SelectItem value="6">6 {{ t("months") }}</SelectItem>
                      <SelectItem value="12">12 {{ t("months") }}</SelectItem>
                      <SelectItem value="18" :disabled="!me.isPremium">
                        18 {{ t("months") }}
                        <span v-if="!me.isPremium" class="text-xs text-muted-foreground ml-1">(Premium)</span>
                      </SelectItem>
                      <SelectItem value="24" :disabled="!me.isPremium">
                        24 {{ t("months") }}
                        <span v-if="!me.isPremium" class="text-xs text-muted-foreground ml-1">(Premium)</span>
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <!-- Delete account -->
            <div class="flex flex-row items-center justify-between rounded-lg border border-destructive/30 p-4">
              <div class="space-y-0.5">
                <div class="text-sm font-medium">{{ t("delete_account") }}</div>
                <div class="text-xs text-muted-foreground">
                  {{ t("delete_account_console_only") }}
                </div>
              </div>
              <Button @click="openConsole" variant="outline" size="sm">
                {{ t("open_console") }}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Add Passkey Dialog -->
    <Dialog v-model:open="showAddPasskeyDialog">
      <DialogContent class="w-[480px] max-w-[480px]" @interactOutside.prevent>
        <DialogHeader>
          <DialogTitle>{{ t("add_passkey") }}</DialogTitle>
        </DialogHeader>
        <div class="space-y-4">
          <div>
            <label class="text-sm font-medium">{{ t("passkey_name") }}</label>
            <Input v-model="newPasskeyName" :placeholder="t('passkey_name_placeholder')" class="mt-2" />
          </div>
        </div>
        <DialogFooter>
          <Button @click="showAddPasskeyDialog = false" variant="outline">
            {{ t("cancel") }}
          </Button>
          <Button @click="addPasskey" :disabled="!newPasskeyName.trim()">
            {{ t("add") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- OTP Setup Dialog -->
    <Dialog v-model:open="showOTPDialog">
      <DialogContent class="w-[480px] max-w-[480px]" @interactOutside.prevent>
        <DialogHeader>
          <DialogTitle>{{ t("setup_two_factor") }}</DialogTitle>
        </DialogHeader>
        <div class="space-y-4">
          <div class="text-sm text-muted-foreground">
            {{ t("setup_two_factor_desc") }}
          </div>
          <div class="flex justify-center p-4">
            <QRStyled :value="otpQrUrl" :size="200" level="M" class="rounded-md shadow-lg" />
          </div>
          <div class="text-xs text-center text-muted-foreground">
            {{ t("scan_with_authenticator") }}
          </div>
          <div class="flex flex-col items-center gap-2">
            <label class="text-sm font-medium">{{ t("verification_code") }}</label>
            <PinInput v-model="otpCode" placeholder="○" @complete="handleOTPComplete">
              <PinInputGroup class="gap-1">
                <template v-for="(id, index) in 6" :key="id">
                  <PinInputInput class="rounded-md border" :index="index" />
                  <template v-if="index !== 5">
                    <PinInputSeparator />
                  </template>
                </template>
              </PinInputGroup>
            </PinInput>
          </div>
        </div>
        <DialogFooter>
          <Button @click="showOTPDialog = false" variant="outline">
            {{ t("cancel") }}
          </Button>
          <Button @click="confirmOTP">
            {{ t("verify") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Disable OTP Dialog -->
    <Dialog v-model:open="showDisableOTPDialog">
      <DialogContent class="w-[480px] max-w-[480px]" @interactOutside.prevent>
        <DialogHeader>
          <DialogTitle>{{ t("disable_two_factor") }}</DialogTitle>
        </DialogHeader>
        <div class="space-y-4">
          <div class="text-sm text-muted-foreground">
            {{ t("disable_two_factor_desc") }}
          </div>
          <div class="flex flex-col items-center gap-2">
            <label class="text-sm font-medium">{{ t("verification_code") }}</label>
            <PinInput v-model="disableOtpCode" placeholder="○" @complete="handleDisableOTPComplete">
              <PinInputGroup class="gap-1">
                <template v-for="(id, index) in 6" :key="id">
                  <PinInputInput class="rounded-md border" :index="index" />
                  <template v-if="index !== 5">
                    <PinInputSeparator />
                  </template>
                </template>
              </PinInputGroup>
            </PinInput>
          </div>
        </div>
        <DialogFooter>
          <Button @click="showDisableOTPDialog = false" variant="outline">
            {{ t("cancel") }}
          </Button>
          <Button @click="confirmDisableOTP" variant="destructive">
            {{ t("disable") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Change Password Dialog -->
    <Dialog v-model:open="showChangePasswordDialog">
      <DialogContent class="w-[480px] max-w-[480px]" @interactOutside.prevent>
        <DialogHeader>
          <DialogTitle>{{ t("change_password") }}</DialogTitle>
        </DialogHeader>
        <div class="space-y-4">
          <div class="text-sm text-muted-foreground">
            {{ t("password_requirements") }}
          </div>
          <InputWithError v-model="currentPassword" type="password" :placeholder="t('current_password')"
            :error="passwordErrors.current" @clear-error="passwordErrors.current = null">
            <template #label>
              <label class="text-sm font-medium">{{ t("current_password") }}</label>
            </template>
          </InputWithError>

          <InputWithError v-model="newPassword" type="password" :placeholder="t('new_password')"
            :error="validateNewPassword">
            <template #label>
              <label class="text-sm font-medium">{{ t("new_password") }}</label>
            </template>
          </InputWithError>

          <InputWithError v-model="confirmPassword" type="password" :placeholder="t('confirm_password')"
            :error="validateConfirmPassword">
            <template #label>
              <label class="text-sm font-medium">{{ t("confirm_password") }}</label>
            </template>
          </InputWithError>
        </div>
        <DialogFooter>
          <Button @click="showChangePasswordDialog = false" variant="outline">
            {{ t("cancel") }}
          </Button>
          <Button @click="changePassword"
            :disabled="isChangingPassword || !!validateNewPassword || !!validateConfirmPassword">
            {{ isChangingPassword ? t("updating") : t("update_password") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Change Email Dialog -->
    <Dialog v-model:open="showChangeEmailDialog">
      <DialogContent class="w-[480px] max-w-[480px]" @interactOutside.prevent>
        <DialogHeader>
          <DialogTitle>{{ t("change_email") }}</DialogTitle>
        </DialogHeader>
        <div class="space-y-4">
          <div class="text-sm text-muted-foreground">
            {{ t("change_email_instructions") }}
          </div>
          <InputWithError v-model="newEmail" type="email" :placeholder="t('new_email_placeholder')"
            :error="validateEmail">
            <template #label>
              <label class="text-sm font-medium">{{ t("new_email") }}</label>
            </template>
          </InputWithError>

          <InputWithError v-model="emailPassword" type="password" :placeholder="t('confirm_with_password')"
            :error="emailErrors.password" @clear-error="emailErrors.password = null">
            <template #label>
              <label class="text-sm font-medium">{{ t("current_password") }}</label>
            </template>
          </InputWithError>
        </div>
        <DialogFooter>
          <Button @click="showChangeEmailDialog = false" variant="outline">
            {{ t("cancel") }}
          </Button>
          <Button @click="requestEmailChange" :disabled="isChangingEmail || !!validateEmail">
            {{ isChangingEmail ? t("sending") : t("send_code") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Email Verification Dialog -->
    <Dialog v-model:open="showEmailVerificationDialog">
      <DialogContent class="w-[480px] max-w-[480px]" @interactOutside.prevent>
        <DialogHeader>
          <DialogTitle>{{ t("verify_email") }}</DialogTitle>
        </DialogHeader>
        <div class="space-y-4">
          <div class="text-sm text-muted-foreground">
            {{ t("verification_code_sent_to") }} <strong>{{ newEmail }}</strong>
          </div>
          <div>
            <label class="text-sm font-medium">{{ t("verification_code") }}</label>
            <Input v-model="verificationCode" type="text" :placeholder="t('enter_6_digit_code')" class="mt-2"
              maxlength="6" />
          </div>
        </div>
        <DialogFooter>
          <Button @click="showEmailVerificationDialog = false" variant="outline">
            {{ t("cancel") }}
          </Button>
          <Button @click="confirmEmailChange" :disabled="isChangingEmail">
            {{ isChangingEmail ? t("verifying") : t("verify") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Change Phone Dialog -->
    <Dialog v-model:open="showChangePhoneDialog">
      <DialogContent class="w-[480px] max-w-[480px]" @interactOutside.prevent>
        <DialogHeader>
          <DialogTitle>{{ userPhone ? t("change_phone") : t("add_phone") }}</DialogTitle>
        </DialogHeader>
        <div class="space-y-4">
          <div class="text-sm text-muted-foreground">
            {{ t("change_phone_instructions") }}
          </div>
          <InputWithError v-model="newPhone" type="tel" :placeholder="t('phone_placeholder')" :error="validatePhone">
            <template #label>
              <label class="text-sm font-medium">{{ t("new_phone") }}</label>
            </template>
          </InputWithError>

          <InputWithError v-model="phonePassword" type="password" :placeholder="t('confirm_with_password')"
            :error="phoneErrors.password" @clear-error="phoneErrors.password = null">
            <template #label>
              <label class="text-sm font-medium">{{ t("current_password") }}</label>
            </template>
          </InputWithError>
        </div>
        <DialogFooter>
          <Button @click="showChangePhoneDialog = false" variant="outline">
            {{ t("cancel") }}
          </Button>
          <Button @click="requestPhoneChange" :disabled="isChangingPhone || !!validatePhone">
            {{ isChangingPhone ? t("sending") : t("send_code") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Phone Verification Dialog -->
    <Dialog v-model:open="showPhoneVerificationDialog">
      <DialogContent class="w-[480px] max-w-[480px]" @interactOutside.prevent>
        <DialogHeader>
          <DialogTitle>{{ t("verify_phone") }}</DialogTitle>
        </DialogHeader>
        <div class="space-y-4">
          <div class="text-sm text-muted-foreground">
            {{ t("verification_code_sent_to_phone") }} <strong>{{ newPhone }}</strong>
          </div>
          <div>
            <label class="text-sm font-medium">{{ t("verification_code") }}</label>
            <Input v-model="phoneVerificationCode" type="text" :placeholder="t('enter_6_digit_code')" class="mt-2"
              maxlength="6" />
          </div>
        </div>
        <DialogFooter>
          <Button @click="showPhoneVerificationDialog = false" variant="outline">
            {{ t("cancel") }}
          </Button>
          <Button @click="confirmPhoneChange" :disabled="isChangingPhone">
            {{ isChangingPhone ? t("verifying") : t("verify") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Remove Phone Dialog -->
    <Dialog v-model:open="showRemovePhoneDialog">
      <DialogContent class="w-[480px] max-w-[480px]" @interactOutside.prevent>
        <DialogHeader>
          <DialogTitle>{{ t("remove_phone") }}</DialogTitle>
        </DialogHeader>
        <div class="space-y-4">
          <div class="text-sm text-muted-foreground">
            {{ t("remove_phone_instructions") }}
          </div>
          <InputWithError v-model="removePhonePassword" type="password" :placeholder="t('confirm_with_password')"
            :error="phoneErrors.removePassword" @clear-error="phoneErrors.removePassword = null">
            <template #label>
              <label class="text-sm font-medium">{{ t("current_password") }}</label>
            </template>
          </InputWithError>
        </div>
        <DialogFooter>
          <Button @click="showRemovePhoneDialog = false" variant="outline">
            {{ t("cancel") }}
          </Button>
          <Button @click="confirmRemovePhone" :disabled="isRemovingPhone" variant="destructive">
            {{ isRemovingPhone ? t("removing") : t("remove") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { Input } from "@argon/ui/input";
import InputWithError from "@/components/shared/InputWithError.vue";
import { Button } from "@argon/ui/button";
import { Badge } from "@argon/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@argon/ui/dialog";
import AvatarUploader from "./AvatarUploader.vue";
import ProfileHeaderUploader from "./ProfileHeaderUploader.vue";
import QRStyled from "../login/QRStyled.vue";
import { useMe } from "@/store/meStore";
import { useLocale } from "@/store/localeStore";
import {
  UserIcon,
  ShieldIcon,
  KeyRoundIcon,
  PlusIcon,
  TrashIcon,
  AlertTriangleIcon,
  PhoneIcon,
  CheckCircle2Icon,
  MailIcon,
} from "lucide-vue-next";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from "@argon/ui/select";
import { PinInput, PinInputGroup, PinInputInput, PinInputSeparator } from "@argon/ui/pin-input";
import { useApi } from "@/store/apiStore";
import { useToast } from "@argon/ui/toast";
import { logger } from "@argon/core";
import { OTPError, PhoneChangeError, UserSecurityDetailsUpdated } from "@argon/glue";
import { useBus } from "@/store/busStore";
import { PasskeyManager, type PasskeyApiCallbacks } from "@argon/passkey";

// Import badge icons
const badgeIcons = import.meta.glob('/packages/assets/icons/inventory/*-64px.png', { eager: true, import: 'default' }) as Record<string, string>;

const { t } = useLocale();
const me = useMe();

const { toast } = useToast();

const api = useApi();
const bus = useBus();

// Create API callbacks for PasskeyManager
const passkeyApiCallbacks: PasskeyApiCallbacks = {
  beginAddPasskey: async (name: string) => {
    const result = await api.securityInteraction.BeginAddPasskey(name);
    if (result.isSuccessBeginPasskey()) {
      return {
        success: true,
        passkeyId: result.passkeyId,
        challenge: result.challenge,
      };
    }
    return { success: false };
  },
  completeAddPasskey: async (passkeyId: string, publicKey: string) => {
    const result = await api.securityInteraction.CompleteAddPasskey(passkeyId, publicKey);
    if (result.isSuccessCompletePasskey()) {
      const passkey = (result as any).passkey;
      logger.warn("BeginValidatePasskey result:", result);
      return {
        success: true,
        passkey: passkey ? {
          id: passkey.id.toString(),
          name: passkey.name,
          createdAt: passkey.createdAt.date,
        } : undefined,
      };
    }
    return { success: false };
  },
  removePasskey: async (passkeyId: string) => {
    const result = await api.securityInteraction.RemovePasskey(passkeyId);
    return {
      success: result.isSuccessRemovePasskey(),
    };
  },
  beginValidatePasskey: async () => {
    const result = await api.securityInteraction.BeginValidatePasskey();
    if (result.isSuccessBeginValidatePasskey()) {
      logger.warn("BeginValidatePasskey result:", result);
      return {
        success: true,
        challenge: result.challenge,
        allowedCredentials: result.allowedCredentials,
      };
    }
    return { success: false };
  },
  completeValidatePasskey: async (
    credentialId: string,
    signature: string,
    authenticatorData: string,
    clientDataJSON: string
  ) => {
    const result = await api.securityInteraction.CompleteValidatePasskey(
      credentialId,
      signature,
      authenticatorData,
      clientDataJSON
    );
    return {
      success: result.isSuccessCompletePasskey(),
    };
  },
};

const passkeyManager = new PasskeyManager(passkeyApiCallbacks, {
  relyingPartyId: "argon.gl",
  relyingPartyName: "ArgonChat",
  origin: "https://aegis.argon.gl",
  timeoutMilliseconds: 60000,
});


// Email State
const userEmail = ref("user@example.com"); // TODO: Load from API
const showChangeEmailDialog = ref(false);
const showEmailVerificationDialog = ref(false);
const newEmail = ref("");
const emailPassword = ref("");
const verificationCode = ref("");
const isChangingEmail = ref(false);

const emailErrors = reactive({
  email: null as string | null,
  password: null as string | null,
  verification: null as string | null,
});

const validateEmail = computed(() => {
  if (!newEmail.value) return null;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(newEmail.value)) return t("invalid_email");
  return null;
});

// Phone State
const userPhone = ref(""); // TODO: Load from API
const showChangePhoneDialog = ref(false);
const showPhoneVerificationDialog = ref(false);
const showRemovePhoneDialog = ref(false);
const newPhone = ref("");
const phonePassword = ref("");
const phoneVerificationCode = ref("");
const removePhonePassword = ref("");
const isChangingPhone = ref(false);
const isRemovingPhone = ref(false);

const phoneErrors = reactive({
  phone: null as string | null,
  password: null as string | null,
  verification: null as string | null,
  removePassword: null as string | null,
});

const validatePhone = computed(() => {
  if (!newPhone.value) return null;
  // Basic international phone format validation
  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  if (!phoneRegex.test(newPhone.value.replace(/[\s-()]/g, ""))) return t("invalid_phone");
  return null;
});

// Auto-delete State
const autoDeletePeriod = ref("disabled");

// OTP State
const otpEnabled = ref(false);
const showOTPDialog = ref(false);
const showDisableOTPDialog = ref(false);
const otpCode = ref([] as string[]);
const disableOtpCode = ref([] as string[]);
const otpQrUrl = ref("otpauth://totp/Argon:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Argon");

// Passkeys State
const showAddPasskeyDialog = ref(false);
const newPasskeyName = ref("");
const passkeys = ref<Array<{ id: string; name: string; createdAt: Date }>>([
  // TODO: Load from API - api.userInteraction.GetPasskeys()
  { id: "1", name: "MacBook Pro", createdAt: new Date("2024-01-15") },
  { id: "2", name: "iPhone 15", createdAt: new Date("2024-02-20") },
]);

// Password State
const showChangePasswordDialog = ref(false);
const currentPassword = ref("");
const newPassword = ref("");
const confirmPassword = ref("");
const isChangingPassword = ref(false);

const passwordErrors = reactive({
  current: null as string | null,
  new: null as string | null,
  confirm: null as string | null,
});

// Password validation computed
const validateNewPassword = computed(() => {
  if (!newPassword.value) return null;
  if (newPassword.value.length < 8) return t("password_too_short");

  const hasLetter = /[a-zA-Z]/.test(newPassword.value);
  const hasNumber = /[0-9]/.test(newPassword.value);
  if (!hasLetter || !hasNumber) return t("password_weak");

  if (currentPassword.value && currentPassword.value === newPassword.value) {
    return t("password_same_as_current");
  }

  return null;
});

const validateConfirmPassword = computed(() => {
  if (!confirmPassword.value) return null;
  if (newPassword.value && confirmPassword.value !== newPassword.value) {
    return t("passwords_dont_match");
  }
  return null;
});

const openConsole = () => {
  window.open("https://console.argon.gl", "_blank");
};

const onProfileUpdated = () => {
  console.log("Profile updated successfully");
  // Refresh user data if needed
};

const updateAutoDeletePeriod = async (value: string | number | bigint | Record<string, any> | null) => {
  if (!value) return;

  const stringValue = String(value);

  // Check if premium is required for 18/24 months
  // TODO: Add proper premium check when me.me has isPremium property
  const isPremium = false; // Replace with actual premium check
  if ((stringValue === "18" || stringValue === "24") && !isPremium) {
    toast({
      title: t("premium_required"),
      description: t("premium_required_auto_delete"),
      variant: "destructive",
    });
    autoDeletePeriod.value = "disabled";
    return;
  }

  try {
    const result = await api.securityInteraction.SetAutoDeletePeriod(
      stringValue === "disabled" ? null : parseInt(stringValue)
    );

    if (result.isSuccessSetAutoDelete()) {
      autoDeletePeriod.value = stringValue;

      toast({
        title: t("auto_delete_updated"),
        description: stringValue === "disabled"
          ? t("auto_delete_disabled")
          : t("auto_delete_set_to", { months: stringValue }),
      });
    } else {
      autoDeletePeriod.value = "disabled";
      toast({
        title: t("error"),
        description: t("auto_delete_failed"),
        variant: "destructive",
      });
    }
  } catch (error) {
    autoDeletePeriod.value = "disabled";
    toast({
      title: t("error"),
      description: t("auto_delete_failed"),
      variant: "destructive",
    });
  }
};

const requestEmailChange = async () => {
  if (!newEmail.value || !emailPassword.value) {
    toast({
      title: t("error"),
      description: t("fill_all_fields"),
      variant: "destructive",
    });
    return;
  }

  if (validateEmail.value) {
    return;
  }

  isChangingEmail.value = true;

  try {
    const result = await api.securityInteraction.RequestEmailChange(newEmail.value, emailPassword.value);

    if (result.isSuccessRequestEmailChange()) {
      showChangeEmailDialog.value = false;
      showEmailVerificationDialog.value = true;

      toast({
        title: t("verification_code_sent"),
        description: t("check_your_email"),
      });
    } else {
      toast({
        title: t("error"),
        description: t("email_change_failed"),
        variant: "destructive",
      });
    }
  } catch (error) {
    toast({
      title: t("error"),
      description: t("email_change_failed"),
      variant: "destructive",
    });
  } finally {
    isChangingEmail.value = false;
  }
};

const confirmEmailChange = async () => {
  if (!verificationCode.value) {
    toast({
      title: t("error"),
      description: t("enter_verification_code"),
      variant: "destructive",
    });
    return;
  }

  isChangingEmail.value = true;

  try {
    const result = await api.securityInteraction.ConfirmEmailChange(verificationCode.value);

    if (result.isSuccessConfirmEmailChange()) {
      userEmail.value = newEmail.value;
      showEmailVerificationDialog.value = false;
      newEmail.value = "";
      emailPassword.value = "";
      verificationCode.value = "";

      toast({
        title: t("email_changed"),
        description: t("email_changed_desc"),
      });
    } else {
      toast({
        title: t("error"),
        description: t("verification_failed"),
        variant: "destructive",
      });
    }
  } catch (error) {
    toast({
      title: t("error"),
      description: t("verification_failed"),
      variant: "destructive",
    });
  } finally {
    isChangingEmail.value = false;
  }
};

const requestPhoneChange = async () => {
  // Clear previous errors
  phoneErrors.password = null;

  if (!newPhone.value || !phonePassword.value) {
    if (!phonePassword.value) {
      phoneErrors.password = t("password_required");
    }
    toast({
      title: t("error"),
      description: t("fill_all_fields"),
      variant: "destructive",
    });
    return;
  }

  if (validatePhone.value) {
    console.log("Phone validation failed:", validatePhone.value);
    toast({
      title: t("error"),
      description: validatePhone.value,
      variant: "destructive",
    });
    return;
  }

  isChangingPhone.value = true;

  try {
    console.log("Calling RequestPhoneChange API...");
    const result = await api.securityInteraction.RequestPhoneChange(newPhone.value, phonePassword.value);
    console.log("RequestPhoneChange result:", result);

    if (result.isSuccessRequestPhoneChange()) {
      showChangePhoneDialog.value = false;
      showPhoneVerificationDialog.value = true;

      toast({
        title: t("verification_code_sent"),
        description: t("check_your_phone"),
      });
    }
    if (result.isFailedRequestPhoneChange()) {

      console.error("RequestPhoneChange failed:", result, PhoneChangeError[result.error]);
      toast({
        title: t("error"),
        description: t("phone_change_failed"),
        variant: "destructive",
      });
    }
  } catch (error) {
    console.error("RequestPhoneChange exception:", error);
    toast({
      title: t("error"),
      description: t("phone_change_failed"),
      variant: "destructive",
    });
  } finally {
    isChangingPhone.value = false;
  }
};

const confirmPhoneChange = async () => {
  if (!phoneVerificationCode.value) {
    toast({
      title: t("error"),
      description: t("enter_verification_code"),
      variant: "destructive",
    });
    return;
  }

  isChangingPhone.value = true;

  try {
    const result = await api.securityInteraction.ConfirmPhoneChange(phoneVerificationCode.value);

    if (result.isSuccessConfirmPhoneChange()) {
      userPhone.value = newPhone.value;
      showPhoneVerificationDialog.value = false;
      newPhone.value = "";
      phonePassword.value = "";
      phoneVerificationCode.value = "";

      toast({
        title: t("phone_changed"),
        description: t("phone_changed_desc"),
      });
    } else {
      toast({
        title: t("error"),
        description: t("verification_failed"),
        variant: "destructive",
      });
    }
  } catch (error) {
    toast({
      title: t("error"),
      description: t("verification_failed"),
      variant: "destructive",
    });
  } finally {
    isChangingPhone.value = false;
  }
};

const confirmRemovePhone = async () => {
  if (!removePhonePassword.value) {
    toast({
      title: t("error"),
      description: t("enter_password"),
      variant: "destructive",
    });
    return;
  }

  isRemovingPhone.value = true;

  try {
    const result = await api.securityInteraction.RemovePhone(removePhonePassword.value);

    if (result.isSuccessRemovePhone()) {
      userPhone.value = "";
      showRemovePhoneDialog.value = false;
      removePhonePassword.value = "";

      toast({
        title: t("phone_removed"),
        description: t("phone_removed_desc"),
      });
    } else {
      toast({
        title: t("error"),
        description: t("phone_remove_failed"),
        variant: "destructive",
      });
    }
  } catch (error) {
    toast({
      title: t("error"),
      description: t("phone_remove_failed"),
      variant: "destructive",
    });
  } finally {
    isRemovingPhone.value = false;
  }
};

const toggleOTP = async () => {
  if (otpEnabled.value) {
    // Show disable OTP confirmation dialog
    showDisableOTPDialog.value = true;
  } else {
    // Request OTP setup from API
    try {
      const result = await api.securityInteraction.EnableOTP();

      console.log("EnableOTP result:", result);

      if (result.isSuccessEnableOTP()) {
        otpQrUrl.value = result.qrCodeUrl!;
        showOTPDialog.value = true;
        console.log("Dialog should be open, showOTPDialog:", showOTPDialog.value);
      } else {
        if (result.isFailedEnableOTP()) {
          logger.error("EnableOTP failed with reason:", OTPError[result.error]);
        }
        toast({
          title: t("error"),
          description: t("otp_enable_failed"),
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("EnableOTP exception:", error);
      toast({
        title: t("error"),
        description: t("otp_enable_failed"),
        variant: "destructive",
      });
    }
  }
};

const handleOTPComplete = async (code: string[]) => {
  const codeString = code.join("");
  try {
    const result = await api.securityInteraction.VerifyAndEnableOTP(codeString);

    if (result.isSuccessVerifyOTP()) {
      otpEnabled.value = true;
      showOTPDialog.value = false;
      otpCode.value = [];

      toast({
        title: t("otp_enabled"),
        description: t("otp_enabled_desc"),
      });
    } else {
      toast({
        title: t("error"),
        description: t("invalid_code"),
        variant: "destructive",
      });
    }
  } catch (error) {
    toast({
      title: t("error"),
      description: t("otp_enable_failed"),
      variant: "destructive",
    });
  }
};

const confirmOTP = async () => {
  if (otpCode.value.length !== 6) {
    toast({
      title: t("error"),
      description: t("enter_code"),
      variant: "destructive",
    });
    return;
  }

  const codeString = otpCode.value.join("");
  try {
    const result = await api.securityInteraction.VerifyAndEnableOTP(codeString);

    if (result.isSuccessVerifyOTP()) {
      otpEnabled.value = true;
      showOTPDialog.value = false;
      otpCode.value = [];

      toast({
        title: t("otp_enabled"),
        description: t("otp_enabled_desc"),
      });
    } else {
      toast({
        title: t("error"),
        description: t("invalid_code"),
        variant: "destructive",
      });
    }
  } catch (error) {
    toast({
      title: t("error"),
      description: t("otp_enable_failed"),
      variant: "destructive",
    });
  }
};

const handleDisableOTPComplete = async (code: string[]) => {
  const codeString = code.join("");
  try {
    const result = await api.securityInteraction.DisableOTP(codeString);

    if (result.isSuccessDisableOTP()) {
      otpEnabled.value = false;
      showDisableOTPDialog.value = false;
      disableOtpCode.value = [];

      toast({
        title: t("otp_disabled"),
        description: t("otp_disabled_desc"),
      });
    } else {
      toast({
        title: t("error"),
        description: t("invalid_code"),
        variant: "destructive",
      });
    }
  } catch (error) {
    toast({
      title: t("error"),
      description: t("otp_disable_failed"),
      variant: "destructive",
    });
  }
};

const confirmDisableOTP = async () => {
  if (disableOtpCode.value.length !== 6) {
    toast({
      title: t("error"),
      description: t("enter_code"),
      variant: "destructive",
    });
    return;
  }

  const codeString = disableOtpCode.value.join("");
  try {
    const result = await api.securityInteraction.DisableOTP(codeString);

    if (result.isSuccessDisableOTP()) {
      otpEnabled.value = false;
      showDisableOTPDialog.value = false;
      disableOtpCode.value = [];

      toast({
        title: t("otp_disabled"),
        description: t("otp_disabled_desc"),
      });
    } else {
      toast({
        title: t("error"),
        description: t("invalid_code"),
        variant: "destructive",
      });
    }
  } catch (error) {
    toast({
      title: t("error"),
      description: t("otp_disable_failed"),
      variant: "destructive",
    });
  }
};

const addPasskey = async () => {
  if (!newPasskeyName.value.trim()) {
    return;
  }

  if (!me.me) {
    toast({
      title: t("error"),
      description: t("user_not_loaded"),
      variant: "destructive",
    });
    return;
  }

  const result = await passkeyManager.createPasskey(newPasskeyName.value, {
    userId: me.me.userId,
    username: me.me.username,
    displayName: me.me.displayName,
  });

  if (result.success) {
    passkeys.value.push({
      id: result.passkeyId!,
      name: result.name!,
      createdAt: result.createdAt!,
    });
    showAddPasskeyDialog.value = false;
    newPasskeyName.value = "";

    toast({
      title: t("passkey_added"),
      description: t("passkey_added_desc"),
    });
  } else {
    // Handle specific error codes
    if (result.errorCode === "CANCELLED") {
      toast({
        title: t("cancelled"),
        description: t("passkey_add_cancelled"),
      });
    } else if (result.errorCode === "NOT_SUPPORTED") {
      toast({
        title: t("error"),
        description: "WebAuthn not supported on this device",
        variant: "destructive",
      });
    } else if (result.errorCode === "INVALID_STATE") {
      toast({
        title: t("error"),
        description: "This authenticator is already registered",
        variant: "destructive",
      });
    } else {
      toast({
        title: t("error"),
        description: result.error || t("passkey_add_error"),
        variant: "destructive",
      });
    }
  }
};

const removePasskey = async (id: string) => {
  const index = passkeys.value.findIndex((p) => p.id === id);
  
  if (index === -1) {
    return;
  }

  const passkey = passkeys.value[index];
  const result = await passkeyManager.removePasskey(id);

  if (result.success) {
    passkeys.value.splice(index, 1);

    toast({
      title: t("passkey_removed"),
      description: `${passkey.name} ${t("has_been_removed")}`,
    });
  } else {
    toast({
      title: t("error"),
      description: result.error || t("passkey_remove_error"),
      variant: "destructive",
    });
  }
};

const testPasskey = async (id: string) => {
  const passkey = passkeys.value.find((p) => p.id === id);
  
  if (!passkey) {
    return;
  }

  const result = await passkeyManager.validatePasskey();

  if (result.success) {
    toast({
      title: t("passkey_test_success"),
      description: `${passkey.name} ${t("works_correctly")}`,
    });
  } else {
    if (result.errorCode === "CANCELLED") {
      toast({
        title: t("cancelled"),
        description: t("passkey_test_cancelled"),
      });
    } else {
      toast({
        title: t("error"),
        description: result.error || t("passkey_test_error"),
        variant: "destructive",
      });
    }
  }
};

const changePassword = async () => {
  // Validate all fields
  if (!currentPassword.value || !newPassword.value || !confirmPassword.value) {
    toast({
      title: t("error"),
      description: t("fill_all_fields"),
      variant: "destructive",
    });
    return;
  }

  if (validateNewPassword.value || validateConfirmPassword.value) {
    return;
  }

  isChangingPassword.value = true;

  try {
    const result = await api.securityInteraction.ChangePassword(currentPassword.value, newPassword.value);

    if (result.isSuccessChangePassword()) {
      showChangePasswordDialog.value = false;
      currentPassword.value = "";
      newPassword.value = "";
      confirmPassword.value = "";

      toast({
        title: t("password_changed"),
        description: t("password_changed_desc"),
      });
    } else {
      toast({
        title: t("error"),
        description: t("password_change_failed"),
        variant: "destructive",
      });
    }
  } catch (error) {
    toast({
      title: t("error"),
      description: t("password_change_failed"),
      variant: "destructive",
    });
  } finally {
    isChangingPassword.value = false;
  }
};

const maskEmail = (email: string) => {
  if (!email || email === "user@example.com") return email;
  const [local, domain] = email.split("@");
  if (!domain) return email;
  
  if (local.length <= 2) {
    return `${local[0]}***@${domain}`;
  }
  
  return `${local.substring(0, 2)}***@${domain}`;
};

const maskPhone = (phone: string) => {
  if (!phone) return phone;
  
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, "");
  
  if (digits.length < 4) return phone;
  
  // Show first 2 and last 2 digits
  const first = digits.substring(0, 2);
  const last = digits.substring(digits.length - 2);
  const masked = "*".repeat(Math.min(digits.length - 4, 7));
  
  return `+${first} ${masked} ${last}`;
};

const formatDate = (date: Date) => {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
};

const getBadgeIcon = (badge: string) => {
  const badgeId = badge === "staff" ? "coin_argxstaff" : badge;
  return badgeIcons[`/packages/assets/icons/inventory/${badgeId}-64px.png`];
};

// Load initial data
onMounted(async () => {
  try {
    // Load all security details in one call
    const details = await api.securityInteraction.GetSecurityDetails();

    // Update all states from the response
    otpEnabled.value = details.otpEnabled;

    passkeys.value = details.passkeys.map(pk => ({
      id: pk.id.toString(),
      name: pk.name,
      createdAt: pk.createdAt.date,
    }));

    autoDeletePeriod.value = details.autoDeletePeriod.enabled && details.autoDeletePeriod.months
      ? details.autoDeletePeriod.months.toString()
      : "disabled";

    userEmail.value = details.email ?? "user@example.com";
    userPhone.value = details.phone ?? "";

    bus.onServerEvent<UserSecurityDetailsUpdated>("UserSecurityDetailsUpdated", (event) => {
      if (event.userId === me.me?.userId) {
        otpEnabled.value = event.details.otpEnabled;

        passkeys.value = event.details.passkeys.map(pk => ({
          id: pk.id.toString(),
          name: pk.name,
          createdAt: pk.createdAt.date,
        }));

        autoDeletePeriod.value = event.details.autoDeletePeriod.enabled && event.details.autoDeletePeriod.months
          ? event.details.autoDeletePeriod.months.toString()
          : "disabled";

        userEmail.value = event.details.email ?? "user@example.com";
        userPhone.value = event.details.phone ?? "";
      }
    });
  } catch (error) {
    console.error("Failed to load profile settings:", error);
  }
});
</script>

<style scoped>
.profile-settings-container {
  max-width: 900px;
  margin: 0 auto;
}

.setting-card {
  border-radius: 0.5rem;
  border: 1px solid hsl(var(--border) / 0.5);
  background-color: hsl(var(--card));
  padding: 1.5rem;
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
</style>

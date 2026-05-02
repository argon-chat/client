<template>
  <div>
    <div class="profile-settings-container">
      <div v-if="!me.me" class="flex items-center justify-center min-h-[400px]">
        <div class="text-muted-foreground">Loading...</div>
      </div>

      <div v-else class="space-y-6">
        <!-- Profile & Customization Card (merged) -->
        <div class="setting-card">
          <div class="flex items-center gap-2 mb-5">
            <PaletteIcon class="w-5 h-5 text-primary" />
            <h3 class="text-lg font-semibold">{{ t("profile_customization") || "Profile Customization" }}</h3>
          </div>

          <div class="flex flex-col xl:flex-row gap-6">
            <!-- Live Preview + Avatar Uploader -->
            <div class="flex-shrink-0 space-y-3">
              <div class="text-xs font-medium text-muted-foreground uppercase tracking-wider">{{ t("preview") || "Preview" }}</div>
              <ProfileCardPreview
                :display-name="editDisplayName || me.me.displayName"
                :username="me.me.username"
                :user-id="me.me.userId"
                :avatar-file-id="me.me.avatarFileId"
                :is-premium="me.isPremium"
                :custom-status="editCustomStatus"
                :bio="editBio"
                :primary-color="editPrimaryColor"
                :accent-color="editAccentColor"
                :background-id="editBackgroundId"
                editable
                @click-avatar="avatarFileInput?.click()"
              />
              <input
                ref="avatarFileInput"
                type="file"
                accept="image/jpeg, image/jpg, image/png, image/gif, video/webm"
                class="hidden"
                @change="onAvatarFileSelected"
              />
              <AvatarCropDialog
                v-model:open="showAvatarCropDialog"
                v-model:image-src="avatarCropSrc"
                @avatar-updated="onProfileUpdated"
              />
            </div>

            <!-- Controls -->
            <div class="flex-1 space-y-5 min-w-0">
              <!-- Display Name -->
              <div>
                <label class="text-sm font-medium">{{ t("display_name") || "Display Name" }}</label>
                <Input v-model="editDisplayName" type="text" class="mt-1.5" :placeholder="me.me.displayName" :maxlength="32" />
              </div>

              <!-- Bio -->
              <div>
                <label class="text-sm font-medium">{{ t("bio") || "Bio" }}</label>
                <textarea v-model="editBio" class="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none" rows="2" :placeholder="t('tell_about_yourself') || 'Tell people about yourself...'" :maxlength="190"></textarea>
              </div>

              <!-- ═══ PREMIUM-GATED SECTION ═══ -->
              <div v-if="ultimaActive" class="premium-gate" :class="{ 'premium-gate--locked': !me.isPremium }">
                <!-- Lock overlay for non-premium -->
                <div v-if="!me.isPremium" class="premium-gate-overlay" @click="scrollToUpsell">
                  <div class="premium-gate-overlay-content">
                    <LockIcon class="w-4 h-4" />
                    <span>Ultima Premium</span>
                  </div>
                </div>

                <!-- Custom Status -->
                <div>
                  <label class="text-sm font-medium">{{ t("custom_status") || "Custom Status" }}</label>
                  <Input v-model="editCustomStatus" type="text" class="mt-1.5" :disabled="!me.isPremium" :placeholder="t('set_custom_status') || 'Set a custom status...'" :maxlength="128" />
                </div>

                <!-- Colors: Primary + Accent side by side -->
                <div class="grid grid-cols-2 gap-4 mt-5">
                  <div>
                    <div class="text-sm font-medium mb-2">{{ t("primary_color") || "Primary Color" }}</div>
                    <div class="color-strip">
                      <button
                        v-for="preset in COLOR_PRESETS"
                        :key="'p' + preset.argb"
                        class="color-dot"
                        :class="{ 'color-dot--active': editPrimaryColor === preset.argb }"
                        :style="{ background: argbToHex(preset.argb) }"
                        :title="preset.name"
                        @click="editPrimaryColor = preset.argb"
                      />
                      <label class="color-dot color-dot--custom" title="Custom">
                        <input
                          type="color"
                          :value="editPrimaryColor ? argbToHex(editPrimaryColor) : '#6366f1'"
                          @input="editPrimaryColor = hexToArgb(($event.target as HTMLInputElement).value)"
                          class="sr-only"
                        />
                        <PipetteIcon class="w-3 h-3" />
                      </label>
                      <button
                        v-if="editPrimaryColor != null"
                        class="color-dot color-dot--reset"
                        @click="editPrimaryColor = null"
                        :title="t('reset') || 'Reset'"
                      >
                        <XIcon class="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <div>
                    <div class="text-sm font-medium mb-2">{{ t("accent_color") || "Accent Color" }}</div>
                    <div class="color-strip">
                      <button
                        v-for="preset in COLOR_PRESETS"
                        :key="'a' + preset.argb"
                        class="color-dot"
                        :class="{ 'color-dot--active': editAccentColor === preset.argb }"
                        :style="{ background: argbToHex(preset.argb) }"
                        :title="preset.name"
                        @click="editAccentColor = preset.argb"
                      />
                      <label class="color-dot color-dot--custom" title="Custom">
                        <input
                          type="color"
                          :value="editAccentColor ? argbToHex(editAccentColor) : '#8b5cf6'"
                          @input="editAccentColor = hexToArgb(($event.target as HTMLInputElement).value)"
                          class="sr-only"
                        />
                        <PipetteIcon class="w-3 h-3" />
                      </label>
                      <button
                        v-if="editAccentColor != null"
                        class="color-dot color-dot--reset"
                        @click="editAccentColor = null"
                        :title="t('reset') || 'Reset'"
                      >
                        <XIcon class="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>

                <!-- Background (horizontal scroll) -->
                <div class="mt-5">
                  <div class="text-sm font-medium mb-2">{{ t("profile_background") || "Background" }}</div>
                  <div class="bg-scroll">
                    <!-- None option -->
                    <button
                      class="bg-scroll-item"
                      :class="{ 'bg-scroll-item--active': editBackgroundId == null }"
                      @click="editBackgroundId = null"
                    >
                      <div class="bg-scroll-thumb bg-scroll-thumb--none">
                        <XIcon class="w-4 h-4 text-muted-foreground" />
                      </div>
                      <span class="bg-scroll-label">{{ t("none") || "None" }}</span>
                    </button>
                    <!-- Background options -->
                    <button
                      v-for="bg in PROFILE_BACKGROUNDS"
                      :key="bg.id"
                      class="bg-scroll-item"
                      :class="{ 'bg-scroll-item--active': editBackgroundId === bg.id }"
                      @click="editBackgroundId = bg.id"
                      @mouseenter="($event.currentTarget as HTMLElement).querySelector('video')?.play()"
                      @mouseleave="($event.currentTarget as HTMLElement).querySelector('video')?.pause()"
                    >
                      <div class="bg-scroll-thumb">
                        <video :src="bg.src" muted loop playsinline preload="metadata" class="bg-scroll-video" />
                      </div>
                      <span class="bg-scroll-label">{{ bg.name }}</span>
                    </button>
                  </div>
                </div>
              </div>
              <!-- ═══ END PREMIUM-GATED SECTION ═══ -->

              <!-- Save button -->
              <div class="flex items-center gap-3 pt-1">
                <Button @click="saveCustomization" :disabled="isSavingCustomization">
                  {{ isSavingCustomization ? t("saving") || "Saving..." : t("save_changes") || "Save Changes" }}
                </Button>
                <span v-if="customizationDirty" class="text-xs text-muted-foreground">{{ t("unsaved_changes") || "Unsaved changes" }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Username Card (read-only, separate) -->
        <div class="setting-card">
          <div class="flex items-center gap-2 mb-4">
            <UserIcon class="w-5 h-5 text-primary" />
            <h3 class="text-lg font-semibold">{{ t("profile_information") }}</h3>
          </div>
          <div class="setting-item">
            <div class="flex-1">
              <div class="text-sm font-medium">{{ t("username") }}</div>
              <div class="text-xs text-muted-foreground">{{ t("username_desc") }}</div>
            </div>
            <Input readonly disabled v-model="me.me.username" type="text" class="w-[250px]" placeholder="username" />
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
            <div v-if="passkeyActive" class="rounded-lg border p-4 space-y-4">
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
            <div v-if="autoDeleteAccountActive" class="flex flex-row items-center justify-between rounded-lg border border-destructive/30 p-4">
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

    <!-- ═══ ULTIMA PREMIUM MODAL ═══ -->
    <Dialog v-if="ultimaActive" v-model:open="showUpsellModal">
      <DialogContent class="max-w-[520px] p-0 bg-transparent border border-violet-500/30 rounded-3xl overflow-hidden gap-0" @interactOutside.prevent>
        <!-- Aurora background -->
        <div class="upsell-aurora">
          <div class="upsell-aurora-layer upsell-a1" />
          <div class="upsell-aurora-layer upsell-a2" />
          <div class="upsell-aurora-layer upsell-a3" />
        </div>
        <div class="upsell-noise" />

        <!-- Stars -->
        <svg class="upsell-stars" viewBox="0 0 500 300" fill="none" preserveAspectRatio="xMidYMid slice">
          <circle class="upsell-star us1" cx="60" cy="40" r="1.2" fill="white" />
          <circle class="upsell-star us2" cx="440" cy="60" r="0.9" fill="white" />
          <circle class="upsell-star us3" cx="120" cy="240" r="1" fill="white" />
          <circle class="upsell-star us4" cx="380" cy="230" r="1.3" fill="white" />
          <circle class="upsell-star us5" cx="250" cy="30" r="0.8" fill="white" />
          <circle class="upsell-star us6" cx="420" cy="150" r="1.1" fill="white" />
          <circle class="upsell-star us7" cx="80" cy="140" r="0.7" fill="white" />
        </svg>

        <!-- Content -->
        <div class="upsell-modal-inner">
          <!-- Diamond -->
          <div class="upsell-diamond">
            <svg viewBox="0 0 120 140" fill="none" class="upsell-gem">
              <path d="M60 10L95 45L60 130L25 45L60 10Z" fill="url(#uGemMain)"/>
              <path d="M60 10L95 45L60 50L25 45L60 10Z" fill="url(#uGemTop)" opacity="0.9"/>
              <path d="M25 45L60 50L60 130Z" fill="hsl(270 50% 30% / 0.4)"/>
              <path d="M95 45L60 50L60 130Z" fill="hsl(280 40% 25% / 0.3)"/>
              <path d="M60 10L40 30" stroke="hsl(270 90% 85% / 0.6)" stroke-width="1.5" stroke-linecap="round"/>
              <path d="M25 45H95" stroke="hsl(270 70% 70% / 0.3)" stroke-width="0.75"/>
              <circle cx="38" cy="28" r="2" fill="white" opacity="0.7" class="upsell-sparkle us-a"/>
              <circle cx="75" cy="38" r="1.5" fill="white" opacity="0.5" class="upsell-sparkle us-b"/>
              <circle cx="55" cy="70" r="1" fill="white" opacity="0.3" class="upsell-sparkle us-c"/>
              <defs>
                <linearGradient id="uGemMain" x1="25" y1="10" x2="95" y2="130">
                  <stop stop-color="hsl(270 70% 35%)"/><stop offset="0.4" stop-color="hsl(280 60% 28%)"/><stop offset="1" stop-color="hsl(300 50% 18%)"/>
                </linearGradient>
                <linearGradient id="uGemTop" x1="25" y1="10" x2="95" y2="50">
                  <stop stop-color="hsl(270 80% 50%)"/><stop offset="1" stop-color="hsl(290 60% 35%)"/>
                </linearGradient>
              </defs>
            </svg>
            <div class="upsell-diamond-rays" />
          </div>

          <!-- Title -->
          <h2 class="upsell-title"><span class="upsell-holo">Ultima</span></h2>
          <p class="upsell-tagline">{{ t('unlock_full_profile') }}</p>

          <!-- Perks Grid -->
          <div class="upsell-perks">
            <div class="upsell-perk">
              <div class="upsell-perk-icon">✨</div>
              <div class="upsell-perk-text">
                <div class="upsell-perk-label">{{ t('perk_animated_avatars') }}</div>
                <div class="upsell-perk-desc">{{ t('ultima_perk_avatars_desc') }}</div>
              </div>
            </div>
            <div class="upsell-perk">
              <div class="upsell-perk-icon">🎨</div>
              <div class="upsell-perk-text">
                <div class="upsell-perk-label">{{ t('perk_custom_colors') }}</div>
                <div class="upsell-perk-desc">{{ t('ultima_perk_themes_desc') }}</div>
              </div>
            </div>
            <div class="upsell-perk">
              <div class="upsell-perk-icon">🖼️</div>
              <div class="upsell-perk-text">
                <div class="upsell-perk-label">{{ t('perk_profile_backgrounds') }}</div>
                <div class="upsell-perk-desc">{{ t('ultima_perk_uploads_desc') }}</div>
              </div>
            </div>
            <div class="upsell-perk">
              <div class="upsell-perk-icon">💬</div>
              <div class="upsell-perk-text">
                <div class="upsell-perk-label">{{ t('perk_custom_status') }}</div>
                <div class="upsell-perk-desc">{{ t('ultima_perk_badge_desc') }}</div>
              </div>
            </div>
          </div>

          <!-- Pricing Cards -->
          <div v-if="ultima.pricing" class="upsell-pricing">
            <button
              class="upsell-plan"
              :class="{ 'upsell-plan--active': selectedUltimaPlan === UltimaPlan.Monthly }"
              @click="selectedUltimaPlan = UltimaPlan.Monthly"
            >
              <div class="upsell-plan-border" />
              <span class="upsell-plan-tier">{{ t('ultima_monthly') }}</span>
              <span class="upsell-plan-price">{{ ultima.pricing.subscriptionMonthly.amount }} <small>{{ ultima.pricing.subscriptionMonthly.currency }}</small></span>
              <span class="upsell-plan-cycle">{{ t('ultima_per_month') }}</span>
            </button>
            <button
              class="upsell-plan"
              :class="{ 'upsell-plan--active': selectedUltimaPlan === UltimaPlan.Annual }"
              @click="selectedUltimaPlan = UltimaPlan.Annual"
            >
              <div class="upsell-plan-border" />
              <div v-if="ultima.pricing.subscriptionAnnual.amountWithoutDiscount" class="upsell-plan-badge">{{ t('ultima_best_value') }}</div>
              <span class="upsell-plan-tier">{{ t('ultima_annual') }}</span>
              <span class="upsell-plan-price">{{ ultima.pricing.subscriptionAnnual.amount }} <small>{{ ultima.pricing.subscriptionAnnual.currency }}</small></span>
              <span class="upsell-plan-cycle">{{ t('ultima_per_year') }}</span>
              <span v-if="ultima.pricing.subscriptionAnnual.amountWithoutDiscount" class="upsell-plan-was">
                {{ t('ultima_was', { amount: ultima.pricing.subscriptionAnnual.amountWithoutDiscount, currency: ultima.pricing.subscriptionAnnual.currency }) }}
              </span>
            </button>
          </div>

          <!-- CTA Button -->
          <button class="upsell-cta" @click="handleUpsellSubscribe" :disabled="upsellCheckingOut">
            <div class="upsell-cta-shimmer" />
            <Loader2 v-if="upsellCheckingOut" class="w-5 h-5 animate-spin" />
            <template v-else>
              <span>{{ t('ultima_get') }}</span>
              <svg viewBox="0 0 20 20" fill="none" class="upsell-cta-arrow"><path d="M4 10h12M12 6l4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </template>
          </button>
        </div>
      </DialogContent>
    </Dialog>

    <!-- Ultima Checkout Dialog -->
    <UltimaCheckoutDialog v-model:open="upsellCheckoutOpen" :checkout-url="upsellCheckoutUrl" :country-code="upsellCheckoutCountry" @completed="onUpsellCompleted" />
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
import AvatarCropDialog from "./AvatarCropDialog.vue";
import ProfileCardPreview from "./ProfileCardPreview.vue";
import UltimaCheckoutDialog from "@/components/modals/UltimaCheckoutDialog.vue";
import QRStyled from "../login/QRStyled.vue";
import { useMe } from "@/store/auth/meStore";
import { useLocale } from "@/store/system/localeStore";
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
  PaletteIcon,
  PipetteIcon,
  XIcon,
  LockIcon,
  Loader2,
} from "lucide-vue-next";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from "@argon/ui/select";
import { PinInput, PinInputGroup, PinInputInput, PinInputSeparator } from "@argon/ui/pin-input";
import { useApi } from "@/store/system/apiStore";
import { useToast } from "@argon/ui/toast";
import { logger } from "@argon/core";
import { OTPError, PhoneChangeError, UserSecurityDetailsUpdated, UploadFileError, UltimaPlan, CheckoutError } from "@argon/glue";
import { v7 } from "uuid";
import { useBus } from "@/store/realtime/busStore";
import { PasskeyManager, type PasskeyApiCallbacks } from "@argon/passkey";
import { useFeatureFlags } from "@/store/features/featureFlagsStore";
import { COLOR_PRESETS, PROFILE_BACKGROUNDS, argbToHex, hexToArgb } from "@/lib/profileCustomization";
import { useUltimaStore } from "@/store/data/ultimaStore";

const { t } = useLocale();
const me = useMe();

const { toast } = useToast();

const api = useApi();
const bus = useBus();
const { passkeyActive, autoDeleteAccountActive, ultimaActive } = useFeatureFlags();

// ── Ultima Upsell State ──
const ultima = useUltimaStore();
const showUpsellModal = ref(false);
const selectedUltimaPlan = ref(UltimaPlan.Annual);
const upsellCheckingOut = ref(false);
const upsellCheckoutOpen = ref(false);
const upsellCheckoutUrl = ref("");
const upsellCheckoutCountry = ref("");

function scrollToUpsell() {
  showUpsellModal.value = true;
}

async function handleUpsellSubscribe() {
  upsellCheckingOut.value = true;
  try {
    const result = await ultima.createCheckout(selectedUltimaPlan.value);
    if (result.success) {
      upsellCheckoutUrl.value = result.checkoutUrl;
      upsellCheckoutCountry.value = result.countryCode;
      upsellCheckoutOpen.value = true;
    } else {
      const msg = result.error === CheckoutError.ALREADY_SUBSCRIBED
        ? t("ultima_err_already_subscribed")
        : result.error === CheckoutError.REGION_UNAVAILABLE
          ? t("ultima_err_region")
          : t("ultima_err_payment");
      toast({ title: t("ultima_checkout_failed"), description: msg, variant: "destructive" });
    }
  } finally {
    upsellCheckingOut.value = false;
  }
}

function onUpsellCompleted() {
  upsellCheckoutOpen.value = false;
  ultima.fetchSubscription();
  toast({ title: t("ultima_welcome") });
}

// ── Profile Customization State ──
const editDisplayName = ref("");
const editCustomStatus = ref("");
const editBio = ref("");
const editPrimaryColor = ref<number | null>(null);
const editAccentColor = ref<number | null>(null);
const editBackgroundId = ref<number | null>(null);
const isSavingCustomization = ref(false);

// ── Avatar Upload State ──
const avatarFileInput = ref<HTMLInputElement | null>(null);
const showAvatarCropDialog = ref(false);
const avatarCropSrc = ref<string | null>(null);

function onAvatarFileSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  if (!input.files?.length) return;

  const file = input.files[0];
  const isAnimated = file.type === "image/gif" || file.type === "video/webm";

  if (isAnimated && !me.isPremium) {
    scrollToUpsell();
    input.value = "";
    return;
  }

  if (isAnimated) {
    uploadAnimatedAvatar(file);
    input.value = "";
    return;
  }

  if (avatarCropSrc.value) URL.revokeObjectURL(avatarCropSrc.value);
  avatarCropSrc.value = URL.createObjectURL(file);
  showAvatarCropDialog.value = true;
  input.value = "";
}

async function uploadAnimatedAvatar(file: File) {
  try {
    const begin = await api.userInteraction.BeginUploadAvatar();
    if (begin.isFailedUploadFile()) {
      toast({ title: t("error"), description: UploadFileError[begin.error] ?? "Upload failed", variant: "destructive" });
      return;
    }
    if (!begin.isSuccessUploadFile()) {
      toast({ title: t("error"), description: "Upload failed", variant: "destructive" });
      return;
    }

    const blobId = begin.blobId;
    const uploadFile = new File([file], `${v7()}.${file.type === "video/webm" ? "webm" : "gif"}`, { type: file.type });
    const formData = new FormData();
    formData.append("file", uploadFile);

    const response = await fetch(`https://koko.argon.gl/api/v1/upload/${blobId}`, {
      method: "PATCH",
      body: formData,
      headers: { "X-Api-Token": "f2f3be8c3ddf5017c019248fef849bc240e7b4a25ecb662251d8a4ca7ac6fe58" },
    });

    if (!response.ok) throw new Error(`Upload failed (${response.status})`);

    await api.userInteraction.CompleteUploadAvatar(blobId);
    toast({ title: t("profile_updated") || "Avatar updated" });
    onProfileUpdated();
  } catch (e) {
    toast({ title: t("error"), description: `${e}`, variant: "destructive" });
  }
}

const customizationDirty = computed(() => {
  const profile = me.meProfile;
  if (!profile || !me.me) return false;
  return (
    editDisplayName.value !== me.me.displayName ||
    editCustomStatus.value !== (profile.customStatus ?? "") ||
    editBio.value !== (profile.bio ?? "") ||
    editPrimaryColor.value !== (profile.primaryColor ?? null) ||
    editAccentColor.value !== (profile.accentColor ?? null) ||
    editBackgroundId.value !== (profile.backgroundId ?? null)
  );
});

async function saveCustomization() {
  // Premium check for colors, background, and custom status
  const hasPremiumFields =
    editPrimaryColor.value !== (me.meProfile?.primaryColor ?? null) ||
    editAccentColor.value !== (me.meProfile?.accentColor ?? null) ||
    editBackgroundId.value !== (me.meProfile?.backgroundId ?? null) ||
    editCustomStatus.value !== (me.meProfile?.customStatus ?? "");

  if (hasPremiumFields && !me.isPremium) {
    scrollToUpsell();
    return;
  }

  isSavingCustomization.value = true;
  try {
    const nameChanged = editDisplayName.value !== me.me?.displayName;
    const result = await api.userInteraction.UpdateMe({
      displayName: nameChanged ? editDisplayName.value : null,
      avatarId: null,
      backgroundId: editBackgroundId.value,
      voiceCardEffectId: null,
      avatarFrameId: null,
      nickEffectId: null,
      customStatus: editCustomStatus.value || null,
      customStatusIconId: null,
      primaryColor: editPrimaryColor.value,
      accentColor: editAccentColor.value,
    });

    if (result.isSuccessUpdateMe()) {
      if (me.me && nameChanged) {
        me.me.displayName = editDisplayName.value;
      }
      if (me.meProfile) {
        me.meProfile.customStatus = editCustomStatus.value || null;
        me.meProfile.primaryColor = editPrimaryColor.value;
        me.meProfile.accentColor = editAccentColor.value;
        me.meProfile.backgroundId = editBackgroundId.value;
      }
      toast({ title: t("profile_updated") || "Profile updated" });
    } else {
      toast({ title: t("error"), description: t("profile_update_failed") || "Failed to update profile", variant: "destructive" });
    }
  } catch {
    toast({ title: t("error"), description: t("profile_update_failed") || "Failed to update profile", variant: "destructive" });
  } finally {
    isSavingCustomization.value = false;
  }
}

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

// Load initial data
onMounted(async () => {
  // Fetch Ultima pricing for upsell banner
  if (!me.isPremium) {
    ultima.fetchSubscription();
  }

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

  // Initialize customization values from profile
  if (me.meProfile) {
    editPrimaryColor.value = me.meProfile.primaryColor ?? null;
    editAccentColor.value = me.meProfile.accentColor ?? null;
    editBackgroundId.value = me.meProfile.backgroundId ?? null;
    editCustomStatus.value = me.meProfile.customStatus ?? "";
    editBio.value = me.meProfile.bio ?? "";
  }
  if (me.me) {
    editDisplayName.value = me.me.displayName;
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

/* ── Profile Customization ── */

/* Color strip: compact inline flow with wrapping */
.color-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  align-items: center;
}

.color-dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform 0.12s, border-color 0.12s, box-shadow 0.12s;
  flex-shrink: 0;
}
.color-dot:hover {
  transform: scale(1.2);
}
.color-dot--active {
  border-color: hsl(var(--foreground));
  box-shadow: 0 0 0 2px hsl(var(--background)), 0 0 0 3.5px hsl(var(--foreground) / 0.35);
}
.color-dot--custom {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: conic-gradient(red, yellow, lime, aqua, blue, magenta, red);
  color: white;
  cursor: pointer;
}
.color-dot--reset {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: hsl(var(--muted) / 0.5);
  color: hsl(var(--muted-foreground));
}
.color-dot--reset:hover {
  background: hsl(var(--destructive) / 0.15);
  color: hsl(var(--destructive));
}

/* Horizontal scrolling background strip */
.bg-scroll {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: thin;
  scrollbar-color: hsl(var(--muted-foreground) / 0.3) transparent;
}
.bg-scroll::-webkit-scrollbar {
  height: 4px;
}
.bg-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.bg-scroll::-webkit-scrollbar-thumb {
  background: hsl(var(--muted-foreground) / 0.25);
  border-radius: 4px;
}

.bg-scroll-item {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-radius: 10px;
  overflow: hidden;
  border: 2px solid transparent;
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s;
  background: hsl(var(--muted) / 0.3);
  width: 130px;
}
.bg-scroll-item:hover {
  transform: translateY(-2px);
  border-color: hsl(var(--border));
}
.bg-scroll-item--active {
  border-color: hsl(var(--primary));
  box-shadow: 0 0 0 1px hsl(var(--primary) / 0.3);
}

.bg-scroll-thumb {
  width: 100%;
  height: 68px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.bg-scroll-thumb--none {
  background: hsl(var(--muted) / 0.4);
}

.bg-scroll-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.bg-scroll-label {
  padding: 4px 8px;
  font-size: 0.7rem;
  font-weight: 500;
  text-align: center;
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ═══ PREMIUM GATE ═══ */
.premium-gate {
  position: relative;
  border-radius: 0.75rem;
  padding: 1rem;
  border: 1px solid transparent;
  transition: filter 0.3s, opacity 0.3s;
}

.premium-gate--locked {
  filter: grayscale(0.35);
  opacity: 0.45;
  pointer-events: none;
  border-color: hsl(270 40% 30% / 0.25);
  background: hsl(270 15% 8% / 0.15);
}

.premium-gate-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: inherit;
  pointer-events: auto;
  cursor: pointer;
  background: hsl(270 30% 10% / 0.25);
  backdrop-filter: blur(1px);
  transition: background 0.25s, box-shadow 0.25s;
}
.premium-gate-overlay:hover {
  background: hsl(270 35% 12% / 0.35);
  box-shadow: inset 0 0 40px hsl(270 60% 50% / 0.08);
}

.premium-gate-overlay-content {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1.25rem;
  border-radius: 2rem;
  background: hsl(270 40% 15% / 0.8);
  border: 1px solid hsl(270 50% 40% / 0.4);
  color: hsl(270 80% 80%);
  font-size: 0.8125rem;
  font-weight: 600;
  backdrop-filter: blur(12px);
  box-shadow: 0 4px 20px hsl(270 60% 30% / 0.3);
  transition: transform 0.2s, box-shadow 0.2s;
}
.premium-gate-overlay:hover .premium-gate-overlay-content {
  transform: scale(1.04);
  box-shadow: 0 6px 28px hsl(270 60% 40% / 0.4);
}

.premium-gate-overlay:hover .premium-gate-overlay-content {
  transform: scale(1.04);
  box-shadow: 0 6px 28px hsl(270 60% 40% / 0.4);
}

/* ═══ UPSELL MODAL ═══ */


.upsell-aurora {
  position: absolute;
  inset: 0;
  background: hsl(270 50% 4%);
  overflow: hidden;
}

.upsell-aurora-layer {
  position: absolute;
  width: 200%;
  height: 200%;
  top: -50%;
  left: -50%;
  border-radius: 40%;
}

.upsell-a1 {
  background: radial-gradient(ellipse at 30% 30%, hsl(270 80% 25% / 0.6), transparent 50%);
  animation: upsell-aurora 15s ease-in-out infinite;
}

.upsell-a2 {
  background: radial-gradient(ellipse at 70% 60%, hsl(300 70% 20% / 0.5), transparent 45%);
  animation: upsell-aurora 20s ease-in-out infinite reverse;
}

.upsell-a3 {
  background: radial-gradient(ellipse at 50% 80%, hsl(250 60% 20% / 0.4), transparent 40%);
  animation: upsell-aurora 25s ease-in-out infinite 5s;
}

.upsell-noise {
  position: absolute;
  inset: 0;
  opacity: 0.03;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  pointer-events: none;
}

.upsell-stars {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.upsell-star { animation: upsell-twinkle 3s ease-in-out infinite; }
.us1 { animation-delay: 0s; }
.us2 { animation-delay: 0.5s; }
.us3 { animation-delay: 1s; }
.us4 { animation-delay: 1.5s; }
.us5 { animation-delay: 2s; }
.us6 { animation-delay: 0.3s; }
.us7 { animation-delay: 1.2s; }

.upsell-modal-inner {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 2.5rem 2rem 2rem;
  gap: 1.25rem;
}

/* Diamond */
.upsell-diamond {
  position: relative;
  animation: upsell-gem-float 5s ease-in-out infinite;
  filter: drop-shadow(0 12px 24px hsl(270 70% 30% / 0.5));
}

.upsell-gem {
  width: 72px;
  height: 84px;
}

.upsell-diamond-rays {
  position: absolute;
  inset: -20px;
  border-radius: 50%;
  background: radial-gradient(circle, hsl(270 80% 55% / 0.12), transparent 60%);
  animation: upsell-pulse-glow 4s ease-in-out infinite;
}

.upsell-sparkle { animation: upsell-twinkle 2s ease-in-out infinite; }
.us-a { animation-delay: 0s; }
.us-b { animation-delay: 0.7s; }
.us-c { animation-delay: 1.4s; }

/* Title */
.upsell-title {
  font-size: 2.5rem;
  font-weight: 900;
  letter-spacing: -0.03em;
  line-height: 1;
  margin: 0;
}

.upsell-holo {
  background: linear-gradient(
    135deg,
    hsl(270 90% 75%) 0%,
    hsl(290 80% 80%) 20%,
    hsl(320 70% 85%) 35%,
    white 50%,
    hsl(250 80% 80%) 65%,
    hsl(270 90% 75%) 80%,
    hsl(300 80% 80%) 100%
  );
  background-size: 300% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: upsell-holo-shift 5s ease-in-out infinite;
}

.upsell-tagline {
  font-size: 0.875rem;
  color: hsl(270 20% 55%);
  margin: 0;
  text-align: center;
}

/* Perks */
.upsell-perks {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.625rem;
  width: 100%;
}

.upsell-perk {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.75rem 0.875rem;
  border-radius: 0.75rem;
  background: hsl(270 25% 10% / 0.5);
  border: 1px solid hsl(270 30% 20% / 0.4);
  transition: border-color 0.2s, transform 0.2s;
}

.upsell-perk:hover {
  border-color: hsl(270 50% 40% / 0.6);
  transform: translateY(-1px);
}

.upsell-perk-icon {
  font-size: 1.125rem;
  flex-shrink: 0;
}

.upsell-perk-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.upsell-perk-label {
  font-size: 0.6875rem;
  font-weight: 600;
  color: hsl(270 30% 80%);
}

.upsell-perk-desc {
  font-size: 0.5625rem;
  color: hsl(270 15% 45%);
}

/* Pricing */
.upsell-pricing {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  width: 100%;
}

.upsell-plan {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.125rem;
  padding: 1.25rem 0.75rem;
  border-radius: 1rem;
  border: 1.5px solid hsl(270 25% 18%);
  background: hsl(270 20% 8% / 0.7);
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}

.upsell-plan-border {
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  padding: 1.5px;
  background: conic-gradient(from 0deg, transparent, hsl(270 70% 50%), transparent, hsl(300 60% 50%), transparent);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0;
  transition: opacity 0.3s;
}

.upsell-plan:hover .upsell-plan-border,
.upsell-plan--active .upsell-plan-border {
  opacity: 1;
  animation: upsell-rotate-border 4s linear infinite;
}

.upsell-plan:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px hsl(270 60% 20% / 0.3);
}

.upsell-plan--active {
  border-color: hsl(270 70% 50%);
  background: hsl(270 35% 12% / 0.9);
  box-shadow:
    0 0 0 1px hsl(270 70% 55% / 0.2),
    0 8px 28px hsl(270 70% 35% / 0.25);
}

.upsell-plan-badge {
  position: absolute;
  top: -1px;
  right: -1px;
  padding: 3px 8px;
  border-radius: 0 1rem 0 0.5rem;
  font-size: 0.5rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  background: linear-gradient(135deg, hsl(150 75% 40%), hsl(170 65% 35%));
  color: white;
}

.upsell-plan-tier {
  font-size: 0.625rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: hsl(270 20% 50%);
}

.upsell-plan-price {
  font-size: 1.75rem;
  font-weight: 900;
  color: white;
  line-height: 1.1;
}

.upsell-plan-price small {
  font-size: 0.625rem;
  font-weight: 600;
  opacity: 0.6;
  vertical-align: super;
}

.upsell-plan-cycle {
  font-size: 0.625rem;
  color: hsl(270 15% 40%);
}

.upsell-plan-was {
  font-size: 0.5625rem;
  color: hsl(270 15% 35%);
  text-decoration: line-through;
  margin-top: 0.125rem;
}

/* CTA */
.upsell-cta {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.875rem 3rem;
  border-radius: 0.875rem;
  border: none;
  font-size: 1rem;
  font-weight: 800;
  color: white;
  background: linear-gradient(135deg, hsl(270 75% 50%), hsl(290 65% 45%), hsl(310 60% 42%));
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow:
    0 4px 16px hsl(270 60% 40% / 0.4),
    inset 0 1px 0 hsl(270 80% 70% / 0.2);
  overflow: hidden;
  width: 100%;
  max-width: 280px;
}

.upsell-cta-shimmer {
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, hsl(0 0% 100% / 0.15), transparent);
  animation: upsell-btn-shimmer 3s ease-in-out infinite;
}

.upsell-cta:hover {
  transform: translateY(-2px) scale(1.02);
  box-shadow:
    0 8px 32px hsl(270 60% 40% / 0.5),
    inset 0 1px 0 hsl(270 80% 70% / 0.3);
}

.upsell-cta:active {
  transform: translateY(0) scale(0.98);
}

.upsell-cta:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.upsell-cta-arrow {
  width: 20px;
  height: 20px;
  transition: transform 0.25s;
}

.upsell-cta:hover .upsell-cta-arrow {
  transform: translateX(4px);
}

/* ═══ UPSELL KEYFRAMES ═══ */
@keyframes upsell-aurora {
  0%, 100% { transform: translate(0, 0) rotate(0deg); }
  33% { transform: translate(5%, 3%) rotate(2deg); }
  66% { transform: translate(-3%, -2%) rotate(-1deg); }
}

@keyframes upsell-gem-float {
  0%, 100% { transform: translateY(0) rotateY(0deg); }
  25% { transform: translateY(-4px) rotateY(3deg); }
  50% { transform: translateY(-8px) rotateY(0deg); }
  75% { transform: translateY(-4px) rotateY(-3deg); }
}

@keyframes upsell-twinkle {
  0%, 100% { opacity: 0.2; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.3); }
}

@keyframes upsell-holo-shift {
  0% { background-position: 0% center; }
  50% { background-position: 300% center; }
  100% { background-position: 0% center; }
}

@keyframes upsell-pulse-glow {
  0%, 100% { opacity: 0.6; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.08); }
}

@keyframes upsell-btn-shimmer {
  0% { left: -100%; }
  50%, 100% { left: 100%; }
}

@keyframes upsell-rotate-border {
  to { transform: rotate(360deg); }
}
</style>

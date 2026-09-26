<template>
  <MediaEditor
    v-model="isOpen"
    :src="imageSrc ?? ''"
    media-type="image"
    mode="avatar"
    initial-tab="crop"
    :dev-mode="configStore.devModeEnabled"
    @done="onEditorDone"
    @cancel="onCancel"
  />
</template>

<script setup lang="ts">
import { watch, computed } from 'vue'
import { useApi } from '@/store/system/apiStore'
import { useAvatarUpload } from '@/composables/useAvatarUpload'
import { useConfigStore } from '@/store/ui/configStore'
import { useLocale } from '@/store/system/localeStore'
import { useToast } from '@argon/ui/toast'
import { spaceManageErrorKey, spaceManageRefusal } from '@/lib/refusals'
import { MediaEditor } from '@argon/media-editor'
import type { MediaEditorFinalResult } from '@argon/media-editor'

interface Props {
  open: boolean
  imageSrc: string | null
  spaceId: string
}

interface Emits {
  (e: 'update:open', value: boolean): void
  (e: 'update:imageSrc', value: string | null): void
  (e: 'avatarUpdated'): void
  (e: 'uploadStart', preview: string): void
  (e: 'uploadEnd', success: boolean): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const api = useApi()
const uploadState = useAvatarUpload()
const configStore = useConfigStore()
const { t } = useLocale()
const { toast } = useToast()

const isOpen = computed({
  get: () => props.open,
  set: (v) => emit('update:open', v)
})

watch(() => props.open, (v) => {
  if (v) uploadState.reset()
})

async function onEditorDone(result: MediaEditorFinalResult) {
  if (!result) return

  // Close editor immediately
  isOpen.value = false

  // Show preview on the avatar right away
  let previewUrl: string | null = null
  if (result.preview) {
    previewUrl = URL.createObjectURL(result.preview)
    emit('uploadStart', previewUrl)
  }

  const payload = await result.getResult()
  const blob = payload.blob

  if (!previewUrl) {
    previewUrl = URL.createObjectURL(blob)
    emit('uploadStart', previewUrl)
  }

  const success = await uploadState.upload(
    () => api.serverInteraction.BeginUploadSpaceAvatar(props.spaceId),
    completeServerAvatar,
    blob
  )

  if (previewUrl) URL.revokeObjectURL(previewUrl)

  if (success) {
    emit('avatarUpdated')
  }
  emit('uploadEnd', success)
}

/** A refusal is said here; the avatar only shows that the upload failed. */
async function completeServerAvatar(blobId: string): Promise<string | void> {
  const refused = spaceManageRefusal(await api.serverInteraction.CompleteUploadSpaceAvatar(props.spaceId, blobId))
  if (refused === null) return
  const reason = t(spaceManageErrorKey(refused))
  toast({ title: t('server_avatar_upload_failed'), description: reason, variant: 'destructive' })
  return reason
}

function onCancel() {
  isOpen.value = false
}
</script>

<template>
  <MediaEditor
    v-model="isOpen"
    :src="imageSrc ?? ''"
    media-type="image"
    mode="avatar"
    initial-tab="crop"
    @done="onEditorDone"
    @cancel="onCancel"
  />
</template>

<script setup lang="ts">
import { watch, computed } from 'vue'
import { useApi } from '@/store/system/apiStore'
import { useAvatarUpload } from '@/composables/useAvatarUpload'
import { MediaEditor } from '@argon/media-editor'
import type { MediaEditorFinalResult } from '@argon/media-editor'

const props = defineProps<{
  open: boolean
  imageSrc: string | null
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'update:imageSrc', v: string | null): void
  (e: 'avatarUpdated'): void
  (e: 'uploadStart', preview: string): void
  (e: 'uploadEnd', success: boolean): void
}>()

const api = useApi()
const upload = useAvatarUpload()

const isOpen = computed({
  get: () => props.open,
  set: (v) => emit('update:open', v)
})

watch(() => props.open, (v) => {
  if (v) upload.reset()
})

async function onEditorDone(result: MediaEditorFinalResult) {
  if (!result) return

  // Close editor immediately
  isOpen.value = false

  // Show preview on the avatar right away using the preview blob
  let previewUrl: string | null = null
  if (result.preview) {
    previewUrl = URL.createObjectURL(result.preview)
    emit('uploadStart', previewUrl)
  }

  // Get the final rendered blob
  const payload = await result.getResult()
  const blob = payload.blob

  // If we didn't have preview, use the final blob
  if (!previewUrl) {
    previewUrl = URL.createObjectURL(blob)
    emit('uploadStart', previewUrl)
  }

  // Upload in background
  const ok = await upload.upload(
    () => api.userInteraction.BeginUploadAvatar(),
    (id) => api.userInteraction.CompleteUploadAvatar(id),
    blob
  )

  // Clean up preview URL
  if (previewUrl) URL.revokeObjectURL(previewUrl)

  if (ok) {
    emit('avatarUpdated')
  }
  emit('uploadEnd', ok)
}

function onCancel() {
  isOpen.value = false
}
</script>
<template>
    <Dialog v-model:open="open">
        <DialogContent
            class="sm:max-w-[520px] rounded-2xl border border-white/10 bg-gradient-to-br from-black/60 via-zinc-900/70 to-black/60 backdrop-blur-2xl p-8 space-y-8">
            <div
                class="absolute inset-0 bg-gradient-to-t from-blue-500/5 via-transparent to-purple-500/5 pointer-events-none">
            </div>

            <div class="relative text-center space-y-2">
                <h2 class="text-3xl font-extrabold text-white tracking-wide">
                    {{ t('feedback_title') }}
                </h2>
                <p class="text-gray-400 text-sm">
                    {{ t('feedback_subtitle') }}
                </p>
            </div>

            <div class="relative space-y-3">
                <Label class="text-gray-300 flex items-center gap-2">
                    <span class="i-lucide-message-circle text-purple-400"></span>
                    {{ t('message') }}
                </Label>
                <textarea v-model="message" class="w-full h-28 rounded-xl bg-black/50 border-gray-700 text-white placeholder-gray-500
                 focus:border-purple-500 focus:ring focus:ring-purple-500/30 resize-none p-3"
                    :placeholder='t("describe_feedback")' />
            </div>

            <div class="relative space-y-3">
                <Label class="text-gray-300 flex items-center gap-2">
                    <span class="i-lucide-image text-green-400"></span>
                    {{ t('attachments') }}
                </Label>

                <div class="flex flex-col items-center justify-center w-full p-6 border-2 border-dashed rounded-xl cursor-pointer
                 bg-black/40 border-gray-700 hover:border-green-500/50 hover:bg-black/60 transition" @dragover.prevent
                    @drop.prevent="handleDrop" @click="fileInput?.click()">
                    <span class="i-lucide-upload-cloud text-gray-400 text-3xl mb-2"></span>
                    <p class="text-gray-400 text-sm">
                        {{ t('drag_or_click_to_upload') }}
                    </p>
                    <p class="text-gray-500 text-xs">{{ t('feedback_attachments_limit') }}</p>
                    <input ref="fileInput" type="file" class="hidden" multiple  accept="*.png,*.jpg,*.jpeg,image/png,image/jpeg" @change="handleFiles" />
                </div>

                <div v-if="attachmentsPreview.length" class="flex flex-wrap gap-3 pt-3">
                    <div v-for="(src, i) in attachmentsPreview" :key="i"
                        class="relative w-20 h-20 rounded-lg overflow-hidden group border border-gray-700">
                        <img :src="src" class="object-cover w-full h-full" />
                        <button @click.stop="removeAttachment(i)" class="absolute top-1 right-1 bg-black/70 rounded-full p-1 text-white opacity-70
                     hover:opacity-100 transition">
                            <span class="i-lucide-x w-4 h-4"></span>
                        </button>
                    </div>
                </div>
            </div>

            <div class="relative space-y-3">
                <Button @click="submitFeedback" :disabled="isLoading"
                    class="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition-all">
                    <span v-if="isLoading" class="animate-spin i-lucide-loader-2 mr-2"></span>
                    <span v-else class="i-lucide-send mr-2"></span>
                    {{ t('send_feedback') }}
                </Button>
            </div>
        </DialogContent>
    </Dialog>
</template>

<script setup lang="ts">
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ref } from 'vue'
import { useLocale } from '@/store/localeStore'
import { captureFeedback } from "@sentry/vue";
import { useMe } from '@/store/meStore'

const me = useMe();
const { t } = useLocale()

const open = defineModel<boolean>('open', { type: Boolean, default: false })

const message = ref('')

interface Attachment {
    data: string | Uint8Array
    contentType: string
    filename: string
}

const attachments = ref<Attachment[]>([])
const attachmentsPreview = ref<string[]>([])
const isLoading = ref(false)

const fileInput = ref<HTMLInputElement | null>(null)

function handleFiles(e: Event) {
    const files = (e.target as HTMLInputElement).files
    if (!files) return
    processFiles(files)
}

function handleDrop(e: DragEvent) {
    if (!e.dataTransfer?.files) return
    processFiles(e.dataTransfer.files)
}

function processFiles(files: FileList) {
    const slotsLeft = 3 - attachments.value.length
    if (slotsLeft <= 0) return

    const limited = Array.from(files).slice(0, slotsLeft)

    limited.forEach(file => {
        if (file.size > 2 * 1024 * 1024) return

        const reader = new FileReader()
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                attachments.value.push({
                    filename: file.name,
                    contentType: file.type,
                    data: dataUrlToUint8Array(reader.result)
                })
                attachmentsPreview.value.push(reader.result)
            }
        }
        reader.readAsDataURL(file)
    })
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const [, base64] = dataUrl.split(',')
  const binary = atob(base64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
function removeAttachment(index: number) {
    attachments.value.splice(index, 1)
    URL.revokeObjectURL(attachmentsPreview.value[index])
    attachmentsPreview.value.splice(index, 1)
}

async function submitFeedback() {
    if (!message.value.trim()) return
    isLoading.value = true
    try {
        captureFeedback({
            message: message.value,
            name: me.me?.username
        }, {
            includeReplay: true,
            attachments: attachments.value
        })

        message.value = ''
        attachments.value = []
        attachmentsPreview.value.forEach(url => URL.revokeObjectURL(url))
        attachmentsPreview.value = []
        open.value = false
    } catch (e) {
        console.error('Failed to send feedback:', e)
    } finally {
        isLoading.value = false
    }
}
</script>
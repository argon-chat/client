import { onMounted, onBeforeUnmount } from 'vue'


export function useSleepWatcher(onWake: () => Promise<void>, intervalMs = 10_000, thresholdMs = 20_000) {
  let last = performance.now()
  let timer: number | null = null

  const check = async () => {
    const now = performance.now()
    const delta = now - last
    last = now

    if (delta > intervalMs + thresholdMs) {
      await onWake()
    }

    timer = window.setTimeout(check, intervalMs)
  }

  onMounted(() => {
    last = performance.now()
    timer = window.setTimeout(check, intervalMs)
  })

  onBeforeUnmount(() => {
    if (timer !== null) clearTimeout(timer)
  })
}
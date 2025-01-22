import { defineStore } from "pinia";
import { computed, ref } from "vue";

export const useSessionTimer = defineStore("sessionTimer", () => {
  const sessionStartDate = ref<Date>(new Date())
  const daysSession = ref<number>(0)
  const hoursSession = ref<number>(0)
  const minutesSession = ref<number>(0)
  const secondsSession = ref<number>(0)
  const interval = ref()

  const pad = (num: number): string => num.toString().padStart(2, '0');

  function updateSessionDate(date: Date): void {
    sessionStartDate.value = date
  }

  const sessionTime = computed(() => 
    `${pad(hoursSession.value % 24)}:${pad(minutesSession.value % 60)}:${pad(secondsSession.value % 60)}`
  )

  function updateSessionTimer(): void {
    const now = new Date();
    if (!(sessionStartDate.value instanceof Date) || Number.isNaN(sessionStartDate.value.getTime())) {
      stopTimer()
      return
    }
    const milliseconds = now.getTime() - sessionStartDate.value.getTime();
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    daysSession.value = days
    hoursSession.value = hours
    minutesSession.value = minutes
    secondsSession.value = seconds
  }

  function startTimer(): void {
    stopTimer()
    updateSessionTimer()
    interval.value = setInterval(updateSessionTimer, 1000)
  }

  function stopTimer() {
    daysSession.value = 0
    hoursSession.value = 0
    minutesSession.value = 0
    secondsSession.value = 0
    updateSessionDate(new Date())

    if(interval.value) {
      clearInterval(interval.value)
    }
  }

  return { 
    updateSessionTimer,
    sessionTime,
    startTimer,
    stopTimer
  };
});
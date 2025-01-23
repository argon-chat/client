import { defineStore } from "pinia";
import { interval, Subscription } from "rxjs";
import { ref } from "vue";

export const useSessionTimer = defineStore("sessionTimer", () => {
  const sessionStartDate = ref<Date>(new Date());
  const sessionTimer = ref<string>('00:00:00');
  const subscription = ref<Subscription | null>(null);

  const pad = (num: number): string => num.toString().padStart(2, '0');

  function updateSessionTimer(): void {
    const now = new Date();
    if (!(sessionStartDate.value instanceof Date) || Number.isNaN(sessionStartDate.value.getTime())) {
      stopTimer();
      return;
    }
    const milliseconds = now.getTime() - sessionStartDate.value.getTime();
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if(days < 1) {
      sessionTimer.value = `${pad(hours % 24)}:${pad(minutes % 60)}:${pad(seconds % 60)}`;
    } else {
      sessionTimer.value = `${days}:${pad(hours % 24)}:${pad(minutes % 60)}:${pad(seconds % 60)}`;
    }
  }

  function startTimer(): void {
    stopTimer();
    subscription.value = interval(1000)
      .subscribe(updateSessionTimer);
  }

  function stopTimer() {
    sessionTimer.value = '00:00:00';
    sessionStartDate.value = new Date();

    if(subscription.value) {
      subscription.value.unsubscribe();
      subscription.value = null;
    }
  }

  return {
    sessionTimer,
    startTimer,
    stopTimer
  };
});
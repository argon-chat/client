export function startTimer(
  onTick: (t: {
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
  }) => void
) {
  let totalSeconds = 0;

  const id = setInterval(() => {
    totalSeconds++;

    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    onTick({ days, hours, minutes, seconds });
  }, 1000);

  return () => clearInterval(id);
}

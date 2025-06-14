import { defineStore } from "pinia";
import { usePoolStore } from "./poolStore";
export const usePexStore = defineStore("pex", () => {
  const pool = usePoolStore();
  return { has: pool.has };
});

import { defineStore } from "pinia";
import { usePoolStore } from "@/store/data/poolStore";
export const usePexStore = defineStore("pex", () => {
  const pool = usePoolStore();
  return { has: pool.has };
});

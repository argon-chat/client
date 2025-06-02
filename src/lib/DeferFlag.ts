import { Ref } from "vue";

export class DeferFlag {
  constructor(private readonly flag: Ref<boolean, boolean>) {
    flag.value = true;
  }

  [Symbol.dispose]() {
    this.flag.value = false;
  }
}
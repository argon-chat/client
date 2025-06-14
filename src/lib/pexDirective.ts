import type { App, Directive } from "vue";
import {
  ALL_ENTITLEMENT,
  type ArgonEntitlement,
} from "@/lib/ext/ArgonEntitlement";

const pexDirective: Directive<HTMLElement, ArgonEntitlement> = {
  mounted(el, binding, vnode) {},
};

const pexBehaviourDirective: Directive<HTMLElement, ArgonEntitlement> = {
  mounted(el, binding, vnode) {
    el.setAttribute("pex-behaviour", binding.value);
  },
};

export function registerDirectives(app: App) {
  app.directive("pex", pexDirective);
  app.directive("pex-behaviour", pexBehaviourDirective);
}

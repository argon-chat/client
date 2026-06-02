import { createRouter, createMemoryHistory } from "vue-router";
import LoginPage from "../views/AuthPage.vue";
import MasterView from "../views/MasterView.vue";
import AppShell from "@/views/AppShell.vue";
import { useAppState } from "@/store/system/appState";
import LockdownView from "@/views/LockdownView.vue";
import { useAuthStore } from "@/store";
const routes = [
  {
    path: "/",
    component: AppShell,
    children: [
  {
    path: "login.pg",
    name: "Login",
    component: LoginPage,
  },
  {
    path: "master.pg",
    name: "MasterView",
    component: MasterView,
    redirect: "/master.pg/home",
    meta: { requiresAuth: true },
    children: [
      {
        path: "home",
        name: "HomeShellView",
        component: () => import("@/components/home/HomeShell.vue"),
        redirect: "/master.pg/home/dashboard",
        children: [
          {
            path: "dashboard",
            name: "HomeDashboard",
            component: () =>
              import("@/components/home/views/HomeDashboard.vue"),
          },
          {
            path: "friends",
            name: "HomeFriends",
            component: () =>
              import("@/components/home/views/friends/FriendsShell.vue"),
          },
          {
            path: "inventory",
            name: "HomeInventory",
            component: () =>
              import("@/components/home/views/InventoryShell.vue"),
          },
          {
            path: "notifications",
            name: "HomeNotifications",
            component: () =>
              import("@/components/home/views/NotificationShell.vue"),
          },
          {
            path: "overlayDebug",
            name: "HomeOverlayDebug",
            component: () =>
              import("@/components/home/views/overlay/OverlayDebug.vue"),
          },
          {
            path: "audioDebug",
            name: "HomeAudioDebug",
            component: () =>
              import("@/components/home/views/overlay/AudioDebugView.vue"),
          },
          {
            path: "nv12Debug",
            name: "HomeNV12Debug",
            component: () =>
              import("@/components/home/views/overlay/nv12Debug/Nv12DebugView.vue"),
          },
          {
            path: "chat/:userId",
            name: "HomeChat",
            component: () => import("@/components/home/views/ChatShell.vue"),
          },
        ],
      },
      {
        path: "space/:id",
        name: "SpaceShellView",
        component: () => import("@/components/SpaceShell.vue"),
      },
      {
        path: "space/:id/channel/:channelId",
        name: "SpaceChannel",
        component: () => import("@/components/SpaceShell.vue"),
      },
    ],
  },
  {
    path: "blocked.pg",
    name: "LockdownView",
    component: LockdownView,
  },
    ],
  },
];

const router = createRouter({
  history: createMemoryHistory(),
  routes,
});

router.beforeEach((to, from, next) => {
  // Layout-test bypass: skip auth/load guards so any view can be inspected.
  if ((window as any).__layoutTest) {
    next();
    return;
  }

  const authStore = useAuthStore();
  const appState = useAppState();
  if (!appState.isLoaded && to.path !== "/") {
    next({ path: "/" });
    return;
  }

  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    next({ name: "Login" });
  } else if (to.meta.redirectTo) {
    next({ path: to.meta.redirectTo as string });
  } else {
    next();
  }
});

// ---- Layout test console helpers (dev) -------------------------------------
// Usage in DevTools console:
//   nav.auth() / nav.master() / nav.lockdown()
//   nav.titlebar(true|false)   -> toggle the unified AppTitlebar
//   nav.guards(true|false)     -> re-enable / disable auth+load guards
//   nav.router                 -> raw vue-router instance
const __navTargets = {
  auth: "Login",
  master: "MasterView",
  lockdown: "LockdownView",
} as const;

const __nav: Record<string, unknown> = {
  router,
  titlebar(on = true) {
    (window as any).devolution_titlebar = on ? 0x1 : 0x0;
    // force re-eval of the shell's titlebar computed via a no-op re-nav
    return router.replace(router.currentRoute.value.fullPath);
  },
  guards(on = true) {
    (window as any).__layoutTest = !on;
    return `guards ${on ? "ENABLED" : "DISABLED"}`;
  },
};

for (const [key, name] of Object.entries(__navTargets)) {
  __nav[key] = () => {
    (window as any).__layoutTest = true; // ensure target view actually mounts
    return router.push({ name });
  };
}

(window as any).nav = __nav;

export default router;

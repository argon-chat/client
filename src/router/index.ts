import { createRouter, createMemoryHistory } from "vue-router";
import { useAuthStore } from "../store/authStore";
import LoginPage from "../views/AuthPage.vue";
import MasterView from "../views/MasterView.vue";
import Entry from "@/views/Entry.vue";
import { useAppState } from "@/store/appState";
import LockdownView from "@/views/LockdownView.vue";
const routes = [
  {
    path: "/",
    name: "Entry",
    component: Entry,
  },
  {
    path: "/login.pg",
    name: "Login",
    component: LoginPage,
  },
  {
    path: "/master.pg",
    name: "MasterView",
    component: MasterView,
    redirect: "/master.pg/home",
    meta: { requiresAuth: true },
    children: [
      {
        path: "home",
        name: "HomeShellView",
        component: () => import("@/components/home/HomeShell.vue"),
        redirect: "/master.pg/home/profile",
        children: [
          {
            path: "profile",
            name: "HomeProfile",
            component: () => import("@/components/home/views/ProfileShell.vue"),
          },
          {
            path: "friends",
            name: "HomeFriends",
            component: () => import("@/components/home/views/friends/FriendsShell.vue"),
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
    ],
  },
  {
    path: "/blocked.pg",
    name: "LockdownView",
    component: LockdownView,
  },
];

const router = createRouter({
  history: createMemoryHistory(),
  routes,
});

router.beforeEach((to, from, next) => {
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

export default router;

import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../store/authStore';
import LoginPage from '../views/AuthPage.vue';
import MasterView from '../views/MasterView.vue';
import CreateOrJoin from '../views/CreateOrJoin.vue';
import Entry from '@/views/Entry.vue';
import { useAppState } from '@/store/appState';
const routes = [
  {
    path: '/',
    name: 'Entry',
    component: Entry,
  },
  {
    path: '/login',
    name: 'Login',
    component: LoginPage,
  },
  {
    path: '/create-or-join',
    name: 'Create Or Join',
    component: CreateOrJoin,
    meta: { requiresAuth: true },
  },
  {
    path: '/master',
    name: 'MasterView',
    component: MasterView,
    meta: { requiresAuth: true }
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to, from, next) => {
  const authStore = useAuthStore();
  const appState = useAppState();
  if (!appState.isLoaded && to.path != '/') {
    next({ path: '/' });
    return;
  }


  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    next({ name: 'Login' });
  } else if (to.meta.redirectTo) {
    next({ path: to.meta.redirectTo as string });
  }else {
    next();
  }
});

export default router;
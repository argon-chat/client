import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../store/authStore';
import LoginPage from '../views/AuthPage.vue';
import Dashboard from '../views/MainPage.vue';
import MasterView from '../views/MasterView.vue';
import CreateOrJoin from '../views/CreateOrJoin.vue';
import { before } from 'node:test';
const routes = [
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
    path: '/dashboard',
    name: 'Dashboard',
    component: Dashboard,
    meta: { requiresAuth: true },
  },
  {
    path: '/master',
    name: 'MasterView',
    component: MasterView,
    meta: { requiresAuth: true }
  },
  {
    path: '/',
    name: 'Home',
    meta: { requiresAuth: true, redirectTo: '/master' }
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to, from, next) => {
  const authStore = useAuthStore();
  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    next({ name: 'Login' });
  } else if (to.meta.redirectTo) {
    next({ path: to.meta.redirectTo as string });
  }else {
    next();
  }
});

export default router;
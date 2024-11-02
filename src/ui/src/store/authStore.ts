import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<string | null>(null);
  const token = ref<string | null>(null);
  const isAuthenticated = ref(false);

  const login = async (phone: string) => {

    isAuthenticated.value = true;
    return;
    try {
      const response = await fetch('https://argon.chat/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phone }),
      });

      if (!response.ok) {
        throw new Error('Invalid credentials');
      }

      const data = await response.json();
      token.value = data.token;
      user.value = data.user;
      isAuthenticated.value = true;
      localStorage.setItem('token', token.value!);
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  };

  const logout = () => {
    user.value = null;
    token.value = null;
    isAuthenticated.value = false;
    localStorage.removeItem('token');
  };

  const restoreSession = () => {
    const savedToken = localStorage.getItem('token');
    if (savedToken) {
      token.value = savedToken;
      isAuthenticated.value = true;
    }
  };

  return {
    user,
    token,
    isAuthenticated,
    login,
    logout,
    restoreSession,
  };
});
<template>
  <div class="app-container flex flex-col items-center justify-center min-h-screen bg-[#0a0a0a] text-red-500 font-mono">
    <div class="text-center mb-10 title-wrap">
      <h1 class="title">{{ isBadClient ? 'Client Configuration Error' : 'Account Suspended' }}</h1>
    </div>

    <div class="mb-12" v-if="!isBadClient">
      <svg class="hazard-diamond" width="160" height="160" viewBox="0 0 160 160" aria-hidden="true">
        <g transform="translate(80,80) rotate(45)">
          <rect x="-56" y="-56" width="112" height="112" fill="none" stroke="#ff2b2b" stroke-width="2" />

          <template v-for="(cell, i) in cells" :key="i">
            <rect :x="cell.x" :y="cell.y" width="56" height="56" :fill="cell.fill" stroke="#ff2b2b" stroke-width="1.5"
              class="diamond-cell">
              <title>{{ cell.tooltip }}</title>
            </rect>
            <g :transform="`translate(${cell.x + 28}, ${cell.y + 30}) rotate(-45)`">
              <text text-anchor="middle" dominant-baseline="middle" class="diamond-text">
                {{ cell.label }}
              </text>
            </g>
          </template>

          <line x1="0" y1="-56" x2="0" y2="56" stroke="#ff2b2b" stroke-width="1" />
          <line x1="-56" y1="0" x2="56" y2="0" stroke="#ff2b2b" stroke-width="1" />
        </g>
      </svg>
    </div>

    <!-- Bad Client Error Message -->
    <div v-if="isBadClient" class="error-card">
      <div class="error-icon">⚠️</div>
      <div class="error-content">
        <h2 class="error-title">API Access Denied</h2>
        <p class="error-description">
          Unable to establish connection with the API. This is not an account suspension, but a client configuration issue.
        </p>
        
        <div class="error-details">
          <div class="detail-item">
            <span class="detail-label">Error Code:</span>
            <span class="detail-value">{{ details.reasonCode }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Issue:</span>
            <span class="detail-value">Missing or invalid authentication parameters</span>
          </div>
        </div>

        <div class="info-container">
          <div class="dev-info">
            <div class="dev-info-header">For Developers:</div>
            <ul class="dev-info-list">
              <li>Verify that Session ID, Machine ID, and Client ID are correctly passed to the API</li>
              <li>Ensure proper signature generation using your application credentials</li>
              <li>Check that all required authentication headers and cookies are present in API requests</li>
              <li>Validate that your client configuration matches the registered application settings</li>
              <li>Review authentication logs for specific parameter validation errors</li>
            </ul>
          </div>

          <div class="user-info">
            <div class="user-info-header">For Users:</div>
            <p class="user-info-text">
              If you are using a custom or third-party client application, this error indicates an issue with the client's implementation. 
              The application you're using may not be properly configured to communicate with our API servers.
            </p>
            <p class="user-info-text">
              <strong>What you can do:</strong>
            </p>
            <ul class="user-info-list">
              <li>Contact the developer of the client application you're using and inform them about this error</li>
              <li>Switch to the official client if available, which is properly configured and tested</li>
              <li>Ask the developer to verify their authentication implementation and API credentials</li>
              <li>Check if there's an update available for your client application that might fix this issue</li>
            </ul>
            <p class="user-info-note">
              This is not a problem with your account. Your account remains in good standing and you can access the service 
              using properly configured client applications.
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- User Suspension Card -->
    <div v-else class="user-card">
      <ArgonAvatar :overrided-size="64" :user-id="user.id" :file-id="user.avatar" :fallback="user.name" />
      <div class="user-main">
        <div class="user-name">{{ user.name }}</div>
        <div class="user-row">
          <span class="muted">Status:</span>
          <span class="accent"> Suspended</span>
        </div>
        <div class="user-row muted">ID: {{ user.id }}</div>
      </div>
      <div class="vert-divider" aria-hidden="true"></div>
      <div class="user-meta">
        <div class="meta-row">
          <span class="muted">Reason</span>
          <span class="value">{{ details.reasonCode }}</span>
        </div>
        <div class="meta-row" v-if="details.until">
          <span class="muted">Until</span>
          <span class="value">{{ details.until }}</span>
        </div>
        <div class="meta-row" v-else>
          <span class="muted">Until</span>
          <span class="value">♾️</span>
        </div>
        <!-- <div class="meta-row">
          <span class="muted">Violations</span>
          <span class="value">{{ details.violations }}</span>
        </div> -->
      </div>
    </div>

    <button class="appeal-btn" @click="onAppeal" v-if="!isBadClient && details.isAllowedAppeal">
      Lodge an appeal
    </button>

    <button class="logout-btn" @click="logout" v-if="!isBadClient">
      Logout
    </button>
  </div>
</template>

<script setup lang="ts">
import ArgonAvatar from '@/components/ArgonAvatar.vue';
import { useToast } from '@/components/ui/toast';
import { LockdownReason, LockdownSeverity } from '@/lib/glue/argonChat';
import { useAuthStore } from '@/store/authStore';
import { useMe } from '@/store/meStore';

const me = useMe();
const toast = useToast();

const user = {
  name: me.me?.displayName ?? 'User',
  id: me.me?.userId ?? '—',
  avatar: me.me?.avatarFileId ?? "",
};

const details = {
  reasonCode: LockdownReason[me.limitation?.lockdownReason ?? 0],
  until: me.limitation?.lockDownExpiration?.date.toUTCString(),
  //violations: me.limitation.vi,
  isAllowedAppeal: me.limitation?.isAppealable ?? false,
};

const isBadClient = details.reasonCode === 'BAD_CLIENT';

function onAppeal() {
  toast.toast({
      title: "You do not have the right to appeal.",
      description: "Your violation is not subject to appeal!",
      variant: "destructive",
      duration: 4500,
  })
  //router.push({ name: 'appeal', query: { userId: user.id } });
}

function logout() {
  useAuthStore().logout();
  location.reload();
}


function classifyLockdown(reason: LockdownReason, severity: LockdownSeverity) {
  const cells = [
    {
      label: '',
      fill: '#000',
      tooltip: '',
      x: -56,
      y: -56,
    },
    {
      label: '',
      fill: '#000',
      tooltip: '',
      x: 0,
      y: -56,
    },
    {
      label: '',
      fill: '#000',
      tooltip: '',
      x: -56,
      y: 0,
    },
    {
      label: severity == LockdownSeverity.Low ? 'D' : (severity == LockdownSeverity.Middle ? 'E' : 'F'),
      fill: '#ff2b2b',
      tooltip: '',
      x: 0,
      y: 0,
    },
  ];

  return cells;
}
const cells = classifyLockdown(me.limitation?.lockdownReason ?? LockdownReason.NONE, me.limitation?.severity ?? LockdownSeverity.Low);

</script>

<style scoped>
.hazard-diamond {
  display: block;
  margin: 0 auto;
  shape-rendering: crispEdges;
}

.diamond-cell {
  transition: fill 0.25s, stroke 0.25s;
  cursor: help;
}

.diamond-cell:hover {
  stroke: #e7d109;
}

.diamond-text {
  font-family: monospace;
  font-size: 2rem;
  fill: #ffffff;
  user-select: none;
  pointer-events: none;
}


:root {
  --red: #ff2b2b;
  --bg: #0a0a0a;
}

.app-container {
  position: relative;
  overflow: hidden;
}

.title-wrap {
  position: relative;
}

.title {
  @apply text-4xl font-semibold tracking-widest uppercase text-red-500;
  padding: 4px 14px 8px;
  border-bottom: 1px solid #b91c1c;
  letter-spacing: .25em;
}

.title-wrap::before,
.title-wrap::after {
  content: "";
  position: absolute;
  width: 18px;
  height: 10px;
  bottom: -1px;
  border-bottom: 1px solid #b91c1c;
}

.title-wrap::before {
  left: -18px;
  border-left: 1px solid #b91c1c;
}

.title-wrap::after {
  right: -18px;
  border-right: 1px solid #b91c1c;
}

.user-card {
  display: flex;
  align-items: center;
  gap: 16px;
  border: 1px solid #7f1d1d;
  border-radius: 8px;
  background: rgba(0, 0, 0, .35);
  padding: 14px 16px;
  min-width: min(680px, 92vw);
}

.user-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 220px;
}

.user-name {
  color: #f87171;
  font-weight: 600;
  font-size: 1rem;
}

.user-row {
  font-size: .85rem;
}

.muted {
  color: #9ca3af;
}

.accent {
  color: var(--red);
}

.vert-divider {
  width: 1px;
  height: 48px;
  background: #7f1d1d;
  margin: 0 8px;
}

.user-meta {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 18px;
  align-items: center;
}

.meta-row {
  display: contents;
}

.value {
  color: #f3f4f6;
}

.appeal-btn {
  margin-top: 24px;
  padding: 10px 22px;
  border: 1px solid #7f1d1d;
  color: #fca5a5;
  text-transform: uppercase;
  letter-spacing: .15em;
  background: transparent;
  transition: background .2s ease, transform .05s ease;
}

.logout-btn {
  margin-top: 14px;
  padding: 10px 22px;
  border: 1px solid #4e4e4e;
  color: #fca5a5;
  text-transform: uppercase;
  letter-spacing: .15em;
  background: transparent;
  transition: background .2s ease, transform .05s ease;
}

.appeal-btn:hover {
  background: rgba(127, 29, 29, .15);
}

.logout-btn:hover {
  background: rgba(127, 29, 29, .15);
}

.logout-btn:active {
  transform: translateY(1px);
}

.appeal-btn:active {
  transform: translateY(1px);
}

@media (max-width: 720px) {
  .user-card {
    flex-wrap: wrap;
    gap: 12px;
  }

  .vert-divider {
    display: none;
  }
}

.error-card {
  border: 2px solid #fbbf24;
  border-radius: 8px;
  background: rgba(0, 0, 0, .5);
  padding: 24px;
  max-width: min(1200px, 92vw);
  color: #fef3c7;
}

.error-icon {
  font-size: 3rem;
  text-align: center;
  margin-bottom: 16px;
}

.error-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.error-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: #fbbf24;
  text-align: center;
  text-transform: uppercase;
  letter-spacing: .15em;
}

.error-description {
  font-size: 1rem;
  line-height: 1.6;
  color: #fef3c7;
  text-align: center;
}

.error-details {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid #92400e;
  border-bottom: 1px solid #92400e;
  padding: 12px 0;
  margin: 8px 0;
}

.detail-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: .95rem;
}

.detail-label {
  color: #d97706;
  font-weight: 500;
}

.detail-value {
  color: #fef3c7;
  font-family: monospace;
}

.info-container {
  display: flex;
  gap: 16px;
  margin-top: 8px;
}

.dev-info {
  background: rgba(217, 119, 6, .1);
  border: 1px solid #92400e;
  border-radius: 4px;
  padding: 16px;
  flex: 1;
}

.dev-info-header {
  font-size: 1rem;
  font-weight: 600;
  color: #fbbf24;
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: .1em;
}

.dev-info-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dev-info-list li {
  font-size: .9rem;
  line-height: 1.5;
  color: #fde68a;
  padding-left: 20px;
  position: relative;
}

.dev-info-list li::before {
  content: "→";
  position: absolute;
  left: 0;
  color: #d97706;
}

.user-info {
  background: rgba(59, 130, 246, .1);
  border: 1px solid #1e40af;
  border-radius: 4px;
  padding: 16px;
  flex: 1;
}

.user-info-header {
  font-size: 1rem;
  font-weight: 600;
  color: #60a5fa;
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: .1em;
}

.user-info-text {
  font-size: .9rem;
  line-height: 1.6;
  color: #bfdbfe;
  margin-bottom: 12px;
}

.user-info-text strong {
  color: #93c5fd;
  font-weight: 600;
}

.user-info-list {
  list-style: none;
  padding: 0;
  margin: 0 0 12px 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.user-info-list li {
  font-size: .9rem;
  line-height: 1.5;
  color: #bfdbfe;
  padding-left: 20px;
  position: relative;
}

.user-info-list li::before {
  content: "•";
  position: absolute;
  left: 0;
  color: #60a5fa;
  font-weight: bold;
}

.user-info-note {
  font-size: .85rem;
  line-height: 1.5;
  color: #93c5fd;
  font-style: italic;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #1e40af;
}

@media (max-width: 720px) {
  .error-card {
    padding: 16px;
  }

  .error-title {
    font-size: 1.25rem;
  }

  .detail-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }

  .info-container {
    flex-direction: column;
    gap: 12px;
  }
}
</style>

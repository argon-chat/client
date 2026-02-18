/**
 * Argon PlayFrame Host - Sandbox Configuration
 * 
 * Manages iframe sandbox attributes and CSP.
 */

import type { Permission } from '@argon/playframe';
import {
  DEFAULT_SANDBOX_FLAGS,
  OPTIONAL_SANDBOX_FLAGS,
  BASE_CSP_DIRECTIVES,
  buildCspHeader,
  mergeCspDirectives,
} from '@argon/playframe';

// ============================================================================
// Sandbox Configuration
// ============================================================================

export interface SandboxConfig {
  /** Base sandbox flags */
  baseFlags: readonly string[];
  /** Additional flags based on permissions */
  permissionFlags: Partial<Record<Permission, string>>;
  /** Custom additional flags */
  customFlags?: string[];
}

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  baseFlags: DEFAULT_SANDBOX_FLAGS,
  permissionFlags: OPTIONAL_SANDBOX_FLAGS,
};

/**
 * Build the sandbox attribute value for an iframe.
 */
export function buildSandboxAttribute(
  permissions: Permission[],
  config: SandboxConfig = DEFAULT_SANDBOX_CONFIG
): string {
  const flags = new Set<string>(config.baseFlags);
  
  // Add permission-based flags
  for (const permission of permissions) {
    const flag = config.permissionFlags[permission];
    if (flag) {
      flags.add(flag);
    }
  }
  
  // Add custom flags
  if (config.customFlags) {
    for (const flag of config.customFlags) {
      flags.add(flag);
    }
  }
  
  return Array.from(flags).join(' ');
}

// ============================================================================
// CSP Configuration
// ============================================================================

export interface CspConfig {
  /** Base CSP directives */
  baseDirectives: Record<string, readonly string[] | string[]>;
  /** Additional allowed origins for connect-src */
  allowedOrigins?: string[];
  /** Additional allowed image sources */
  allowedImageSources?: string[];
  /** Additional allowed script sources */
  allowedScriptSources?: string[];
  /** Whether to allow WebAssembly */
  allowWasm?: boolean;
  /** Whether to allow eval (dangerous, but some games need it) */
  allowEval?: boolean;
}

export const DEFAULT_CSP_CONFIG: CspConfig = {
  baseDirectives: BASE_CSP_DIRECTIVES,
  allowWasm: true,
  allowEval: false,
};

/**
 * Build CSP header for a game iframe.
 */
export function buildGameCsp(
  gameOrigin: string,
  config: CspConfig = DEFAULT_CSP_CONFIG
): string {
  const extensions: Record<string, string[]> = {};
  
  // Add game origin to connect-src
  extensions['connect-src'] = [gameOrigin];
  
  if (config.allowedOrigins) {
    extensions['connect-src'].push(...config.allowedOrigins);
  }
  
  if (config.allowedImageSources) {
    extensions['img-src'] = config.allowedImageSources;
  }
  
  if (config.allowedScriptSources) {
    extensions['script-src'] = config.allowedScriptSources;
  }
  
  // Convert readonly arrays to mutable for merging
  const mutableBaseDirectives: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(config.baseDirectives)) {
    mutableBaseDirectives[key] = [...value];
  }
  
  let directives = mergeCspDirectives(mutableBaseDirectives, extensions);
  
  // Handle WASM
  if (config.allowWasm) {
    directives['script-src'] = directives['script-src'] || [];
    if (!directives['script-src'].includes("'wasm-unsafe-eval'")) {
      directives['script-src'].push("'wasm-unsafe-eval'");
    }
  }
  
  // Handle eval (dangerous!)
  if (config.allowEval) {
    directives['script-src'] = directives['script-src'] || [];
    if (!directives['script-src'].includes("'unsafe-eval'")) {
      directives['script-src'].push("'unsafe-eval'");
    }
  }
  
  return buildCspHeader(directives);
}

// ============================================================================
// Iframe Creation
// ============================================================================

export interface CreateIframeOptions {
  /** Game URL to load */
  src: string;
  /** Container element */
  container: HTMLElement;
  /** Granted permissions */
  permissions: Permission[];
  /** Sandbox configuration */
  sandboxConfig?: SandboxConfig;
  /** CSP configuration (null to disable) */
  cspConfig?: CspConfig | null;
  /** Additional iframe attributes */
  attributes?: Record<string, string>;
  /** CSS styles for the iframe */
  styles?: Partial<CSSStyleDeclaration>;
  /** If true, don't set src yet - caller will set it after setting up handlers */
  deferSrc?: boolean;
}

/**
 * Create a sandboxed iframe for a game.
 */
export function createGameIframe(options: CreateIframeOptions): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  
  // Security attributes
  iframe.sandbox.value = buildSandboxAttribute(options.permissions, options.sandboxConfig);
  
  // CSP via csp attribute (supported in some browsers)
  // Skip if cspConfig is explicitly null (dev mode)
  if (options.cspConfig !== null) {
    const gameOrigin = new URL(options.src).origin;
    const csp = buildGameCsp(gameOrigin, options.cspConfig);
    iframe.setAttribute('csp', csp);
  }
  
  // Feature policy / Permissions policy
  iframe.allow = buildPermissionsPolicy(options.permissions);
  
  // Referrer policy
  iframe.referrerPolicy = 'origin';
  
  // Prevent navigation
  iframe.setAttribute('loading', 'eager');
  
  // Custom attributes
  if (options.attributes) {
    for (const [key, value] of Object.entries(options.attributes)) {
      iframe.setAttribute(key, value);
    }
  }
  
  // Styles
  iframe.style.border = 'none';
  iframe.style.display = 'block';
  
  if (options.styles) {
    Object.assign(iframe.style, options.styles);
  }
  
  // Append to container first
  options.container.appendChild(iframe);
  
  // Set source (unless deferred for handler setup)
  if (!options.deferSrc) {
    iframe.src = options.src;
  }
  
  return iframe;
}

/**
 * Build the Permissions-Policy / Feature-Policy for an iframe.
 */
function buildPermissionsPolicy(permissions: Permission[]): string {
  const policies: string[] = [];
  
  // Always allow same origin
  const sameOrigin = "'self'";
  
  // Map permissions to feature policies
  if (permissions.includes('pointer-lock')) {
    policies.push(`pointer-lock ${sameOrigin}`);
  }
  
  if (permissions.includes('gamepad')) {
    policies.push(`gamepad ${sameOrigin}`);
  }
  
  if (permissions.includes('fullscreen')) {
    policies.push(`fullscreen ${sameOrigin}`);
  }
  
  if (permissions.includes('audio')) {
    policies.push(`autoplay ${sameOrigin}`);
  }
  
  if (permissions.includes('microphone')) {
    policies.push(`microphone ${sameOrigin}`);
  }
  
  // Deny dangerous features (use 'none' for iframe allow attribute)
  policies.push("camera 'none'");
  policies.push("payment 'none'");
  policies.push("usb 'none'");
  policies.push("bluetooth 'none'");
  policies.push("serial 'none'");
  policies.push("midi 'none'");
  
  return policies.join('; ');
}

// ============================================================================
// Browser API Restriction (Experimental)
// ============================================================================

/**
 * Generate a script to run before the game loads that restricts browser APIs.
 * This is experimental and may not work in all scenarios.
 * 
 * Note: Due to how iframes work, this must be injected into the game's HTML
 * or loaded via a service worker.
 */
export function generateApiRestrictionScript(restrictedApis: string[]): string {
  const deletions = restrictedApis
    .map(api => {
      // Handle nested APIs like 'navigator.geolocation'
      const parts = api.split('.');
      if (parts.length === 1) {
        return `try { delete window['${api}']; } catch(e) {}`;
      } else {
        const [obj, prop] = parts;
        return `try { delete window['${obj}']['${prop}']; } catch(e) {}`;
      }
    })
    .join('\n');
  
  return `
(function() {
  'use strict';
  // PlayFrame API Restrictions
  ${deletions}
})();
`.trim();
}

/**
 * Default APIs to restrict for games.
 */
export const RESTRICTED_APIS = [
  'navigator.geolocation',
  'navigator.credentials',
  'navigator.usb',
  'navigator.bluetooth',
  'navigator.serial',
  'navigator.hid',
  'navigator.share',
  'PaymentRequest',
  'Notification',
  'PushManager',
  'ServiceWorkerContainer',
  'BroadcastChannel',
  'SharedWorker',
  'WebSocket', // Games should use postMessage, not direct WebSockets
];

/**
 * Tests for Argon PlayFrame Host - Sandbox
 */

import './setup';
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  buildSandboxAttribute,
  buildGameCsp,
  createGameIframe,
  generateApiRestrictionScript,
  RESTRICTED_APIS,
  DEFAULT_SANDBOX_CONFIG,
  DEFAULT_CSP_CONFIG,
} from '../src/sandbox';
import type { Permission } from '@argon/playframe';

// ============================================================================
// buildSandboxAttribute Tests
// ============================================================================

describe('buildSandboxAttribute', () => {
  test('includes base flags', () => {
    const sandbox = buildSandboxAttribute([]);
    
    // Should include default flags
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).toContain('allow-same-origin');
  });

  test('adds pointer-lock flag', () => {
    const sandbox = buildSandboxAttribute(['pointer-lock']);
    expect(sandbox).toContain('allow-pointer-lock');
  });

  test('adds fullscreen flag', () => {
    const sandbox = buildSandboxAttribute(['fullscreen']);
    expect(sandbox).toContain('allow-fullscreen');
  });

  test('adds multiple permission flags', () => {
    const sandbox = buildSandboxAttribute(['pointer-lock', 'fullscreen']);
    expect(sandbox).toContain('allow-pointer-lock');
    expect(sandbox).toContain('allow-fullscreen');
  });

  test('handles custom config', () => {
    const sandbox = buildSandboxAttribute(['keyboard'], {
      baseFlags: ['allow-scripts'],
      permissionFlags: { keyboard: 'allow-keyboard' as any },
    });
    
    expect(sandbox).toContain('allow-scripts');
  });

  test('adds custom flags', () => {
    const sandbox = buildSandboxAttribute([], {
      ...DEFAULT_SANDBOX_CONFIG,
      customFlags: ['custom-flag'],
    });
    
    expect(sandbox).toContain('custom-flag');
  });

  test('does not duplicate flags', () => {
    const sandbox = buildSandboxAttribute(['pointer-lock', 'pointer-lock']);
    const flags = sandbox.split(' ');
    const pointerLockCount = flags.filter(f => f === 'allow-pointer-lock').length;
    
    expect(pointerLockCount).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// buildGameCsp Tests
// ============================================================================

describe('buildGameCsp', () => {
  test('builds valid CSP header', () => {
    const csp = buildGameCsp('https://games.example.com');
    
    expect(typeof csp).toBe('string');
    expect(csp.length).toBeGreaterThan(0);
  });

  test('includes game origin in connect-src', () => {
    const csp = buildGameCsp('https://games.example.com');
    
    expect(csp).toContain('connect-src');
    expect(csp).toContain('https://games.example.com');
  });

  test('adds allowed origins', () => {
    const csp = buildGameCsp('https://games.example.com', {
      ...DEFAULT_CSP_CONFIG,
      allowedOrigins: ['wss://socket.example.com'],
    });
    
    expect(csp).toContain('wss://socket.example.com');
  });

  test('includes wasm-unsafe-eval when allowWasm is true', () => {
    const csp = buildGameCsp('https://games.example.com', {
      ...DEFAULT_CSP_CONFIG,
      allowWasm: true,
    });
    
    expect(csp).toContain("'wasm-unsafe-eval'");
  });

  test('excludes wasm-unsafe-eval when allowWasm is false', () => {
    const csp = buildGameCsp('https://games.example.com', {
      ...DEFAULT_CSP_CONFIG,
      allowWasm: false,
    });
    
    expect(csp).not.toContain("'wasm-unsafe-eval'");
  });

  test('includes unsafe-eval when allowEval is true', () => {
    const csp = buildGameCsp('https://games.example.com', {
      ...DEFAULT_CSP_CONFIG,
      allowEval: true,
    });
    
    expect(csp).toContain("'unsafe-eval'");
  });

  test('includes unsafe-eval by default for game compatibility', () => {
    // BASE_CSP_DIRECTIVES includes unsafe-eval because games may need it for wasm
    const csp = buildGameCsp('https://games.example.com');
    
    expect(csp).toContain("'unsafe-eval'");
  });

  test('adds allowed image sources', () => {
    const csp = buildGameCsp('https://games.example.com', {
      ...DEFAULT_CSP_CONFIG,
      allowedImageSources: ['https://cdn.example.com'],
    });
    
    expect(csp).toContain('https://cdn.example.com');
  });
});

// ============================================================================
// createGameIframe Tests
// ============================================================================

describe('createGameIframe', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  test('creates iframe element', () => {
    const iframe = createGameIframe({
      src: 'https://games.example.com/game/',
      container,
      permissions: [],
    });
    
    expect(iframe.tagName).toBe('IFRAME');
    expect(iframe.parentElement).toBe(container);
  });

  test('sets sandbox attribute', () => {
    const iframe = createGameIframe({
      src: 'https://games.example.com/game/',
      container,
      permissions: ['pointer-lock'],
    });
    
    expect(iframe.sandbox.contains('allow-scripts')).toBe(true);
    expect(iframe.sandbox.contains('allow-pointer-lock')).toBe(true);
  });

  test('sets CSP attribute', () => {
    const iframe = createGameIframe({
      src: 'https://games.example.com/game/',
      container,
      permissions: [],
    });
    
    expect(iframe.getAttribute('csp')).toBeDefined();
  });

  test('sets referrer policy', () => {
    const iframe = createGameIframe({
      src: 'https://games.example.com/game/',
      container,
      permissions: [],
    });
    
    expect(iframe.referrerPolicy).toBe('origin');
  });

  test('sets src', () => {
    const iframe = createGameIframe({
      src: 'https://games.example.com/game/',
      container,
      permissions: [],
    });
    
    expect(iframe.src).toBe('https://games.example.com/game/');
  });

  test('applies custom styles', () => {
    const iframe = createGameIframe({
      src: 'https://games.example.com/game/',
      container,
      permissions: [],
      styles: {
        width: '800px',
        height: '600px',
      },
    });
    
    expect(iframe.style.width).toBe('800px');
    expect(iframe.style.height).toBe('600px');
  });

  test('applies custom attributes', () => {
    const iframe = createGameIframe({
      src: 'https://games.example.com/game/',
      container,
      permissions: [],
      attributes: {
        'data-game-id': 'test-game',
        title: 'Test Game',
      },
    });
    
    expect(iframe.getAttribute('data-game-id')).toBe('test-game');
    expect(iframe.getAttribute('title')).toBe('Test Game');
  });

  test('sets allow attribute for permissions policy', () => {
    const iframe = createGameIframe({
      src: 'https://games.example.com/game/',
      container,
      permissions: ['pointer-lock', 'fullscreen'],
    });
    
    const allow = iframe.allow;
    expect(allow).toContain('pointer-lock');
    expect(allow).toContain('fullscreen');
  });

  test('removes border by default', () => {
    const iframe = createGameIframe({
      src: 'https://games.example.com/game/',
      container,
      permissions: [],
    });
    
    // happy-dom may serialize border differently, check it contains 'none'
    expect(iframe.style.border).toContain('none');
  });
});

// ============================================================================
// generateApiRestrictionScript Tests
// ============================================================================

describe('generateApiRestrictionScript', () => {
  test('generates valid script', () => {
    const script = generateApiRestrictionScript(['WebSocket']);
    
    expect(script).toContain('WebSocket');
    expect(script).toContain('delete');
    expect(script).toContain("'use strict'");
  });

  test('handles nested APIs', () => {
    const script = generateApiRestrictionScript(['navigator.geolocation']);
    
    expect(script).toContain("window['navigator']['geolocation']");
  });

  test('handles multiple APIs', () => {
    const script = generateApiRestrictionScript([
      'WebSocket',
      'navigator.geolocation',
      'PaymentRequest',
    ]);
    
    expect(script).toContain('WebSocket');
    expect(script).toContain('geolocation');
    expect(script).toContain('PaymentRequest');
  });

  test('wraps deletions in try-catch', () => {
    const script = generateApiRestrictionScript(['WebSocket']);
    
    expect(script).toContain('try {');
    expect(script).toContain('} catch(e) {}');
  });
});

// ============================================================================
// RESTRICTED_APIS Tests
// ============================================================================

describe('RESTRICTED_APIS', () => {
  test('contains expected dangerous APIs', () => {
    expect(RESTRICTED_APIS).toContain('navigator.geolocation');
    expect(RESTRICTED_APIS).toContain('WebSocket');
    expect(RESTRICTED_APIS).toContain('PaymentRequest');
    expect(RESTRICTED_APIS).toContain('Notification');
  });

  test('includes Bluetooth and USB', () => {
    expect(RESTRICTED_APIS).toContain('navigator.usb');
    expect(RESTRICTED_APIS).toContain('navigator.bluetooth');
  });
});

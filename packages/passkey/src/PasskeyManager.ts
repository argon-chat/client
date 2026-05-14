import { logger } from "@argon/core";

export interface PasskeyCreateResult {
  success: boolean;
  passkeyId?: string;
  name?: string;
  createdAt?: Date;
  error?: string;
  errorCode?: "CANCELLED" | "NOT_SUPPORTED" | "INVALID_STATE" | "UNKNOWN";
}

export interface PasskeyRemoveResult {
  success: boolean;
  error?: string;
}

export interface PasskeyValidateResult {
  success: boolean;
  error?: string;
  errorCode?: "CANCELLED" | "NOT_SUPPORTED" | "NOT_FOUND" | "UNKNOWN";
}

export interface PasskeyData {
  id: string;
  name: string;
  createdAt: Date;
}

export interface PasskeyApiCallbacks {
  beginAddPasskey: (name: string) => Promise<{
    success: boolean;
    optionsJson?: string;
  }>;
  completeAddPasskey: (
    registrationResponse: string,
  ) => Promise<{
    success: boolean;
    passkey?: PasskeyData;
  }>;
  removePasskey: (passkeyId: string) => Promise<{
    success: boolean;
  }>;
  beginValidatePasskey: () => Promise<{
    success: boolean;
    optionsJson?: string;
  }>;
  completeValidatePasskey: (
    authenticationResponse: string,
  ) => Promise<{
    success: boolean;
  }>;
}

// Base64url helpers
function base64urlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Parse Fido2NetLib CredentialCreateOptions JSON into PublicKeyCredentialCreationOptions
function parseCreationOptions(optionsJson: string): PublicKeyCredentialCreationOptions {
  const opts = JSON.parse(optionsJson);
  return {
    challenge: base64urlToBuffer(opts.challenge),
    rp: opts.rp,
    user: {
      id: base64urlToBuffer(opts.user.id),
      name: opts.user.name,
      displayName: opts.user.displayName,
    },
    pubKeyCredParams: opts.pubKeyCredParams,
    timeout: opts.timeout,
    attestation: opts.attestation,
    authenticatorSelection: opts.authenticatorSelection,
    excludeCredentials: (opts.excludeCredentials || []).map((c: any) => ({
      id: base64urlToBuffer(c.id),
      type: c.type,
      transports: c.transports,
    })),
    extensions: opts.extensions,
  };
}

// Parse Fido2NetLib AssertionOptions JSON into PublicKeyCredentialRequestOptions
function parseRequestOptions(optionsJson: string): PublicKeyCredentialRequestOptions {
  const opts = JSON.parse(optionsJson);
  return {
    challenge: base64urlToBuffer(opts.challenge),
    rpId: opts.rpId,
    timeout: opts.timeout,
    userVerification: opts.userVerification,
    allowCredentials: (opts.allowCredentials || []).map((c: any) => ({
      id: base64urlToBuffer(c.id),
      type: c.type,
      transports: c.transports,
    })),
    extensions: opts.extensions,
  };
}

// Serialize PublicKeyCredential (creation) into AuthenticatorAttestationRawResponse JSON
function serializeAttestationResponse(credential: PublicKeyCredential): string {
  const response = credential.response as AuthenticatorAttestationResponse;
  return JSON.stringify({
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      attestationObject: bufferToBase64url(response.attestationObject),
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
    },
    extensions: credential.getClientExtensionResults(),
  });
}

// Serialize PublicKeyCredential (assertion) into AuthenticatorAssertionRawResponse JSON
function serializeAssertionResponse(credential: PublicKeyCredential): string {
  const response = credential.response as AuthenticatorAssertionResponse;
  return JSON.stringify({
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      authenticatorData: bufferToBase64url(response.authenticatorData),
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      signature: bufferToBase64url(response.signature),
      userHandle: response.userHandle ? bufferToBase64url(response.userHandle) : null,
    },
  });
}

/**
 * Main PasskeyManager - uses WebAuthn API directly
 */
export class PasskeyManager {
  private api: PasskeyApiCallbacks;

  constructor(api: PasskeyApiCallbacks) {
    this.api = api;
  }

  isSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof window.PublicKeyCredential !== "undefined" &&
      typeof navigator.credentials !== "undefined"
    );
  }

  async createPasskey(name: string): Promise<PasskeyCreateResult> {
    logger.info("[PasskeyManager] Starting passkey creation:", name);

    if (!name.trim()) {
      return { success: false, error: "Passkey name is required" };
    }

    try {
      // Step 1: Get creation options from server
      const beginResult = await this.api.beginAddPasskey(name);
      if (!beginResult.success || !beginResult.optionsJson) {
        return { success: false, error: "Failed to begin passkey creation" };
      }

      const publicKeyOptions = parseCreationOptions(beginResult.optionsJson);

      // Step 2: Perform WebAuthn ceremony
      const credential = (await navigator.credentials.create({
        publicKey: publicKeyOptions,
      })) as PublicKeyCredential | null;

      if (!credential) {
        return { success: false, error: "Credential creation returned null" };
      }

      const registrationResponseJson = serializeAttestationResponse(credential);

      // Step 3: Complete on server
      const completeResult = await this.api.completeAddPasskey(registrationResponseJson);
      if (!completeResult.success) {
        return { success: false, error: "Failed to complete passkey creation" };
      }

      const passkey = completeResult.passkey!;
      return {
        success: true,
        passkeyId: passkey.id,
        name: passkey.name,
        createdAt: passkey.createdAt,
      };
    } catch (error: any) {
      logger.error("[PasskeyManager] Exception during passkey creation:", error);

      let errorCode: PasskeyCreateResult["errorCode"] = "UNKNOWN";
      let errorMessage = "Failed to create passkey";

      if (error.name === "NotAllowedError") {
        errorCode = "CANCELLED";
        errorMessage = "Passkey creation was cancelled";
      } else if (error.name === "NotSupportedError") {
        errorCode = "NOT_SUPPORTED";
        errorMessage = "Passkeys are not supported on this device";
      } else if (error.name === "InvalidStateError") {
        errorCode = "INVALID_STATE";
        errorMessage = "This authenticator is already registered";
      }

      return { success: false, error: errorMessage, errorCode };
    }
  }

  async removePasskey(passkeyId: string): Promise<PasskeyRemoveResult> {
    try {
      const result = await this.api.removePasskey(passkeyId);
      if (result.success) return { success: true };
      return { success: false, error: "Failed to remove passkey" };
    } catch (error: any) {
      logger.error("[PasskeyManager] Exception during passkey removal:", error);
      return { success: false, error: "Failed to remove passkey" };
    }
  }

  async validatePasskey(): Promise<PasskeyValidateResult> {
    logger.info("[PasskeyManager] Starting passkey validation");

    try {
      // Step 1: Get assertion options from server
      const beginResult = await this.api.beginValidatePasskey();
      if (!beginResult.success || !beginResult.optionsJson) {
        return { success: false, error: "Failed to begin passkey validation" };
      }

      const optionsJson = beginResult.optionsJson;

      // Step 2: Perform WebAuthn assertion
      const publicKeyOptions = parseRequestOptions(optionsJson);
      const credential = (await navigator.credentials.get({
        publicKey: publicKeyOptions,
      })) as PublicKeyCredential | null;

      if (!credential) {
        return { success: false, error: "Credential assertion returned null" };
      }

      const authenticationResponseJson = serializeAssertionResponse(credential);

      // Step 3: Complete on server
      const completeResult = await this.api.completeValidatePasskey(authenticationResponseJson);
      if (!completeResult.success) {
        return { success: false, error: "Failed to complete passkey validation" };
      }

      return { success: true };
    } catch (error: any) {
      logger.error("[PasskeyManager] Exception during passkey validation:", error);

      let errorCode: PasskeyValidateResult["errorCode"] = "UNKNOWN";
      let errorMessage = "Failed to validate passkey";

      if (error.name === "NotAllowedError") {
        errorCode = "CANCELLED";
        errorMessage = "Passkey validation was cancelled";
      } else if (error.name === "NotSupportedError") {
        errorCode = "NOT_SUPPORTED";
        errorMessage = "Passkeys are not supported on this device";
      } else if (error.name === "NotFoundError") {
        errorCode = "NOT_FOUND";
        errorMessage = "No passkey found for this account";
      }

      return { success: false, error: errorMessage, errorCode };
    }
  }
}

import { logger } from "@argon/core";
import { native } from "@argon/glue";

export interface PasskeyUser {
  userId: string;
  username: string;
  displayName: string;
}

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
    passkeyId?: string;
    challenge?: string;
  }>;
  completeAddPasskey: (
    passkeyId: string,
    publicKey: string,
  ) => Promise<{
    success: boolean;
    passkey?: PasskeyData;
  }>;
  removePasskey: (passkeyId: string) => Promise<{
    success: boolean;
  }>;
  beginValidatePasskey: () => Promise<{
    success: boolean;
    challenge?: string;
    allowedCredentials?: Array<{ id: string; type: string }>;
  }>;
  completeValidatePasskey: (
    credentialId: string,
    signature: string,
    authenticatorData: string,
    clientDataJSON: string,
  ) => Promise<{
    success: boolean;
  }>;
}

export interface PasskeyConfig {
  relyingPartyId: string;
  relyingPartyName: string;
  origin: string;
  timeoutMilliseconds: number;
}

export interface IPasskeyProvider {
  createPasskey(
    passkeyId: string,
    challenge: string,
    user: PasskeyUser,
    rpName: string,
    rpId: string,
  ): Promise<string | null>; // Returns public key in base64

  validatePasskey(
    challenge: string,
    allowedCredentials: Array<{ id: string; type: string }>,
    rpId: string,
  ): Promise<{
    credentialId: string;
    signature: string;
    authenticatorData: string;
    clientDataJSON: string;
  } | null>;

  isSupported(): boolean;
}

/**
 * Native provider for native applications
 */
class NativeProvider implements IPasskeyProvider {
  isSupported(): boolean {
    return typeof argon !== "undefined" && argon.isArgonHost;
  }

  async createPasskey(
    passkeyId: string,
    challenge: string,
    user: PasskeyUser,
    rpName: string,
    rpId: string,
  ): Promise<string | null> {
    const result = await native.hostProc.createPasskey(
      passkeyId,
      challenge,
      { displayName: user.displayName, id: user.userId, name: user.username },
      rpName,
      rpId,
    );
    if (result.isSuccessCreatePasskey()) return result.cert;
    logger.error("Native passkey creation failed", result);
    return null;
  }

  async validatePasskey(
    challenge: string,
    allowedCredentials: Array<{ id: string; type: string }>,
    rpId: string,
  ): Promise<{
    credentialId: string;
    signature: string;
    authenticatorData: string;
    clientDataJSON: string;
  } | null> {
    logger.info("NativeProvider: Validating passkey", allowedCredentials);
    const result = await native.hostProc.validatePasskey(
      challenge,
      allowedCredentials.map((c) => {
        return { id: c.id, publicKey: c.type };
      }),
      rpId,
    );

    if (result.isSuccessValidatePasskey())
      return result;
    logger.error("Native passkey validate failed", result);
    return null; 
  }
}

/**
 * Browser-based WebAuthn provider
 */
class WebAuthnProvider implements IPasskeyProvider {
  isSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof window.PublicKeyCredential !== "undefined" &&
      typeof navigator.credentials !== "undefined"
    );
  }

  async createPasskey(
    passkeyId: string,
    challenge: string,
    user: PasskeyUser,
    rpName: string,
    rpId: string,
  ): Promise<string | null> {
    logger.info("[WebAuthn] Creating passkey with browser API");

    try {
      // Convert challenge from base64 to Uint8Array
      const challengeBuffer = Uint8Array.from(atob(challenge), (c) =>
        c.charCodeAt(0),
      );

      const publicKeyOptions: PublicKeyCredentialCreationOptions = {
        challenge: challengeBuffer,
        rp: {
          name: rpName,
          id: rpId,
        },
        user: {
          id: Uint8Array.from(user.userId, (c) => c.charCodeAt(0)),
          name: user.username,
          displayName: user.displayName,
        },
        pubKeyCredParams: [
          { alg: -7, type: "public-key" }, // ES256
          { alg: -257, type: "public-key" }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          requireResidentKey: false,
          userVerification: "preferred",
        },
        timeout: 60000,
        attestation: "none",
      };

      logger.info("[WebAuthn] Requesting credential creation");
      const credential = (await navigator.credentials.create({
        publicKey: publicKeyOptions,
      })) as PublicKeyCredential | null;

      if (!credential) {
        logger.warn("[WebAuthn] Credential creation returned null");
        return null;
      }

      logger.info("[WebAuthn] Credential created successfully");

      // Extract public key from credential
      const response = credential.response as AuthenticatorAttestationResponse;
      const publicKeyBuffer = response.getPublicKey();

      if (!publicKeyBuffer) {
        logger.error("[WebAuthn] Public key buffer is null");
        return null;
      }

      const publicKeyBase64 = btoa(
        String.fromCharCode(...new Uint8Array(publicKeyBuffer)),
      );
      logger.info("[WebAuthn] Public key extracted and encoded");

      return publicKeyBase64;
    } catch (error: any) {
      logger.error("[WebAuthn] Error creating passkey:", error);
      throw error;
    }
  }

  async validatePasskey(
    challenge: string,
    allowedCredentials: Array<{ id: string; type: string }>,
    rpId: string,
  ): Promise<{
    credentialId: string;
    signature: string;
    authenticatorData: string;
    clientDataJSON: string;
  } | null> {
    logger.info("[WebAuthn] Validating passkey with browser API");

    try {
      // Convert challenge from base64 to Uint8Array
      const challengeBuffer = Uint8Array.from(atob(challenge), (c) =>
        c.charCodeAt(0),
      );

      // Convert credential IDs from base64 to Uint8Array
      const allowCredentials = allowedCredentials.map((cred) => ({
        id: Uint8Array.from(atob(cred.id), (c) => c.charCodeAt(0)),
        type: cred.type as PublicKeyCredentialType,
      }));

      const publicKeyOptions: PublicKeyCredentialRequestOptions = {
        challenge: challengeBuffer,
        rpId: rpId,
        allowCredentials: allowCredentials,
        userVerification: "preferred",
        timeout: 60000,
      };

      logger.info("[WebAuthn] Requesting credential assertion");
      const credential = (await navigator.credentials.get({
        publicKey: publicKeyOptions,
      })) as PublicKeyCredential | null;

      if (!credential) {
        logger.warn("[WebAuthn] Credential assertion returned null");
        return null;
      }

      logger.info("[WebAuthn] Credential assertion received");

      const response = credential.response as AuthenticatorAssertionResponse;

      // Convert buffers to base64
      const credentialId = btoa(
        String.fromCharCode(...new Uint8Array(credential.rawId)),
      );
      const signature = btoa(
        String.fromCharCode(...new Uint8Array(response.signature)),
      );
      const authenticatorData = btoa(
        String.fromCharCode(...new Uint8Array(response.authenticatorData)),
      );
      const clientDataJSON = btoa(
        String.fromCharCode(...new Uint8Array(response.clientDataJSON)),
      );

      logger.info("[WebAuthn] Credential data extracted and encoded");

      return {
        credentialId,
        signature,
        authenticatorData,
        clientDataJSON,
      };
    } catch (error: any) {
      logger.error("[WebAuthn] Error validating passkey:", error);
      throw error;
    }
  }
}

/**
 * Main PasskeyManager that automatically selects the appropriate provider
 */
export class PasskeyManager {
  private provider: IPasskeyProvider;
  private api: PasskeyApiCallbacks;
  private config: PasskeyConfig;

  constructor(
    api: PasskeyApiCallbacks,
    config: PasskeyConfig = {
      relyingPartyId: "gl.argon.app",
      relyingPartyName: "ArgonChat",
      origin: "https://aegis.argon.gl",
      timeoutMilliseconds: 60000,
    },
  ) {
    this.api = api;
    this.config = config;

    // Auto-select provider based on environment
    const nativeProvider = new NativeProvider();
    const webAuthnProvider = new WebAuthnProvider();

    if (nativeProvider.isSupported()) {
      logger.info("[PasskeyManager] Using native passkey provider");
      this.provider = nativeProvider;
    } else if (webAuthnProvider.isSupported()) {
      logger.info("[PasskeyManager] Using WebAuthn provider");
      this.provider = webAuthnProvider;
    } else {
      logger.error("[PasskeyManager] No passkey provider available");
      // Fallback to WebAuthn even if not supported (will fail gracefully)
      this.provider = webAuthnProvider;
    }
  }

  /**
   * Check if passkeys are supported in this environment
   */
  isSupported(): boolean {
    return this.provider.isSupported();
  }

  /**
   * Create a new passkey
   */
  async createPasskey(
    name: string,
    user: PasskeyUser,
  ): Promise<PasskeyCreateResult> {
    logger.info("[PasskeyManager] Starting passkey creation:", name);

    if (!name.trim()) {
      logger.warn("[PasskeyManager] Empty passkey name");
      return {
        success: false,
        error: "Passkey name is required",
      };
    }

    try {
      // Step 1: Begin passkey creation on server
      logger.info("[PasskeyManager] Requesting challenge from server");
      const beginResult = await this.api.beginAddPasskey(name);

      if (!beginResult.success) {
        logger.error("[PasskeyManager] Server rejected passkey creation");
        return {
          success: false,
          error: "Failed to begin passkey creation",
        };
      }

      const passkeyId = beginResult.passkeyId!;
      const challenge = beginResult.challenge!;
      logger.info("[PasskeyManager] Challenge received:", passkeyId);

      // Step 2: Create passkey using the selected provider
      logger.info("[PasskeyManager] Creating passkey with provider");
      const publicKeyBase64 = await this.provider.createPasskey(
        passkeyId,
        challenge,
        user,
        this.config.relyingPartyName,
        this.config.relyingPartyId,
      );

      if (!publicKeyBase64) {
        logger.error("[PasskeyManager] Provider returned null public key");
        return {
          success: false,
          error: "Failed to create passkey",
        };
      }

      // Step 3: Complete passkey creation on server
      logger.info("[PasskeyManager] Completing passkey creation on server");
      const completeResult = await this.api.completeAddPasskey(
        passkeyId,
        publicKeyBase64,
      );

      if (!completeResult.success) {
        logger.error("[PasskeyManager] Server rejected passkey completion");
        return {
          success: false,
          error: "Failed to complete passkey creation",
        };
      }

      const passkey = completeResult.passkey!;
      logger.info("[PasskeyManager] Passkey created successfully:", passkey.id);

      return {
        success: true,
        passkeyId: passkey.id,
        name: passkey.name,
        createdAt: passkey.createdAt,
      };
    } catch (error: any) {
      logger.error(
        "[PasskeyManager] Exception during passkey creation:",
        error,
      );

      // Map error codes
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

      return {
        success: false,
        error: errorMessage,
        errorCode,
      };
    }
  }

  /**
   * Remove an existing passkey
   */
  async removePasskey(passkeyId: string): Promise<PasskeyRemoveResult> {
    logger.info("[PasskeyManager] Removing passkey:", passkeyId);

    try {
      const result = await this.api.removePasskey(passkeyId);

      if (result.success) {
        logger.info("[PasskeyManager] Passkey removed successfully");
        return { success: true };
      }

      logger.error("[PasskeyManager] Failed to remove passkey");
      return {
        success: false,
        error: "Failed to remove passkey",
      };
    } catch (error: any) {
      logger.error("[PasskeyManager] Exception during passkey removal:", error);
      return {
        success: false,
        error: "Failed to remove passkey",
      };
    }
  }

  /**
   * Validate/authenticate using a passkey
   */
  async validatePasskey(): Promise<PasskeyValidateResult> {
    logger.info("[PasskeyManager] Starting passkey validation");

    try {
      // Step 1: Begin passkey validation on server
      logger.info("[PasskeyManager] Requesting challenge from server");
      const beginResult = await this.api.beginValidatePasskey();

      if (!beginResult.success) {
        logger.error("[PasskeyManager] Server rejected passkey validation");
        return {
          success: false,
          error: "Failed to begin passkey validation",
        };
      }

      const challenge = beginResult.challenge!;
      const allowedCredentials = beginResult.allowedCredentials || [];
      logger.info(
        "[PasskeyManager] Challenge received with",
        allowedCredentials.length,
        "allowed credentials",
      );

      // Step 2: Get assertion using the selected provider
      logger.info("[PasskeyManager] Getting assertion from provider");
      const assertionData = await this.provider.validatePasskey(
        challenge,
        allowedCredentials,
        this.config.relyingPartyId,
      );

      if (!assertionData) {
        logger.error("[PasskeyManager] Provider returned null assertion");
        return {
          success: false,
          error: "Failed to get passkey assertion",
        };
      }

      // Step 3: Complete passkey validation on server
      logger.info("[PasskeyManager] Completing passkey validation on server");
      const completeResult = await this.api.completeValidatePasskey(
        assertionData.credentialId,
        assertionData.signature,
        assertionData.authenticatorData,
        assertionData.clientDataJSON,
      );

      if (!completeResult.success) {
        logger.error("[PasskeyManager] Server rejected passkey validation");
        return {
          success: false,
          error: "Failed to complete passkey validation",
        };
      }

      logger.info("[PasskeyManager] Passkey validated successfully");
      return { success: true };
    } catch (error: any) {
      logger.error(
        "[PasskeyManager] Exception during passkey validation:",
        error,
      );

      // Map error codes
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

      return {
        success: false,
        error: errorMessage,
        errorCode,
      };
    }
  }
}

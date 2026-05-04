/**
 * Video encoding profiles and codec selection logic.
 */

export const RENDER_FPS = 60;

export interface EncodingProfile {
  codec: string;
  maxWidth: number;
  maxHeight: number;
  baseBitrate: number;
}

const HD_PROFILE: EncodingProfile = {
  codec: 'avc1.4d4028',
  maxWidth: 1920,
  maxHeight: 1080,
  baseBitrate: 20e6,
};

const SD_PROFILE: EncodingProfile = {
  codec: 'avc1.42001f',
  maxWidth: 1280,
  maxHeight: 720,
  baseBitrate: 14e6,
};

/** Ordered from highest to lowest quality. First matching profile is selected. */
const PROFILES: EncodingProfile[] = [HD_PROFILE, SD_PROFILE];

const REFERENCE_FPS = 30;

/**
 * Select an encoding profile and compute bitrate for the given output dimensions.
 */
export function selectEncodingProfile(width: number, height: number, fps: number = REFERENCE_FPS): { codec: string; bitrate: number } {
  const profile = (height > SD_PROFILE.maxHeight || width > SD_PROFILE.maxWidth) ? HD_PROFILE : SD_PROFILE;
  const pixelRate = width * height * fps;
  const referenceRate = profile.maxWidth * profile.maxHeight * REFERENCE_FPS;
  return {
    codec: profile.codec,
    bitrate: (pixelRate / referenceRate) * profile.baseBitrate,
  };
}

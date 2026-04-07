import type { InjectionKey, Ref } from "vue";

export interface IAvatarFileStorage {
  fetchUserAvatar(fileId: string, userId: string): Promise<string>;
  fetchServerAvatar(fileId: string, serverId: string): Promise<string>;
  fetchUserAvatarUrl(fileId: string): string;
  fetchServerAvatarUrl(fileId: string): string;
  FAILED_ADDRESS: string;
}

export interface IUserPool {
  getUserReactive(userId: Ref<string>): Ref<{
    avatarFileId: string | null;
    displayName: string | null;
  } | null | undefined>;
}

export const AvatarFileStorageKey: InjectionKey<IAvatarFileStorage> = Symbol("AvatarFileStorage");
export const UserPoolKey: InjectionKey<IUserPool> = Symbol("UserPool");

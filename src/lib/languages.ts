import tengwarFlagUrl from "@/styles/flags/tengwar.svg?url";

export interface Language {
  key: string;
  code: string;
  emoji?: string;
  flagUrl?: string;
  fontFamily?: string;
  disabled?: boolean;
}

export const availableLanguages: readonly Language[] = [
  {
    key: "English, UK",
    code: "en",
    emoji: "🇺🇲",
  },
  {
    key: "Пирацкий",
    code: "ru_pt",
    emoji: "🏴‍☠️",
  },
  {
    key: "日本語",
    code: "jp",
    emoji: "🇯🇵",
  },
  {
    key: "Русский",
    code: "ru",
    emoji: "🇷🇺",
  },
  {
    key: "Հայկական",
    code: "am",
    emoji: "🇦🇲",
  },
  {
    key: "Español",
    code: "es",
    emoji: "🇪🇸",
  },
  {
    key: "Deutsch",
    code: "de",
    emoji: "🇩🇪",
  },
  {
    key: "Polski",
    code: "pl",
    emoji: "🇵🇱",
  },
  {
    key: "한국어",
    code: "ko",
    emoji: "🇰🇷",
  },
  {
    key: "Қазақша",
    code: "kk",
    emoji: "🇰🇿",
  },
  {
    key: "Oʻzbekcha",
    code: "uz",
    emoji: "🇺🇿",
  },
  {
    // "Tengwar", as `bun run i18n:tengwar -- Tengwar` spells it: Private Use Area tengwar the font below draws.
    key: "",
    code: "en_tengwar",
    flagUrl: tengwarFlagUrl,
    fontFamily: "Alcarin Tengwar",
  },
] as const;

export const getLanguageByCode = (code: string): Language | undefined => {
  return availableLanguages.find((lang) => lang.code === code);
};

export const getEnabledLanguages = (): readonly Language[] => {
  return availableLanguages.filter((lang) => !lang.disabled);
};

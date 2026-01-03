import { ref, type Ref } from "vue";
import type { Language } from "@/lib/languages";

interface UseLanguageSelectionOptions {
  onSelect?: (code: string) => void;
  animationDuration?: number;
}

export function useLanguageSelection(
  currentCode: Ref<string>,
  options: UseLanguageSelectionOptions = {}
) {
  const { onSelect, animationDuration = 600 } = options;

  const justSelected = ref<string | null>(null);

  const selectLanguage = (code: string) => {
    currentCode.value = code;
    justSelected.value = code;
    
    setTimeout(() => {
      justSelected.value = null;
    }, animationDuration);

    onSelect?.(code);
  };

  const isSelected = (language: Language) => {
    return currentCode.value === language.code;
  };

  const isDisabled = (language: Language) => {
    return language.disabled === true;
  };

  const canSelect = (language: Language) => {
    return !isDisabled(language);
  };

  return {
    justSelected,
    selectLanguage,
    isSelected,
    isDisabled,
    canSelect,
  };
}

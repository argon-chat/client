const RADIO_SELECTOR = '[role="radio"]';

const GROUP_SELECTOR = '[role="radiogroup"]';

/** Where an arrow, Home or End moves from `from` in a group of `count`, wrapping at the ends; null for any other key. */
export function radioStepTarget(event: KeyboardEvent, from: number, count: number): number | null {
  if (count === 0 || event.altKey || event.ctrlKey || event.metaKey) {
    return null;
  }

  switch (event.key) {
    case "ArrowRight":
    case "ArrowDown":
      return (from + 1) % count;

    case "ArrowLeft":
    case "ArrowUp":
      return (from - 1 + count) % count;

    case "Home":
      return 0;

    case "End":
      return count - 1;

    default:
      return null;
  }
}

/** Focus follows the choice: the radio at `index` of the group `radio` belongs to. */
export function focusRadioAt(radio: Element, index: number): void {
  const group = radio.closest(GROUP_SELECTOR);

  if (group === null) {
    return;
  }

  const target = group.querySelectorAll<HTMLElement>(RADIO_SELECTOR)[index];

  if (target !== undefined) {
    target.focus();
  }
}

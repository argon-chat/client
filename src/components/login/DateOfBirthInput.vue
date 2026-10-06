<script setup lang="ts">
/**
 * Date of birth, typed rather than navigated.
 *
 * A calendar is the wrong instrument for this one field: a birth date is known exactly and is
 * decades away from the month a picker opens on, so choosing one means paging or scrubbing a year
 * dropdown before the day is even visible. Three short numeric boxes take the same keystrokes the
 * person would say the date in, and nothing needs to be aimed at.
 *
 * Day-Month-Year with each box labelled: the labels, not the order, say which is which, so no
 * locale reads it as the wrong date. The model stays a `DateValue`, so callers keep the shape the
 * calendar gave them.
 *
 * Each box takes only what can still be a value for it. A month of 19 or a year starting with 0 is
 * refused as it is typed, not reported once the whole date is in; the only thing left for the
 * complete-date check is what no single box can know, like the 30th of February or the age limit.
 */
import { computed, ref, watch, type Ref } from "vue";
import { CalendarDate, getLocalTimeZone, today } from "@internationalized/date";
import type { DateValue } from "reka-ui";
import { useLocale } from "@/store/system/localeStore";

const props = withDefaults(
  defineProps<{
    modelValue?: DateValue;
    disabled?: boolean;
    /** Youngest age the form accepts. */
    minAge?: number;
    /** Oldest year worth offering — anything before it is a typo, not a birth year. */
    minYear?: number;
  }>(),
  { minAge: 14, minYear: 1900 },
);

const emit = defineEmits<{ (e: "update:modelValue", value: DateValue | undefined): void }>();

const { t } = useLocale();

type Segment = "day" | "month";
const SEGMENT_MAX: Record<Segment, number> = { day: 31, month: 12 };
const thisYear = today(getLocalTimeZone()).year;

const day = ref(props.modelValue ? String(props.modelValue.day).padStart(2, "0") : "");
const month = ref(props.modelValue ? String(props.modelValue.month).padStart(2, "0") : "");
const year = ref(props.modelValue ? String(props.modelValue.year) : "");

const dayEl = ref<HTMLInputElement | null>(null);
const monthEl = ref<HTMLInputElement | null>(null);
const yearEl = ref<HTMLInputElement | null>(null);

// Nothing is complained about until every box has been filled in — an error next to a date the
// person is still halfway through typing is just noise. A lone zero is a box still being typed.
const error = ref<string | null>(null);

const isComplete = computed(
  () => Number(day.value) > 0 && Number(month.value) > 0 && year.value.length === 4,
);

/** Calendar-real, not just numerically in range: 31 February is three digits of nonsense. */
function isRealDate(y: number, m: number, d: number): boolean {
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
  );
}

function validate(): DateValue | undefined {
  if (!isComplete.value) {
    error.value = null;
    return undefined;
  }

  const d = Number(day.value);
  const m = Number(month.value);
  const y = Number(year.value);

  if (!isRealDate(y, m, d) || y < props.minYear) {
    error.value = t("dob_invalid");
    return undefined;
  }

  const value = new CalendarDate(y, m, d);
  if (value.compare(today(getLocalTimeZone()).subtract({ years: props.minAge })) > 0) {
    error.value = t("dob_too_young");
    return undefined;
  }

  error.value = null;
  return value;
}

/**
 * True while this component is the reason `modelValue` changed.
 *
 * A half-typed or impossible date is emitted as `undefined`, which `v-model` writes straight back —
 * so the watcher below sees the same `undefined` the form would send to clear the field, and the two
 * mean opposite things: one must leave the boxes exactly as the person is typing them, the other
 * must empty them. Consumed by the first prop change that follows, which is that echo.
 */
let selfEmitted = false;

function emitValue() {
  selfEmitted = true;
  emit("update:modelValue", validate());
}

watch([day, month, year], emitValue);

// A value set from outside (a restored draft, a reset) is written back into the boxes.
watch(
  () => props.modelValue,
  (value) => {
    const isEcho = selfEmitted;
    selfEmitted = false;

    if (!value) {
      if (isEcho) return; // our own "not a date yet" — the boxes hold what is being typed
      day.value = "";
      month.value = "";
      year.value = "";
      error.value = null;
      return;
    }

    if (validate()?.compare(value) === 0) return;
    day.value = String(value.day).padStart(2, "0");
    month.value = String(value.month).padStart(2, "0");
    year.value = String(value.year);
  },
);

const digitsOf = (raw: string) => raw.replace(/\D/g, "");

/**
 * The box is written by hand as well as through the binding: when a keystroke is refused the ref
 * does not change, and Vue would then leave the refused character sitting in the box.
 */
function setBox(box: Ref<string>, el: HTMLInputElement | null, value: string) {
  box.value = value;
  if (el && el.value !== value) el.value = value;
}

/**
 * What a day or month box keeps of the digits in it.
 *
 * Only what can still become a real number for the box: `1` waits for its second digit, `4` is
 * already a whole day, `35` is not a day at all. When a second digit overflows the box, the first
 * digit is taken as the whole value and the second is carried into the next box — `3`, `5` typed
 * into the day box is the 3rd of May, which is what a native date field makes of it too. `00` is
 * not a value, so a second zero is dropped.
 */
function fitSegment(digits: string, max: number): { value: string; carry: string; settled: boolean } {
  if (digits.length === 0) return { value: "", carry: "", settled: false };
  const first = digits.charAt(0);
  if (digits.length === 1) {
    const settled = Number(first) * 10 > max;
    return { value: settled ? `0${first}` : first, carry: "", settled };
  }
  const n = Number(digits.slice(0, 2));
  if (n >= 1 && n <= max) return { value: digits.slice(0, 2), carry: "", settled: true };
  if (first === "0") return { value: "0", carry: "", settled: false };
  return { value: `0${first}`, carry: digits.charAt(1), settled: true };
}

/** Digits that can still become a year the form takes: `19`, `200`, `2` — not `0`, `18` or `21`. */
function isYearPrefix(digits: string): boolean {
  if (digits.length === 0) return true;
  const span = 10 ** (4 - digits.length);
  const low = Number(digits) * span;
  return low <= thisYear && low + span - 1 >= props.minYear;
}

/** Moves on once a box is settled, taking any carried digit along, so a date is typed straight through. */
function fillSegment(segment: Segment, digits: string) {
  const { value, carry, settled } = fitSegment(digits, SEGMENT_MAX[segment]);
  setBox(segment === "day" ? day : month, (segment === "day" ? dayEl : monthEl).value, value);
  if (!settled) return;

  if (segment === "day") {
    monthEl.value?.focus();
    if (carry) fillSegment("month", carry);
    else monthEl.value?.select();
  } else {
    yearEl.value?.focus();
    if (carry) fillYear(carry);
    else yearEl.value?.select();
  }
}

function fillYear(digits: string) {
  const value = digits.slice(0, 4);
  setBox(year, yearEl.value, isYearPrefix(value) ? value : year.value);
}

function onSegmentInput(segment: Segment, event: Event) {
  fillSegment(segment, digitsOf((event.target as HTMLInputElement).value));
}

function onYearInput(event: Event) {
  fillYear(digitsOf((event.target as HTMLInputElement).value));
}

/** Backspace at the start of an empty box steps back, so a correction never needs the mouse. */
function onBackspace(segment: "month" | "year", event: KeyboardEvent) {
  const value = segment === "month" ? month.value : year.value;
  if (value.length > 0) return;
  event.preventDefault();
  const previous = segment === "month" ? dayEl : monthEl;
  previous.value?.focus();
}

/** Pad a lone digit on the way out, so "5" reads back as "05"; a lone zero was never going to be anything. */
function padSegment(segment: Segment) {
  const box = segment === "day" ? day : month;
  if (box.value.length !== 1) return;
  box.value = box.value === "0" ? "" : `0${box.value}`;
}

/**
 * A date pasted into any box fills all three. Only a full eight digits are taken — a two-digit year
 * would have to be guessed a century for — read as day-month-year, or as year-month-day when the
 * leading four are the only four that can be a year. Eight digits that make no date are left alone.
 */
function onPaste(event: ClipboardEvent) {
  const digits = digitsOf(event.clipboardData?.getData("text") ?? "");
  if (digits.length !== 8) return;

  event.preventDefault();

  const isYear = (s: string) => Number(s) >= props.minYear && Number(s) <= thisYear;
  const isIso = isYear(digits.slice(0, 4)) && !isYear(digits.slice(4));
  const [d, m, y] = isIso
    ? [digits.slice(6, 8), digits.slice(4, 6), digits.slice(0, 4)]
    : [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)];
  const inRange = (s: string, max: number) => Number(s) >= 1 && Number(s) <= max;
  if (!inRange(d, SEGMENT_MAX.day) || !inRange(m, SEGMENT_MAX.month) || !isYear(y)) return;

  [day.value, month.value, year.value] = [d, m, y];
  yearEl.value?.focus();
}
</script>

<template>
  <div class="space-y-1.5">
    <!-- The row fills the field's width, as every other input on this form does, so the boxes are
         spaced across it rather than huddled at the left edge. -->
    <div class="flex w-full items-end gap-2">
      <label class="dob-field flex-1">
        <span class="dob-caption">{{ t("dob_day") }}</span>
        <input
          ref="dayEl"
          :value="day"
          :disabled="disabled"
          class="dob-box"
          :class="{ 'is-invalid': error }"
          inputmode="numeric"
          autocomplete="bday-day"
          maxlength="2"
          :placeholder="t('dob_placeholder_day')"
          @input="onSegmentInput('day', $event)"
          @blur="padSegment('day')"
          @paste="onPaste"
        />
      </label>

      <span class="dob-separator">/</span>

      <label class="dob-field flex-1">
        <span class="dob-caption">{{ t("dob_month") }}</span>
        <input
          ref="monthEl"
          :value="month"
          :disabled="disabled"
          class="dob-box"
          :class="{ 'is-invalid': error }"
          inputmode="numeric"
          autocomplete="bday-month"
          maxlength="2"
          :placeholder="t('dob_placeholder_month')"
          @input="onSegmentInput('month', $event)"
          @keydown.backspace="onBackspace('month', $event)"
          @blur="padSegment('month')"
          @paste="onPaste"
        />
      </label>

      <span class="dob-separator">/</span>

      <label class="dob-field flex-[1.6]">
        <span class="dob-caption">{{ t("dob_year") }}</span>
        <input
          ref="yearEl"
          :value="year"
          :disabled="disabled"
          class="dob-box"
          :class="{ 'is-invalid': error }"
          inputmode="numeric"
          autocomplete="bday-year"
          maxlength="4"
          :placeholder="t('dob_placeholder_year')"
          @input="onYearInput($event)"
          @keydown.backspace="onBackspace('year', $event)"
          @paste="onPaste"
        />
      </label>
    </div>

    <!-- Only ever says something when there is something to say: the age requirement is not worth
         a standing line under an empty field, it is worth a sentence the moment a date breaks it. -->
    <p v-if="error" class="text-xs text-red-400">{{ error }}</p>
  </div>
</template>

<style scoped>
.dob-field {
  @apply flex flex-col gap-1;
}

/* Centred over its own box, like the digits under it — the three captions are part of the field,
   not a column of left-aligned labels beside it. */
.dob-caption {
  @apply text-center text-[11px] leading-4 text-muted-foreground;
}

.dob-box {
  @apply h-11 w-full rounded-xl border border-border bg-background/50 px-3 text-center text-white
         tabular-nums tracking-[0.08em] outline-none transition-all
         placeholder:tracking-normal placeholder:text-muted-foreground/60
         focus:border-primary focus:ring-2 focus:ring-primary/20
         disabled:cursor-not-allowed disabled:opacity-50;
}

.dob-box.is-invalid {
  @apply border-red-500/70 focus:border-red-500 focus:ring-red-500/30;
}

/* The separators line up with the boxes, not with the captions above them. */
.dob-separator {
  @apply pb-3 text-muted-foreground/60;
}
</style>

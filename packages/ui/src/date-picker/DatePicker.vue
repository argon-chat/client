<script setup lang="ts">
import type { DateValue } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import type { LayoutTypes } from '../calendar'
import { DateFormatter, getLocalTimeZone, today } from '@internationalized/date'
import { useVModel } from '@vueuse/core'
import { CalendarIcon, XIcon } from 'lucide-vue-next'
import { 
  PopoverRoot,
  PopoverTrigger,
  PopoverPortal,
  PopoverContent,
} from 'reka-ui'
import { toDate } from 'reka-ui/date'
import { computed, ref, watch } from 'vue'
import { cn } from '@argon/core'
import { Button, type ButtonVariants } from '../button'
import { Calendar } from '../calendar'

export interface DatePickerProps {
  /** Selected date (v-model) */
  modelValue?: DateValue | undefined
  /** Placeholder text when no date is selected */
  placeholder?: string
  /** Date display format */
  dateFormat?: Intl.DateTimeFormatOptions
  /** Locale for formatting (ru-RU, en-US, etc.) */
  locale?: string
  /** Minimum allowed date */
  minValue?: DateValue
  /** Maximum allowed date */
  maxValue?: DateValue
  /** Disable the component */
  disabled?: boolean
  /** Read-only state */
  readonly?: boolean
  /** Whether the selected date can be cleared */
  clearable?: boolean
  /** Show calendar icon */
  showIcon?: boolean
  /** Button variant */
  variant?: ButtonVariants['variant']
  /** Button size */
  size?: ButtonVariants['size']
  /** Calendar layout */
  layout?: LayoutTypes
  /** Year range for selection */
  yearRange?: DateValue[]
  /** Date for initial calendar display */
  defaultPlaceholder?: DateValue
  /** CSS class for trigger button */
  class?: HTMLAttributes['class']
  /** CSS class for calendar */
  calendarClass?: HTMLAttributes['class']
  /** Popover alignment */
  align?: 'start' | 'center' | 'end'
  /** Popover side */
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** ID for accessibility */
  id?: string
  /** Field name (for forms) */
  name?: string
  /** Required field */
  required?: boolean
  /** Error state */
  error?: boolean
  /** Close popup after date selection */
  closeOnSelect?: boolean
}

const props = withDefaults(defineProps<DatePickerProps>(), {
  placeholder: 'Pick a date',
  dateFormat: () => ({ dateStyle: 'long' }),
  locale: 'en-US',
  disabled: false,
  readonly: false,
  clearable: false,
  showIcon: true,
  variant: 'outline',
  layout: 'month-and-year',
  align: 'start',
  side: 'bottom',
  required: false,
  error: false,
  closeOnSelect: true,
})

const emit = defineEmits<{
  'update:modelValue': [value: DateValue | undefined]
  'change': [value: DateValue | undefined]
  'clear': []
  'open': []
  'close': []
}>()

const modelValue = useVModel(props, 'modelValue', emit, {
  passive: true,
  defaultValue: undefined,
})

const isOpen = ref(false)

// Date formatter with locale support
const formatter = computed(() => new DateFormatter(props.locale, props.dateFormat))

// Calendar placeholder (for initial display)
const calendarPlaceholder = computed(() => {
  return props.defaultPlaceholder ?? today(getLocalTimeZone())
})

// Formatted value for display
const displayValue = computed(() => {
  if (!modelValue.value) return null
  try {
    return formatter.value.format(toDate(modelValue.value as DateValue))
  } catch {
    return null
  }
})

// Handle date selection
function handleSelect(value: DateValue | undefined) {
  modelValue.value = value
  emit('change', value)
  
  if (props.closeOnSelect && value) {
    isOpen.value = false
  }
}

// Clear value
function handleClear(e: Event) {
  e.stopPropagation()
  modelValue.value = undefined
  emit('clear')
  emit('change', undefined)
}

// Watch open state for events
watch(isOpen, (open) => {
  if (props.disabled || props.readonly) {
    isOpen.value = false
    return
  }
  if (open) {
    emit('open')
  } else {
    emit('close')
  }
})

// Button classes based on states
const triggerClasses = computed(() => cn(
  'w-full justify-start text-left font-normal',
  !modelValue.value && 'text-muted-foreground',
  props.error && 'border-destructive focus-visible:ring-destructive',
  props.readonly && 'cursor-default',
  props.class,
))
</script>

<template>
  <PopoverRoot v-model:open="isOpen">
    <PopoverTrigger as-child :disabled="disabled">
      <Button
        :id="id"
        :variant="variant"
        :size="size"
        :disabled="disabled"
        :class="triggerClasses"
        :aria-required="required"
        :aria-invalid="error"
        :aria-expanded="isOpen"
        role="combobox"
      >
        <!-- Calendar icon on the left -->
        <slot name="icon">
          <CalendarIcon v-if="showIcon" class="mr-2 h-4 w-4 shrink-0 opacity-50" />
        </slot>
        
        <!-- Displayed value or placeholder -->
        <span class="flex-1 truncate">
          <slot name="value" :value="modelValue" :formatted="displayValue">
            {{ displayValue ?? placeholder }}
          </slot>
        </span>
        
        <!-- Clear button -->
        <slot name="clear" :clear="handleClear" :has-value="!!modelValue">
          <button
            v-if="clearable && modelValue && !disabled && !readonly"
            type="button"
            class="ml-2 rounded-sm opacity-50 hover:opacity-100 focus:outline-none focus:ring-1 focus:ring-ring"
            @click="handleClear"
            @keydown.enter.prevent="handleClear"
            aria-label="Clear date"
          >
            <XIcon class="h-4 w-4" />
          </button>
        </slot>
      </Button>
    </PopoverTrigger>
    
    <PopoverPortal>
      <PopoverContent 
        :class="cn(
          'z-50 w-auto rounded-md border bg-popover p-0 text-popover-foreground shadow-md outline-none',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
          'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        )"
        :align="align" 
        :side="side"
        :side-offset="4"
      >
        <slot 
          name="calendar" 
          :value="modelValue" 
          :on-select="handleSelect"
          :min-value="minValue"
          :max-value="maxValue"
        >
          <Calendar
            :model-value="(modelValue as DateValue)"
            initial-focus
            :default-placeholder="calendarPlaceholder"
            :layout="layout"
            :min-value="minValue"
            :max-value="maxValue"
            :year-range="yearRange"
            :locale="locale"
            :class="calendarClass"
            @update:model-value="handleSelect"
          />
        </slot>
        
        <!-- Slot for additional elements below the calendar -->
        <slot name="footer" :value="modelValue" :clear="handleClear" />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

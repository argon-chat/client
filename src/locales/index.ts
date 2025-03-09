import en from './en.json'
import ru from './ru.json'
import jp from './jp.json'
import ruPt from './ru_pt.json'

export const locales = {
  en,
  ru,
  ru_pt: ruPt,
  jp
} as const

export type Locale = keyof typeof locales

export type LocaleSchema = typeof en

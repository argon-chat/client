/** Application preferences, represented as plain TypeScript data. */
export enum ConfigValueType { Boolean, Number, String, Enum, Double }
export interface ConfigKey {
  key: string; type: ConfigValueType; requiredToRestartApp: boolean; onlyForDevMode: boolean;
  valueB: boolean | null; valueStr: string | null; valueNum: bigint | null;
  valueEnum: string | null; valueEnumVariants: string[]; valueF: number | null;
}
export interface ConfigSection { section: string; keys: ConfigKey[] }
export interface ConfigUpdate {
  key: string; section: string; valueB: boolean | null; valueStr: string | null;
  valueNum: bigint | null; valueEnum: string | null; valueF: number | null;
}
/** `value` is null when the update was refused; `error` then says what was refused and why. */
export interface ConfigResult { value: ConfigKey | null; error?: string }

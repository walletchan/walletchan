import { SAFE_4337_MODULE } from "@walletchan/shared/safe4337";
export function hasBunkerModule(modules: readonly string[], fallback: string): boolean {
  return modules.length === 1 && modules[0].toLowerCase() === SAFE_4337_MODULE.toLowerCase() && fallback.toLowerCase() === SAFE_4337_MODULE.toLowerCase();
}

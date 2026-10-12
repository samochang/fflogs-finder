import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind のクラスを条件付きで合成する（shadcn/ui と同じユーティリティ）。 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

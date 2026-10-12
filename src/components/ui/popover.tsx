"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils.ts";

/**
 * Radix の Popover。
 *
 * Portal で body 直下に描画されるため、
 *  - 表のスクロール領域（overflow）で切れない
 *  - 行の高さが変わらない（切り替え UI が他要素に影響しない）
 *  - sticky なヘッダやセルの下に隠れない
 */
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export function PopoverContent({
  className,
  align = "start",
  sideOffset = 6,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "z-[60] min-w-40 rounded-lg border border-line-strong bg-surface p-2.5 shadow-xl outline-none",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

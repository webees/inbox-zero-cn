"use client";

import { Label, Radio, RadioGroup } from "@headlessui/react";
import { cn } from "@/utils";

export const frequencies = [
  {
    value: "monthly" as const,
    label: "按月",
    priceSuffix: "/月，按月计费",
  },
  {
    value: "annually" as const,
    label: "按年",
    priceSuffix: "/月，按年计费",
  },
];

export type Frequency = (typeof frequencies)[number];

export function PricingFrequencyToggle({
  frequency,
  setFrequency,
  className,
  children,
}: {
  frequency: Frequency;
  setFrequency: (frequency: Frequency) => void;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-center justify-center", className)}>
      <RadioGroup
        value={frequency}
        onChange={setFrequency}
        className="grid grid-cols-2 gap-x-1 rounded-full p-1 text-center text-xs font-semibold leading-5 ring-1 ring-inset ring-gray-200"
      >
        <Label className="sr-only">付款频率</Label>
        {frequencies.map((option) => (
          <Radio
            key={option.value}
            value={option}
            className={({ checked }) =>
              cn(
                checked ? "bg-black text-white" : "text-gray-500",
                "cursor-pointer rounded-full px-2.5 py-1",
              )
            }
          >
            <span>{option.label}</span>
          </Radio>
        ))}
      </RadioGroup>
      {children}
    </div>
  );
}

export function DiscountBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-blue-600/10 px-2.5 py-1 text-xs font-semibold leading-5 text-blue-600">
      {children}
    </span>
  );
}

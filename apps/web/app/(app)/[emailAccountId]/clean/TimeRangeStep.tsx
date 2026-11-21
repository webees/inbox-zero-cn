"use client";

import { useCallback } from "react";
import { parseAsInteger, useQueryState } from "nuqs";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { TypographyH3 } from "@/components/Typography";
import { useStep } from "@/app/(app)/[emailAccountId]/clean/useStep";
import { ButtonListSurvey } from "@/components/ButtonListSurvey";

export function TimeRangeStep() {
  const { i18n } = useLingui();
  const { onNext } = useStep();

  const [_, setTimeRange] = useQueryState("timeRange", parseAsInteger);

  const handleTimeRangeSelect = useCallback(
    (selectedRange: string | number) => {
      const range = Number(selectedRange);
      setTimeRange(range);
      onNext();
    },
    [setTimeRange, onNext],
  );

  return (
    <div className="text-center">
      <TypographyH3>
        <Trans>你想处理哪些邮件？</Trans>
      </TypographyH3>

      <ButtonListSurvey
        className="mt-6"
        options={timeRangeOptions.map((option) => ({
          ...option,
          label: i18n._(option.label),
        }))}
        onClick={handleTimeRangeSelect}
      />
    </div>
  );
}

const timeRangeOptions = [
  { value: "0", label: msg`所有邮件` },
  { value: "1", label: msg`早于 1 天` },
  { value: "3", label: msg`早于 3 天` },
  { value: "7", label: msg`早于 1 周`, recommended: true },
  { value: "14", label: msg`早于 2 周` },
  { value: "30", label: msg`早于 1 个月` },
  { value: "90", label: msg`早于 3 个月` },
  { value: "365", label: msg`早于 1 年` },
];

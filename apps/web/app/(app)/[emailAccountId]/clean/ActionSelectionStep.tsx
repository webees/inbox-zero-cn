"use client";

import { useCallback } from "react";
import { parseAsStringEnum, useQueryState } from "nuqs";
import { Trans, useLingui } from "@lingui/react/macro";
import { TypographyH3 } from "@/components/Typography";
import { useStep } from "@/app/(app)/[emailAccountId]/clean/useStep";
import { ButtonListSurvey } from "@/components/ButtonListSurvey";
import { CleanAction } from "@/generated/prisma/enums";

export function ActionSelectionStep() {
  const { t } = useLingui();
  const { onNext } = useStep();
  const [_, setAction] = useQueryState(
    "action",
    parseAsStringEnum([CleanAction.ARCHIVE, CleanAction.MARK_READ]),
  );

  const onSetAction = useCallback(
    (action: CleanAction) => {
      setAction(action);
      onNext();
    },
    [setAction, onNext],
  );

  return (
    <div className="text-center">
      <TypographyH3 className="mx-auto max-w-lg">
        <Trans>你希望清理后的邮件被归档还是标记为已读？</Trans>
      </TypographyH3>

      <ButtonListSurvey
        className="mt-6"
        options={[
          {
            label: t`归档`,
            value: CleanAction.ARCHIVE,
          },
          { label: t`标记为已读`, value: CleanAction.MARK_READ },
        ]}
        onClick={(value) => onSetAction(value as CleanAction)}
      />
    </div>
  );
}

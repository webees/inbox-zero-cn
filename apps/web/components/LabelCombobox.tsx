"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/Combobox";
import { createLabelAction } from "@/utils/actions/mail";
import type { EmailLabel } from "@/providers/email-label-types";

export function LabelCombobox({
  value,
  onChangeValue,
  userLabels,
  isLoading,
  mutate,
  emailAccountId,
}: {
  value: {
    id: string | null;
    name: string | null;
  };
  onChangeValue: (value: string) => void;
  userLabels: EmailLabel[];
  isLoading: boolean;
  mutate: () => Promise<unknown>;
  emailAccountId: string;
}) {
  const [search, setSearch] = useState("");

  const selectedLabel = userLabels.find(
    (label) => label.id === value.id || label.name === value.name,
  );

  return (
    <Combobox
      options={userLabels.map((label) => ({
        value: label.id || "",
        label: label.name || "",
      }))}
      value={value.id || ""}
      onChangeValue={onChangeValue}
      search={search}
      onSearch={setSearch}
      placeholder={selectedLabel?.name || "选择标签"}
      emptyText={
        <div>
          <div>暂无标签</div>
          {search && (
            <Button
              className="mt-2"
              variant="outline"
              onClick={() => {
                const searchValue = search;

                toast.promise(
                  async () => {
                    const res = await createLabelAction(emailAccountId, {
                      name: searchValue,
                    });
                    if (res?.serverError) throw new Error(res.serverError);

                    await mutate();

                    setSearch("");

                    // 自动选中新建的标签
                    if (res?.data?.id) {
                      onChangeValue(res.data.id);
                    }

                    return res;
                  },
                  {
                    loading: `正在创建标签“${searchValue}”...`,
                    success: `已创建标签“${searchValue}”`,
                    error: (errorMessage: unknown) =>
                      `创建标签“${searchValue}”时出错：${
                        errorMessage instanceof Error
                          ? errorMessage.message
                          : String(errorMessage)
                      }`,
                  },
                );
              }}
            >
              {`创建“${search}”标签`}
            </Button>
          )}
        </div>
      }
      loading={isLoading}
    />
  );
}

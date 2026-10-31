"use client";

import { useCallback } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon } from "lucide-react";
import { useModal } from "@/hooks/useModal";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Input } from "@/components/Input";
import { toastSuccess, toastError } from "@/components/Toast";
import {
  createCategoryBody,
  type CreateCategoryBody,
} from "@/utils/actions/categorize.validation";
import { createCategoryAction } from "@/utils/actions/categorize";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Category } from "@/generated/prisma/client";
import { MessageText } from "@/components/Typography";
import { useAccount } from "@/providers/EmailAccountProvider";

type ExampleCategory = {
  name: string;
  description: string;
};

const EXAMPLE_CATEGORIES: ExampleCategory[] = [
  {
    name: "团队",
    description:
      "使用 @company.com 邮箱地址的内部团队成员，包括组织内的员工和同事",
  },
  {
    name: "客户",
    description: "属于客户的邮箱地址，包括寻求支持或与客户成功团队互动的联系人",
  },
  {
    name: "候选人",
    description: "求职者、潜在员工以及面试流程中的候选人",
  },
  {
    name: "求职申请",
    description: "你已申请或正在面试其职位的公司、招聘平台和招聘人员",
  },
  {
    name: "投资者",
    description: "现有和潜在投资者、投资机构以及风险投资联系人",
  },
  {
    name: "创始人",
    description: "创业公司创始人、创业者，以及寻求投资或合作的潜在投资组合公司",
  },
  {
    name: "供应商",
    description: "为你的公司提供产品或服务的服务商、供应商和业务合作伙伴",
  },
  {
    name: "服务器错误",
    description: "自动监控服务和错误报告系统",
  },
  {
    name: "媒体",
    description: "寻求采访或报道的记者、媒体机构、公关公司和行业出版物",
  },
  {
    name: "会议活动",
    description: "活动组织者、会议协调人员以及行业活动的演讲机会联系人",
  },
  {
    name: "非营利组织",
    description: "慈善组织、非政府组织、社会影响组织和慈善基金会",
  },
];

export function CreateCategoryButton({
  buttonProps,
}: {
  buttonProps?: ButtonProps;
}) {
  const { isModalOpen, openModal, closeModal, setIsModalOpen } = useModal();

  return (
    <div>
      <Button onClick={openModal} variant="outline" {...buttonProps}>
        {buttonProps?.children ?? (
          <>
            <PlusIcon className="mr-2 size-4" />
            添加
          </>
        )}
      </Button>

      <CreateCategoryDialog
        isOpen={isModalOpen}
        onOpenChange={setIsModalOpen}
        closeModal={closeModal}
      />
    </div>
  );
}

export function CreateCategoryDialog({
  category,
  isOpen,
  onOpenChange,
  closeModal,
}: {
  category?: Pick<Category, "name" | "description"> & { id?: string };
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  closeModal: () => void;
}) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>创建分类</DialogTitle>
        </DialogHeader>

        <CreateCategoryForm category={category} closeModal={closeModal} />
      </DialogContent>
    </Dialog>
  );
}

function CreateCategoryForm({
  category,
  closeModal,
}: {
  category?: Pick<Category, "name" | "description"> & { id?: string };
  closeModal: () => void;
}) {
  const { emailAccountId } = useAccount();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setValue,
  } = useForm<CreateCategoryBody>({
    resolver: zodResolver(createCategoryBody),
    defaultValues: {
      id: category?.id,
      name: category?.name,
      description: category?.description,
    },
  });

  const handleExampleClick = useCallback(
    (category: ExampleCategory) => {
      setValue("name", category.name);
      setValue("description", category.description);
    },
    [setValue],
  );

  const onSubmit: SubmitHandler<CreateCategoryBody> = useCallback(
    async (data) => {
      const result = await createCategoryAction(emailAccountId, data);

      if (result?.serverError) {
        toastError({
          description: `创建分类时出错。${result.serverError || ""}`,
        });
      } else {
        toastSuccess({ description: "分类已创建！" });
        closeModal();
      }
    },
    [closeModal, emailAccountId],
  );

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Input
        type="text"
        name="name"
        label="名称"
        registerProps={register("name", { required: true })}
        error={errors.name}
      />
      <Input
        type="text"
        autosizeTextarea
        rows={2}
        name="description"
        label="描述（可选）"
        explainText="供 AI 对发件人进行分类的补充信息"
        registerProps={register("description")}
        error={errors.description}
      />

      <div className="rounded border border-border bg-muted/50 p-3">
        <div className="text-xs font-medium">示例</div>
        <div className="mt-1 flex flex-wrap gap-2">
          {EXAMPLE_CATEGORIES.map((category) => (
            <Button
              key={category.name}
              type="button"
              variant="outline"
              size="xs"
              onClick={() => handleExampleClick(category)}
            >
              <PlusIcon className="mr-1 size-2" />
              {category.name}
            </Button>
          ))}
        </div>
      </div>

      {category && (
        <MessageText>
          注意：编辑分类名称/描述仅影响未来的分类结果。此分类中已有的
          邮箱地址不会受影响。
        </MessageText>
      )}

      <Button type="submit" loading={isSubmitting}>
        {category ? "更新" : "创建"}
      </Button>
    </form>
  );
}

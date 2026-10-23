"use client";

import { useCallback, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { LoadingContent } from "@/components/LoadingContent";
import { toastError, toastSuccess } from "@/components/Toast";
import { SnippetForm } from "@/components/snippets/SnippetForm";
import { useAccount } from "@/providers/EmailAccountProvider";
import { useSnippets } from "@/hooks/useSnippets";
import { deleteSnippetAction } from "@/utils/actions/snippet";
import { snippetPreview } from "@/utils/snippets/match-snippets";
import type { GetSnippetsResponse } from "@/app/api/user/snippets/route";

type SnippetItem = GetSnippetsResponse["snippets"][number];

export function SnippetsManager() {
  const { emailAccountId } = useAccount();
  const { data, error, isLoading, mutate } = useSnippets();
  const [isOpen, setIsOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<SnippetItem | null>(null);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setEditingItem(null);
  }, []);

  return (
    <div>
      <Dialog
        onOpenChange={(open) => {
          if (!open) setEditingItem(null);
          setIsOpen(open);
        }}
        open={isOpen || !!editingItem}
      >
        <DialogTrigger asChild>
          <Button size="sm">
            <Plus className="mr-2 h-4 w-4" />
            添加
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingItem ? "编辑片段" : "添加片段"}</DialogTitle>
            <DialogDescription className="sr-only">
              {editingItem ? "编辑此片段。" : "添加可复用的片段。"}
            </DialogDescription>
          </DialogHeader>
          <SnippetForm
            closeDialog={handleClose}
            editingItem={editingItem}
            refetch={() => {
              mutate();
            }}
          />
        </DialogContent>
      </Dialog>

      <Card className="mt-2">
        <LoadingContent error={error} loading={isLoading}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>快捷指令</TableHead>
                <TableHead>内容</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.snippets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3}>
                    <Empty className="border-0">
                      <EmptyHeader>
                        <EmptyTitle>暂无片段</EmptyTitle>
                        <EmptyDescription>
                          保存你经常复用的回复，然后在草稿中输入 /
                          即可插入它们。
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </TableCell>
                </TableRow>
              ) : (
                data?.snippets.map((item) => (
                  <SnippetTableRow
                    emailAccountId={emailAccountId}
                    item={item}
                    key={item.id}
                    onDelete={() => {
                      mutate();
                    }}
                    onEdit={() => setEditingItem(item)}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </LoadingContent>
      </Card>
    </div>
  );
}

function SnippetTableRow({
  emailAccountId,
  item,
  onDelete,
  onEdit,
}: {
  emailAccountId: string;
  item: SnippetItem;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const [isDeleting, setIsDeleting] = useState(false);

  return (
    <TableRow>
      <TableCell className="w-32 font-medium">/{item.shortcut}</TableCell>
      <TableCell className="max-w-0 truncate text-muted-foreground">
        {snippetPreview(item.content)}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onEdit} size="sm" variant="outline">
            编辑
          </Button>
          <ConfirmDialog
            confirmText="删除"
            description={`删除 /${item.shortcut}？此操作无法撤销。`}
            onConfirm={async () => {
              try {
                setIsDeleting(true);
                const result = await deleteSnippetAction(emailAccountId, {
                  id: item.id,
                });
                if (result?.serverError) {
                  toastError({
                    title: "删除片段时出错",
                    description: result.serverError,
                  });
                  return;
                }
                toastSuccess({ description: "片段已删除" });
                onDelete();
              } finally {
                setIsDeleting(false);
              }
            }}
            title="删除片段"
            trigger={
              <Button
                aria-label={`删除 /${item.shortcut}`}
                loading={isDeleting}
                size="sm"
                variant="outline"
              >
                <Trash2 aria-hidden="true" className="h-4 w-4" />
              </Button>
            }
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

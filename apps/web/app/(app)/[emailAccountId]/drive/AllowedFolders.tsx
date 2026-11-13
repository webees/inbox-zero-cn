"use client";

import { useCallback, useEffect, useMemo } from "react";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FolderIcon, Loader2Icon, PlusIcon } from "lucide-react";
import {
  Card,
  CardBasic,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { toastError, toastSuccess } from "@/components/Toast";
import {
  TreeProvider,
  TreeView,
  TreeNode,
  TreeNodeTrigger,
  TreeNodeContent,
  TreeExpander,
  TreeIcon,
  TreeLabel,
  useTree,
} from "@/components/kibo-ui/tree";
import { createDriveFolderAction } from "@/utils/actions/drive";
import {
  createDriveFolderBody,
  type CreateDriveFolderBody,
} from "@/utils/actions/drive.validation";
import { useDriveFolders } from "@/hooks/useDriveFolders";
import { LoadingContent } from "@/components/LoadingContent";
import { useDriveSubfolders } from "@/hooks/useDriveSubfolders";
import type {
  FolderItem,
  SavedFolder,
} from "@/app/api/user/drive/folders/route";
import { AlertBasic } from "@/components/Alert";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/Input";
import { useDialogState } from "@/hooks/useDialogState";
import { useDriveConnections } from "@/hooks/useDriveConnections";
import {
  folderSelection,
  type FolderChildrenMap,
} from "./allowed-folder-selection";
import { useFolderSelection } from "./use-folder-selection";

export function AllowedFolders({ emailAccountId }: { emailAccountId: string }) {
  const { data, isLoading, error, mutate } = useDriveFolders(emailAccountId);
  const { data: connectionsData } = useDriveConnections();
  const driveConnectionId = connectionsData?.connections[0]?.id;

  return (
    <LoadingContent loading={isLoading} error={error}>
      {data && (
        <AllowedFoldersContent
          emailAccountId={emailAccountId}
          availableFolders={data.availableFolders}
          savedFolders={data.savedFolders}
          staleFolderCount={data.staleFolderDbIds.length}
          mutateFolders={mutate}
          driveConnectionId={driveConnectionId ?? null}
        />
      )}
    </LoadingContent>
  );
}

function AllowedFoldersContent({
  emailAccountId,
  driveConnectionId,
  availableFolders,
  savedFolders,
  staleFolderCount,
  mutateFolders,
}: {
  emailAccountId: string;
  driveConnectionId: string | null;
  availableFolders: FolderItem[];
  savedFolders: SavedFolder[];
  staleFolderCount: number;
  mutateFolders: () => void;
}) {
  const { t } = useLingui();
  const {
    optimisticFolderIds,
    childrenByParentId,
    rootFolders,
    handleFolderToggle,
    handleChildrenLoaded,
  } = useFolderSelection({
    emailAccountId,
    availableFolders,
    savedFolders,
    mutateFolders,
  });

  const hasFolders = rootFolders.length > 0;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          <Trans>允许的文件夹</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            AI 会将文件归档到这些文件夹中，并可在其中创建子文件夹。
            如果没有合适的文件夹，它可以在云端硬盘根目录创建新文件夹。
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {staleFolderCount > 0 && (
          <AlertBasic
            className="mb-4"
            variant="blue"
            title={t`检测到已删除的文件夹`}
            description={t`已从保存列表中移除 ${plural(staleFolderCount, {
              one: "# 个已删除的文件夹",
              other: "# 个已删除的文件夹",
            })}。`}
          />
        )}
        {hasFolders ? (
          <>
            <TreeProvider
              showLines
              showIcons
              selectable={false}
              animateExpand
              indent={16}
            >
              <TreeView className="p-0">
                {rootFolders.map((folder, index) => (
                  <FolderNode
                    key={folder.id}
                    folder={folder}
                    isLast={index === rootFolders.length - 1}
                    selectedFolderIds={optimisticFolderIds}
                    onToggle={handleFolderToggle}
                    level={0}
                    parentPath=""
                    childrenByParentId={childrenByParentId}
                    onChildrenLoaded={handleChildrenLoaded}
                    knownChildren={childrenByParentId.get(folder.id)}
                  />
                ))}
              </TreeView>
            </TreeProvider>
            <div className="mt-2">
              <CreateFolderDialog
                emailAccountId={emailAccountId}
                driveConnectionId={driveConnectionId}
                onFolderCreated={mutateFolders}
                triggerLabel={t`Add folder`}
                triggerVariant="ghost"
                triggerSize="xs-2"
                triggerIcon={PlusIcon}
                triggerClassName="text-muted-foreground hover:text-foreground"
              />
            </div>
          </>
        ) : (
          <NoFoldersFound
            emailAccountId={emailAccountId}
            driveConnectionId={driveConnectionId}
            onFolderCreated={mutateFolders}
          />
        )}
      </CardContent>
    </Card>
  );
}

export function FolderNode({
  folder,
  isLast,
  selectedFolderIds,
  onToggle,
  onChildrenLoaded,
  level,
  parentPath,
  childrenByParentId,
  knownChildren,
}: {
  folder: FolderItem;
  isLast: boolean;
  selectedFolderIds: Set<string>;
  onToggle: (folder: FolderItem, isChecked: boolean) => void;
  onChildrenLoaded: (parent: FolderItem, children: FolderItem[]) => void;
  level: number;
  parentPath: string;
  childrenByParentId: FolderChildrenMap;
  knownChildren?: FolderItem[];
}) {
  const { expandedIds } = useTree();
  const isExpanded = expandedIds.has(folder.id);
  const currentPath = parentPath ? `${parentPath}/${folder.name}` : folder.name;

  const { data: subfoldersData, isLoading: isLoadingSubfolders } =
    useDriveSubfolders(
      isExpanded && !knownChildren
        ? {
            folderId: folder.id,
            driveConnectionId: folder.driveConnectionId,
          }
        : null,
    );

  const rawSubfolders = knownChildren ?? subfoldersData?.folders ?? [];
  const subfolders = useMemo(
    () =>
      rawSubfolders.map((subfolder) => ({
        ...subfolder,
        parentId: folder.id,
        path: `${currentPath}/${subfolder.name}`,
      })),
    [currentPath, folder.id, rawSubfolders],
  );
  const checkboxState = folderSelection.getSelectionState({
    item: folder,
    selectedKeys: selectedFolderIds,
    childrenByParentId,
  });
  const hasLoadedChildren = subfolders.length > 0;

  useEffect(() => {
    if (!subfoldersData?.folders || knownChildren) return;
    onChildrenLoaded(folder, subfolders);
  }, [
    folder,
    knownChildren,
    onChildrenLoaded,
    subfolders,
    subfoldersData?.folders,
  ]);

  return (
    <TreeNode nodeId={folder.id} level={level} isLast={isLast}>
      <TreeNodeTrigger className="py-1">
        {isLoadingSubfolders ? (
          <div className="mr-1 flex h-4 w-4 items-center justify-center">
            <Loader2Icon className="h-3 w-3 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <TreeExpander hasChildren={true} />
        )}
        <TreeIcon hasChildren />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Checkbox
            id={`folder-${folder.id}`}
            checked={checkboxState}
            onCheckedChange={(checked) =>
              onToggle({ ...folder, path: currentPath }, checked === true)
            }
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
              }
            }}
          />
          <TreeLabel title={folder.name}>{folder.name}</TreeLabel>
        </div>
      </TreeNodeTrigger>
      <TreeNodeContent hasChildren={isExpanded}>
        {hasLoadedChildren ? (
          subfolders.map((subfolder, index) => (
            <FolderNode
              key={subfolder.id}
              folder={subfolder}
              isLast={index === subfolders.length - 1}
              selectedFolderIds={selectedFolderIds}
              onToggle={onToggle}
              onChildrenLoaded={onChildrenLoaded}
              level={level + 1}
              parentPath={currentPath}
              childrenByParentId={childrenByParentId}
              knownChildren={childrenByParentId.get(subfolder.id)}
            />
          ))
        ) : isExpanded && !isLoadingSubfolders ? (
          <div
            className="py-1 text-xs text-muted-foreground italic"
            style={{ paddingLeft: (level + 1) * 16 + 28 }}
          >
            <Trans>没有子文件夹</Trans>
          </div>
        ) : null}
      </TreeNodeContent>
    </TreeNode>
  );
}

export function NoFoldersFound({
  emailAccountId,
  driveConnectionId,
  onFolderCreated,
}: {
  emailAccountId: string;
  driveConnectionId: string | null;
  onFolderCreated?: () => void;
}) {
  const { t } = useLingui();

  return (
    <CardBasic className="mt-4 p-2">
      <Empty className="border-0 p-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderIcon />
          </EmptyMedia>
          <EmptyTitle>
            <Trans>未找到文件夹</Trans>
          </EmptyTitle>
          <EmptyDescription>
            <Trans>在云端硬盘中创建一个文件夹即可开始。</Trans>
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <CreateFolderDialog
            emailAccountId={emailAccountId}
            driveConnectionId={driveConnectionId}
            onFolderCreated={onFolderCreated}
            triggerLabel={t`创建文件夹`}
          />
        </EmptyContent>
      </Empty>
    </CardBasic>
  );
}

export function CreateFolderDialog({
  emailAccountId,
  driveConnectionId,
  onFolderCreated,
  triggerLabel,
  triggerVariant = "default",
  triggerSize = "default",
  triggerIcon,
  triggerClassName,
}: {
  emailAccountId: string;
  driveConnectionId: string | null;
  onFolderCreated?: () => void;
  triggerLabel: string;
  triggerVariant?: ButtonProps["variant"];
  triggerSize?: ButtonProps["size"];
  triggerIcon?: ButtonProps["Icon"];
  triggerClassName?: string;
}) {
  const { t } = useLingui();
  const { isOpen, onClose, onToggle } = useDialogState();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<CreateDriveFolderBody>({
    resolver: zodResolver(createDriveFolderBody),
    defaultValues: { driveConnectionId: "" },
  });

  const onSubmit: SubmitHandler<CreateDriveFolderBody> = useCallback(
    async (data) => {
      if (!driveConnectionId) {
        toastError({
          title: t`创建文件夹时出错`,
          description: t`No drive connection found`,
        });
        return;
      }

      const result = await createDriveFolderAction(emailAccountId, {
        ...data,
        driveConnectionId,
      });

      if (result?.serverError) {
        toastError({
          title: t`Error creating folder`,
          description: result.serverError,
        });
      } else {
        toastSuccess({ description: t`文件夹已创建！` });
        reset();
        onClose();
        onFolderCreated?.();
      }
    },
    [emailAccountId, reset, onClose, onFolderCreated, driveConnectionId, t],
  );

  return (
    <Dialog open={isOpen} onOpenChange={onToggle}>
      <DialogTrigger asChild>
        <Button
          disabled={!driveConnectionId}
          variant={triggerVariant}
          size={triggerSize}
          Icon={triggerIcon}
          className={triggerClassName}
        >
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>创建文件夹</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>在云端硬盘中创建新文件夹以整理文件。</Trans>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Input
            type="text"
            name="folderName"
            label={t`文件夹名称`}
            placeholder={t`例如：收据`}
            registerProps={register("folderName")}
            error={errors.folderName}
          />
          <Button type="submit" loading={isSubmitting}>
            <Trans>创建文件夹</Trans>
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

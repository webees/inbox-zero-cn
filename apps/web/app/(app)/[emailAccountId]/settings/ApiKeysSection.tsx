"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ApiKeysCreateButtonModal,
  ApiKeysDeactivateButton,
} from "@/app/(app)/[emailAccountId]/settings/ApiKeysCreateForm";
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemActions,
} from "@/components/ui/item";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useApiKeys } from "@/hooks/useApiKeys";
import { LoadingContent } from "@/components/LoadingContent";
import { API_KEY_SCOPE_MESSAGES } from "./api-key-messages";
import { useAccount } from "@/providers/EmailAccountProvider";

export function ApiKeysSection() {
  const { i18n, t } = useLingui();
  const { emailAccountId } = useAccount();
  const { data, isLoading, error, mutate } = useApiKeys();
  const keyCount = data?.apiKeys.length ?? 0;

  return (
    <Item size="sm">
      <ItemContent>
        <ItemTitle>
          <Trans>API 访问</Trans>
        </ItemTitle>
      </ItemContent>
      <ItemActions>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Trans>查看密钥</Trans>
              {keyCount > 0 ? ` (${keyCount})` : ""}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                <Trans>API 密钥</Trans>
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              <Trans>此处创建的密钥仅限当前收件箱账号使用</Trans>
            </p>
            <LoadingContent loading={isLoading} error={error}>
              {keyCount > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <Trans>名称</Trans>
                      </TableHead>
                      <TableHead>
                        <Trans>权限</Trans>
                      </TableHead>
                      <TableHead>
                        <Trans>创建时间</Trans>
                      </TableHead>
                      <TableHead>
                        <Trans>到期时间</Trans>
                      </TableHead>
                      <TableHead>
                        <Trans>上次使用</Trans>
                      </TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data?.apiKeys.map((apiKey) => (
                      <TableRow key={apiKey.id}>
                        <TableCell>{apiKey.name}</TableCell>
                        <TableCell>
                          {apiKey.scopes
                            .map((scope) => {
                              const label =
                                API_KEY_SCOPE_MESSAGES[scope]?.label;
                              return label ? i18n._(label) : scope;
                            })
                            .join(", ")}
                        </TableCell>
                        <TableCell>
                          {new Date(apiKey.createdAt).toLocaleString(
                            i18n.locale,
                          )}
                        </TableCell>
                        <TableCell>
                          {apiKey.expiresAt
                            ? new Date(apiKey.expiresAt).toLocaleString(
                                i18n.locale,
                              )
                            : t`Never`}
                        </TableCell>
                        <TableCell>
                          {apiKey.lastUsedAt
                            ? new Date(apiKey.lastUsedAt).toLocaleString(
                                i18n.locale,
                              )
                            : t`Never`}
                        </TableCell>
                        <TableCell>
                          <ApiKeysDeactivateButton
                            id={apiKey.id}
                            emailAccountId={emailAccountId}
                            mutate={mutate}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">
                  <Trans>No API keys yet.</Trans>
                </p>
              )}
            </LoadingContent>
          </DialogContent>
        </Dialog>
        <ApiKeysCreateButtonModal mutate={mutate} />
      </ItemActions>
    </Item>
  );
}

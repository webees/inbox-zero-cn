"use client";

import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { InviteMemberModal } from "@/components/InviteMemberModal";

export function TeamSection({ organizationId }: { organizationId?: string }) {
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);

  return (
    <>
      <Item size="sm">
        <ItemContent>
          <ItemTitle>
            <Trans>邀请成员</Trans>
          </ItemTitle>
          <ItemDescription>
            <Trans>邀请团队成员加入你的组织，共享你的套餐。</Trans>
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsInviteDialogOpen(true)}
          >
            <Trans>邀请</Trans>
          </Button>
        </ItemActions>
      </Item>

      <InviteMemberModal
        organizationId={organizationId}
        open={isInviteDialogOpen}
        onOpenChange={setIsInviteDialogOpen}
        trigger={null}
      />
    </>
  );
}

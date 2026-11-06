"use client";

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
          <ItemTitle>邀请成员</ItemTitle>
          <ItemDescription>
            通过邀请队友加入你的组织来共享你的套餐。
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsInviteDialogOpen(true)}
          >
            邀请
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

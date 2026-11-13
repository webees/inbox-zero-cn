"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Switch } from "@/components/ui/switch";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemTitle,
} from "@/components/ui/item";

export function AppearanceSection() {
  const { t } = useLingui();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDarkMode = mounted && resolvedTheme === "dark";

  return (
    <Item size="sm">
      <ItemContent>
        <ItemTitle>
          <Trans>深色模式</Trans>
        </ItemTitle>
      </ItemContent>
      <ItemActions>
        <Switch
          aria-label={t`切换深色模式`}
          checked={isDarkMode}
          onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
          disabled={!mounted}
        />
      </ItemActions>
    </Item>
  );
}

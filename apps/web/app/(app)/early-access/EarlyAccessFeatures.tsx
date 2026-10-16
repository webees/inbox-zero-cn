"use client";

import { useCallback, useEffect, useState } from "react";
import { usePostHog, useActiveFeatureFlags } from "posthog-js/react";
import type { EarlyAccessFeature } from "posthog-js";
import { Toggle } from "@/components/Toggle";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function EarlyAccessFeatures() {
  const posthog = usePostHog();
  const activeFlags = useActiveFeatureFlags();
  const [features, setFeatures] = useState<EarlyAccessFeature[]>([]);

  useEffect(() => {
    posthog.getEarlyAccessFeatures((features) => {
      setFeatures(features);
    }, true);
  }, [posthog]);

  const toggleBeta = useCallback(
    (betaKey: string) => {
      const isActive = activeFlags?.includes(betaKey);
      posthog.updateEarlyAccessFeatureEnrollment(betaKey, !isActive);
    },
    [posthog, activeFlags],
  );

  if (!features.length) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>抢先体验功能</CardTitle>
        <CardDescription>你可以在此启用或停用抢先体验功能。</CardDescription>
      </CardHeader>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>功能</TableHead>
            <TableHead className="w-24">已启用</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {features.map((feature) => (
            <TableRow key={feature.name}>
              <TableCell>{feature.name}</TableCell>
              <TableCell>
                <Toggle
                  name={feature.name}
                  enabled={!!activeFlags?.includes(feature.flagKey!)}
                  onChange={() => toggleBeta(feature.flagKey!)}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

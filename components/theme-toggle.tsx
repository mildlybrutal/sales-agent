"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const ORDER = ["light", "dark", "system"] as const;
const LABEL = { light: "Light theme", dark: "Dark theme", system: "System theme" } as const;

/** Cycles light → dark → system. Renders a stable placeholder until mounted (theme is unknown on the server). */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const current = (mounted && ORDER.includes(theme as (typeof ORDER)[number]) ? theme : "system") as (typeof ORDER)[number];
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
  const Icon = current === "light" ? Sun : current === "dark" ? Moon : Monitor;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`${LABEL[current]} (switch to ${next})`} onClick={() => setTheme(next)}>
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{LABEL[current]} · click for {next}</TooltipContent>
    </Tooltip>
  );
}

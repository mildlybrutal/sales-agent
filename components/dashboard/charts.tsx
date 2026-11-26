"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// CSS variables from globals.css, so bars follow the light/dark theme (no blues).
const COLORS: Record<string, string> = {
  HOT: "var(--status-hot)",
  WARM: "var(--status-warm)",
  COLD: "var(--status-muted)",
  POSITIVE: "var(--status-good)",
  NEUTRAL: "var(--status-muted)",
  NEGATIVE: "var(--status-hot)",
  NONE: "var(--status-empty)",
};

export function DistributionChart({ data }: { data: { name: string; key: string; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">No data yet</div>;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
        <CartesianGrid horizontal={false} stroke="var(--border)" />
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" width={88} tick={{ fontSize: 12, fill: "var(--foreground)" }} axisLine={false} tickLine={false} />
        <Tooltip
          cursor={{ fill: "var(--muted)" }}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid var(--border)", background: "var(--popover)", color: "var(--popover-foreground)" }}
          labelStyle={{ color: "var(--popover-foreground)" }}
          itemStyle={{ color: "var(--popover-foreground)" }}
        />
        <Bar dataKey="value" name="Count" radius={[0, 4, 4, 0]} barSize={22} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.key} fill={COLORS[d.key] ?? "var(--status-muted)"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

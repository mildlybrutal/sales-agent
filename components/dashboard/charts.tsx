"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const COLORS: Record<string, string> = {
  HOT: "#dc2626",
  WARM: "#d97706",
  COLD: "#94a3b8",
  POSITIVE: "#059669",
  NEUTRAL: "#94a3b8",
  NEGATIVE: "#dc2626",
  NONE: "#e2e8f0",
};

export function DistributionChart({ data }: { data: { name: string; key: string; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">No data yet</div>;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
        <CartesianGrid horizontal={false} stroke="#f1f5f9" />
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" width={88} tick={{ fontSize: 12, fill: "#334155" }} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: "#f8fafc" }} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
        <Bar dataKey="value" name="Count" radius={[0, 4, 4, 0]} barSize={22}>
          {data.map((d) => (
            <Cell key={d.key} fill={COLORS[d.key] ?? "#64748b"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

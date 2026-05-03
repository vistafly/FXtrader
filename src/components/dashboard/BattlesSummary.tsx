import { Swords } from "lucide-react";

export function BattlesSummary() {
  // Phase 7 will replace this with the real battles lobby preview.
  return (
    <div className="rounded-xl border border-dashed border-border/60 bg-card/30 p-6 text-center">
      <Swords className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
      <h3 className="text-sm font-semibold text-foreground">Battles</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Compete with yourself on a fixed window of history. Coming in Phase 7.
      </p>
    </div>
  );
}

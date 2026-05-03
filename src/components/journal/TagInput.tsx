"use client";

import { Plus, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  /** Tags pulled from the user's other trades — drives the autocomplete. */
  suggestions: string[];
  placeholder?: string;
  className?: string;
}

/**
 * Free-form tag input with autocomplete from existing tags. The user can:
 *   • Type → suggestions narrow to matches; press Enter to add
 *   • Click an existing tag's × to remove it
 *   • Type a new tag and Enter to create it (no menu match required)
 *
 * Per Phase 7 D4: combobox-style. Suggestions normalize common tags
 * (e.g. "breakout" / "Breakout") so filters work; new tags are still free.
 */
export function TagInput({
  value,
  onChange,
  suggestions,
  placeholder = "Add tag…",
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const dedupedSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const s of suggestions) {
      const t = s.trim();
      if (t && !value.includes(t)) set.add(t);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [suggestions, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return dedupedSuggestions;
    return dedupedSuggestions.filter((s) => s.toLowerCase().includes(q));
  }, [dedupedSuggestions, query]);

  const add = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    if (value.includes(t)) return;
    onChange([...value, t]);
    setQuery("");
  };

  const remove = (t: string) => onChange(value.filter((x) => x !== t));

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {value.map((t) => (
        <span
          key={t}
          className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 font-mono text-[11px]"
        >
          {t}
          <button
            type="button"
            onClick={() => remove(t)}
            className="-mr-0.5 rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={`Remove tag ${t}`}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-border/60 px-2 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Plus className="h-2.5 w-2.5" />
            {placeholder}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[240px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              ref={inputRef}
              value={query}
              onValueChange={setQuery}
              placeholder="Type and press Enter…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && query.trim() && filtered.length === 0) {
                  e.preventDefault();
                  add(query);
                }
              }}
            />
            <CommandList>
              {filtered.length === 0 && query.trim() ? (
                <CommandEmpty>
                  Press Enter to add{" "}
                  <span className="font-mono">&quot;{query.trim()}&quot;</span>
                </CommandEmpty>
              ) : filtered.length === 0 ? (
                <CommandEmpty>No tags yet.</CommandEmpty>
              ) : (
                <CommandGroup>
                  {filtered.map((s) => (
                    <CommandItem
                      key={s}
                      value={s}
                      onSelect={() => {
                        add(s);
                        inputRef.current?.focus();
                      }}
                    >
                      {s}
                    </CommandItem>
                  ))}
                  {query.trim() && !filtered.includes(query.trim()) && (
                    <CommandItem
                      value={`__new:${query.trim()}`}
                      onSelect={() => add(query)}
                    >
                      <Plus className="mr-2 h-3 w-3" />
                      Create &quot;{query.trim()}&quot;
                    </CommandItem>
                  )}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

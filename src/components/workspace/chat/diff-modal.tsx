import { useMemo, useState } from "react";
import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { XIcon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { DiffData } from "@/store/agent-store";

interface DiffModalProps {
  diffData: DiffData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type DiffStyle = "unified" | "split";
type LineDiffType = "word" | "char" | "none";
type Overflow = "wrap" | "scroll";

export function DiffModal({ diffData, open, onOpenChange }: DiffModalProps) {
  const [diffStyle, setDiffStyle] = useState<DiffStyle>("split");
  const [lineDiffType, setLineDiffType] = useState<LineDiffType>("word");
  const [disableLineNumbers, setDisableLineNumbers] = useState(true);
  const [overflow, setOverflow] = useState<Overflow>("wrap");

  const filename = diffData.path.split("/").pop() || diffData.path;

  const diffMetadata = useMemo(() => {
    try {
      return parseDiffFromFile(
        { name: filename, contents: diffData.oldText ?? "" },
        { name: filename, contents: diffData.newText ?? "" },
      );
    } catch {
      return null;
    }
  }, [filename, diffData.oldText, diffData.newText]);

  if (!diffMetadata) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[90vw] h-[85vh] flex flex-col gap-0 p-0"
        showCloseButton={false}
      >
        <DialogHeader className="px-4 pt-4 pb-3 border-b border-white/10 shrink-0">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="text-sm font-mono truncate">
              {diffData.path}
            </DialogTitle>
            <div className="flex items-center gap-1 shrink-0">
              <ToggleGroup
                value={diffStyle}
                onChange={(v) => setDiffStyle(v as DiffStyle)}
                options={[
                  { value: "unified", label: "Unified" },
                  { value: "split", label: "Split" },
                ]}
              />
              <div className="w-px h-4 bg-white/10 mx-1" />
              <ToggleGroup
                value={lineDiffType}
                onChange={(v) => setLineDiffType(v as LineDiffType)}
                options={[
                  { value: "word", label: "Word" },
                  { value: "char", label: "Char" },
                  { value: "none", label: "None" },
                ]}
              />
              <div className="w-px h-4 bg-white/10 mx-1" />
              <ToggleButton
                active={!disableLineNumbers}
                onClick={() => setDisableLineNumbers((v) => !v)}
                label="Ln"
              />
              <div className="w-px h-4 bg-white/10 mx-1" />
              <ToggleGroup
                value={overflow}
                onChange={(v) => setOverflow(v as Overflow)}
                options={[
                  { value: "wrap", label: "Wrap" },
                  { value: "scroll", label: "Scroll" },
                ]}
              />
              <div className="w-px h-4 bg-white/10 mx-1" />
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="flex items-center justify-center p-0.5 rounded opacity-70 hover:opacity-100 transition-opacity"
              >
                <XIcon className="size-4" />
              </button>
            </div>
          </div>
        </DialogHeader>
        <div className="flex-1 overflow-auto min-h-0 text-xs [--diffs-font-size:12px] [--diffs-line-height:18px]">
          <FileDiff
            fileDiff={diffMetadata}
            options={{
              diffStyle,
              lineDiffType,
              disableLineNumbers,
              overflow,
              diffIndicators: "none",
              theme: "pierre-dark",
              disableFileHeader: true,
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ToggleGroup({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center rounded-md border border-white/10 overflow-hidden">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "px-2 py-0.5 text-[10px] font-medium transition-colors",
            value === option.value
              ? "bg-white/10 text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-white/5",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-2 py-0.5 text-[10px] font-medium rounded-md border border-white/10 transition-colors",
        active
          ? "bg-white/10 text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-white/5",
      )}
    >
      {label}
    </button>
  );
}

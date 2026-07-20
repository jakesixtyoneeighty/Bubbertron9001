import { ExternalLink, Globe } from "lucide-react";
import type { MessageSource } from "@/stores/chat";

export function SourceList({ sources }: { sources: MessageSource[] }) {
  if (sources.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {sources.map((source) => {
        let domain = source.url;
        try {
          domain = new URL(source.url).hostname.replace(/^www\./, "");
        } catch {
          // Keep the original URL when a provider returns an unusual source.
        }

        return (
          <a
            key={source.id || source.url}
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            title={source.title || source.url}
          >
            <Globe className="h-3 w-3 shrink-0" />
            <span className="truncate">{source.title || domain}</span>
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        );
      })}
    </div>
  );
}

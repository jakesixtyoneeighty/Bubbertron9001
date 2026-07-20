/**
 * EmptyState - Mission-control empty state for the chat
 */

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { BRAND } from "@/config/brand";
import { LogoMark } from "@/components/icons/Logo";
import { Sparkles, Code, Wand2, Search, Bot, ArrowDown } from "lucide-react";

const CAPABILITIES = [
  {
    icon: <Code className="w-4 h-4" />,
    text: "Write Luau scripts",
    color: "text-lime",
  },
  {
    icon: <Wand2 className="w-4 h-4" />,
    text: "Create & modify instances",
    color: "text-leaf",
  },
  {
    icon: <Search className="w-4 h-4" />,
    text: "Find free models",
    color: "text-primary",
  },
  {
    icon: <Bot className="w-4 h-4" />,
    text: "Debug & optimize",
    color: "text-brick",
  },
];

const TYPING_EXAMPLES = [
  "Create an NPC that follows players...",
  "Add a shop GUI with items...",
  "Make a gun that shoots projectiles...",
  "Design a currency system...",
  "Build a racing checkpoint system...",
];

interface EmptyStateProps {
  className?: string;
}

export function EmptyState({ className }: EmptyStateProps) {
  const [typingText, setTypingText] = useState("");
  const [exampleIndex, setExampleIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const currentExample = TYPING_EXAMPLES[exampleIndex];

    if (isDeleting) {
      if (charIndex > 0) {
        const timer = setTimeout(() => {
          setTypingText(currentExample.slice(0, charIndex - 1));
          setCharIndex(charIndex - 1);
        }, 30);
        return () => clearTimeout(timer);
      } else {
        setIsDeleting(false);
        setExampleIndex((exampleIndex + 1) % TYPING_EXAMPLES.length);
      }
    } else {
      if (charIndex < currentExample.length) {
        const timer = setTimeout(() => {
          setTypingText(currentExample.slice(0, charIndex + 1));
          setCharIndex(charIndex + 1);
        }, 50);
        return () => clearTimeout(timer);
      } else {
        const timer = setTimeout(() => {
          setIsDeleting(true);
        }, 2000);
        return () => clearTimeout(timer);
      }
    }
  }, [charIndex, exampleIndex, isDeleting]);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center py-12",
        className
      )}
    >
      <div className="relative mb-8 animate-float">
        <div className="absolute inset-0 animate-ping opacity-20">
          <LogoMark className="w-20 h-20" />
        </div>
        <div className="absolute -inset-4 rounded-3xl bg-primary/10 blur-xl animate-glow" />
        <LogoMark className="w-20 h-20 relative glow-lime rounded-2xl" />
      </div>

      <h1 className="text-3xl font-heading mb-2 text-gradient-hero">
        What would you like to build?
      </h1>
      <p className="text-muted-foreground mb-8 max-w-md">
        <span className="font-logo text-cream">{BRAND.name}</span> can help you create,
        modify, and debug your Roblox game — like having a co-builder on standby.
      </p>

      <div className="flex flex-wrap justify-center gap-3 mb-8">
        {CAPABILITIES.map((cap, idx) => (
          <div
            key={idx}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-full glass text-sm hover-lift",
              "animate-pop-in opacity-0",
              cap.color
            )}
            style={{ animationDelay: `${idx * 80}ms`, animationFillMode: "forwards" }}
          >
            {cap.icon}
            <span className="text-foreground">{cap.text}</span>
          </div>
        ))}
      </div>

      <div className="relative max-w-sm w-full">
        <div className="absolute -top-6 left-1/2 -translate-x-1/2">
          <Sparkles className="w-4 h-4 text-primary animate-pulse" />
        </div>
        <div className="glass rounded-xl px-4 py-3 text-left border border-primary/20">
          <p className="text-sm text-muted-foreground mb-1">Try asking:</p>
          <p className="text-base min-h-[1.5rem] text-cream">
            {typingText}
            <span className="animate-pulse text-primary">|</span>
          </p>
        </div>
      </div>

      <div className="mt-8 flex flex-col items-center gap-2 text-muted-foreground animate-bounce">
        <span className="text-xs tracking-wide uppercase">Type below to launch</span>
        <ArrowDown className="w-4 h-4 text-primary" />
      </div>
    </div>
  );
}

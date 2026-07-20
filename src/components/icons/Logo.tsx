import { cn } from "@/lib/utils";
import { BRAND } from "@/config/brand";

interface LogoProps {
  className?: string;
}

const BADGE_SRC = "/brand/bubbertron9001-badge.png";

// The supplied bubbertron9001 badge is used throughout the product. Decorative
// instances stay hidden because the surrounding UI provides the product name.
export function LogoMark({ className }: LogoProps) {
  return (
    <img
      data-component="logo-mark"
      src={BADGE_SRC}
      alt=""
      className={cn(
        "aspect-square w-10 h-10 rounded-full object-cover",
        className
      )}
      aria-hidden="true"
    />
  );
}

export function LogoSplash({ className }: LogoProps) {
  return (
    <img
      data-component="logo-splash"
      src={BADGE_SRC}
      alt=""
      className={cn(
        "aspect-square w-24 h-24 rounded-full object-cover",
        className
      )}
      aria-hidden="true"
    />
  );
}

export function Logo({ className }: LogoProps) {
  return (
    <div
      data-component="logo"
      className={cn("flex items-center gap-3", className)}
    >
      <LogoMark className="w-9 h-9" />
      <span className="text-2xl font-logo text-foreground tracking-tight">
        {BRAND.name}
      </span>
    </div>
  );
}

export default Logo;

import { cn } from "@/lib/utils";
import { BRAND } from "@/config/brand";

interface LogoProps {
  className?: string;
}

function B9Artwork() {
  return (
    <>
      <rect
        width="64"
        height="64"
        rx="16"
        fill="currentColor"
        className="text-primary"
      />
      <path
        d="M16 18h18c8 0 13 4 13 11 0 4-2 7-5 9 4 2 6 5 6 9 0 8-5 12-14 12H16V18Zm11 9v8h6c3 0 4-1 4-4s-1-4-4-4h-6Zm0 17v7h7c3 0 4-1 4-4 0-2-1-3-4-3h-7Z"
        fill="currentColor"
        className="text-primary-foreground"
      />
      <circle
        cx="49"
        cy="17"
        r="6"
        fill="currentColor"
        className="text-primary-foreground"
      />
      <path
        d="M49 22c-5 0-9 4-9 9h7c0-2 1-3 3-3s3 2 3 5c0 5-3 8-8 10l3 6c8-3 13-9 13-17 0-6-4-10-12-10Z"
        fill="currentColor"
        className="text-primary-foreground"
      />
    </>
  );
}

// Bubberton9001 B9 logo mark. Decorative instances are hidden from assistive
// technology because the surrounding UI supplies the product name.
export function LogoMark({ className }: LogoProps) {
  return (
    <svg
      data-component="logo-mark"
      className={cn("w-10 h-10", className)}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <B9Artwork />
    </svg>
  );
}

export function LogoSplash({ className }: LogoProps) {
  return (
    <svg
      data-component="logo-splash"
      className={cn("w-24 h-24", className)}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <B9Artwork />
    </svg>
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

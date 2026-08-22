import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 touch-manipulation items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,opacity,transform] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 min-h-11 px-4 py-2 has-[>svg]:px-3 md:min-h-9",
        xs: "h-6 min-h-11 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 md:min-h-6 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 min-h-11 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5 md:min-h-8",
        lg: "h-10 min-h-11 rounded-md px-6 has-[>svg]:px-4 md:min-h-10",
        icon: "size-9 min-h-11 min-w-11 md:min-h-9 md:min-w-9",
        "icon-xs": "size-6 min-h-11 min-w-11 rounded-md md:min-h-6 md:min-w-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 min-h-11 min-w-11 md:min-h-8 md:min-w-8",
        "icon-lg": "size-10 min-h-11 min-w-11 md:min-h-10 md:min-w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  type,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"
  const resolvedProps = asChild
    ? props
    : ({ type: type || "button", ...props } as React.ComponentProps<"button">)

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...resolvedProps}
    />
  )
}

export { Button, buttonVariants }

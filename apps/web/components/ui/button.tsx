import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/*
 * A struck plate, not a stock button.
 *
 * The world's controls are pressed metal: an ink rule along the foot is the
 * burr the punch throws up, and pressing deepens the recess rather than
 * lifting the element off the page. Radius stays at the world's 2px and the
 * label is set in Rubric, so a control reads as struck even with no content.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[2px] font-display text-xs font-semibold uppercase tracking-[0.07em] transition-all duration-[140ms] ease-[cubic-bezier(0.16,1,0.3,1)] disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ink)] aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          'bg-[var(--ink)] text-[var(--sheet)] border border-[var(--ink)] hover:bg-[var(--touchstone)] active:translate-y-px',
        destructive:
          'bg-[var(--assay)] text-white border border-[var(--assay)] hover:bg-[var(--assay-ink)] active:translate-y-px',
        outline:
          'border border-[var(--rule)] border-b-2 border-b-[var(--ink)] bg-[var(--bench)] text-[var(--ink)] shadow-[var(--strike)] hover:bg-[var(--sheet)] active:shadow-[var(--strike-deep)] active:translate-y-px',
        secondary:
          'border border-[var(--rule)] bg-[var(--bench)] text-[var(--ink)] hover:bg-[var(--sheet)]',
        ghost: 'text-[var(--ink)] hover:bg-[var(--bench)]',
        link: 'text-[var(--ink)] underline-offset-4 hover:underline normal-case tracking-normal text-sm font-medium',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-11 px-6 has-[>svg]:px-5',
        icon: 'size-9',
        'icon-sm': 'size-8',
        'icon-lg': 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/*
 * Polaris's button: a pill that lifts 1px on hover.
 *
 * `default` is the brand blue used for ordinary actions. The lime action colour
 * is deliberately NOT the default -- Polaris spends it once per view on the one
 * thing it wants pressed, so it is opt-in via variant="lime".
 */
const buttonVariants = cva(
  "btn disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'btn--brand',
        lime: 'btn--lime',
        destructive: 'bg-[var(--refused)] text-white shadow-[var(--shadow-sm)] hover:bg-[#b42318]',
        outline: 'btn--outline',
        secondary: 'bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--line-2)]',
        ghost: 'text-[var(--ink-2)] hover:bg-[var(--surface)] hover:text-[var(--ink)]',
        link: 'px-0! py-0! text-[var(--brand)] underline-offset-4 hover:underline hover:translate-y-0',
      },
      size: {
        default: '',
        sm: 'px-4! py-2! text-[13px]!',
        lg: 'px-7! py-3.5! text-[15px]!',
        icon: 'size-10 px-0! py-0!',
        'icon-sm': 'size-9 px-0! py-0!',
        'icon-lg': 'size-11 px-0! py-0!',
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

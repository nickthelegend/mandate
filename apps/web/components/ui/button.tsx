import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/*
 * A key on the machine, not a stock button.
 *
 * Square, because nothing in this world was moulded, and carrying a hard offset
 * shadow that is the key's own side rather than a glow. Pressing moves the cap
 * into that shadow and closes it -- the travel is the feedback, so there is no
 * colour change to announce it.
 */
const buttonVariants = cva(
  "key inline-flex shrink-0 items-center justify-center whitespace-nowrap disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ribbon)]",
  {
    variants: {
      variant: {
        default: '',
        destructive:
          'border-[var(--ribbon-red)] text-[var(--ribbon-red-ink)] shadow-[2px_2px_0_0_var(--ribbon-red)] active:shadow-none',
        outline: 'key--quiet',
        secondary: 'key--quiet',
        ghost:
          'border-transparent bg-transparent shadow-none active:translate-x-0 active:translate-y-0 hover:bg-[var(--stock-edge)]',
        link: 'border-transparent bg-transparent shadow-none normal-case tracking-normal text-sm font-normal underline-offset-4 hover:underline active:translate-x-0 active:translate-y-0',
      },
      size: {
        default: 'px-4 py-2.5',
        sm: 'px-3 py-2 text-[0.625rem]',
        lg: 'px-6 py-3.5 text-xs',
        icon: 'size-9 px-0 py-0',
        'icon-sm': 'size-8 px-0 py-0',
        'icon-lg': 'size-10 px-0 py-0',
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

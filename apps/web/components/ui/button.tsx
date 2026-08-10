import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/*
 * The Convix pill.
 *
 * `default` is the dark pill used for primary actions; the orange is reserved
 * for the one action per view that should be pressed, and is opt-in via
 * variant="brand".
 */
const buttonVariants = cva(
  "btn disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'btn--dark',
        brand: 'btn--plain',
        destructive: 'bg-[var(--refused)] text-white px-5 py-2 hover:bg-[#a32d22]',
        outline: 'btn--outline',
        secondary: 'btn--outline',
        ghost: 'btn--ghost',
        link: 'px-0! py-0! text-[var(--brand)] underline-offset-4 hover:underline',
      },
      size: {
        default: '',
        sm: 'px-4! py-1.5! text-[13px]!',
        lg: 'px-6! py-3! text-[15px]!',
        icon: 'size-10 px-0! py-0!',
        'icon-sm': 'size-9 px-0! py-0!',
        'icon-lg': 'size-11 px-0! py-0!',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
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

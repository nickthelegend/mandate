import * as React from 'react'

import { cn } from '@/lib/utils'

/*
 * A ruled blank in a register: a recessed field on the bench with a rule under
 * it that darkens to ink on focus. No box outline and no ring -- the line the
 * hand writes on is the affordance, and everything typed here is a hash.
 */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'field h-10 w-full min-w-0 px-3 py-1 text-base placeholder:text-[var(--ribbon-soft)] md:text-sm',
        'file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Input }

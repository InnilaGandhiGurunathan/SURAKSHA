import { forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all duration-200 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.985]',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:brightness-110 shadow-sm',
        accent:
          'bg-gradient-to-r from-teal-600 to-teal-500 text-white hover:from-teal-500 hover:to-teal-400 shadow-sm',
        secondary: 'bg-secondary text-secondary-foreground hover:brightness-95',
        outline: 'border border-border bg-transparent hover:bg-muted/70',
        ghost: 'hover:bg-muted/70',
        destructive: 'bg-destructive text-destructive-foreground hover:brightness-110',
        sos: 'bg-sos text-sos-foreground hover:brightness-110 sos-glow',
        link: 'text-accent underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-9 px-3 text-xs [&_svg]:size-3.5',
        default: 'h-11 px-4 [&_svg]:size-4',
        lg: 'h-12 px-5 text-base [&_svg]:size-5',
        xl: 'h-14 px-6 text-base [&_svg]:size-5',
        icon: 'size-11 [&_svg]:size-5',
        'icon-sm': 'size-8 [&_svg]:size-3.5',
      },
      full: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'default', size: 'default', full: false },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  loadingText?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, full, asChild = false, loading = false, loadingText, children, disabled, ...props },
    ref,
  ) => {
    const Component = asChild ? Slot : 'button';

    return (
      <Component
        ref={ref}
        className={cn(buttonVariants({ variant, size, full }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" aria-hidden />
            {loadingText ?? children}
          </>
        ) : (
          children
        )}
      </Component>
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };

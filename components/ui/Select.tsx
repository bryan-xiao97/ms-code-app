import { forwardRef, type SelectHTMLAttributes } from "react";
import { clsx } from "clsx";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...rest }, ref) => (
    <select
      ref={ref}
      {...rest}
      className={clsx(
        "block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm",
        "focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500",
        className
      )}
    />
  )
);
Select.displayName = "Select";

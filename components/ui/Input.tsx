import { forwardRef, type InputHTMLAttributes } from "react";
import { clsx } from "clsx";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...rest }, ref) => (
    <input
      ref={ref}
      {...rest}
      className={clsx(
        "block w-full rounded-md border border-slate-300 px-3 py-2 text-sm",
        "focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500",
        className
      )}
    />
  )
);
Input.displayName = "Input";

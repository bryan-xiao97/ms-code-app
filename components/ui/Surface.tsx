import { type HTMLAttributes } from "react";
import { clsx } from "clsx";

export function Surface({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={clsx("rounded-lg border border-slate-200 bg-white shadow-sm", className)}
    />
  );
}

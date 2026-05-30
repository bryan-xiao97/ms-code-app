type Props = {
  name: string;
  targetCompany: string;
  sector: string | null;
};

export function DealHeader({ name, targetCompany, sector }: Props) {
  return (
    <div className="border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-6 py-5">
        <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">Deal</p>
        <h1 className="text-2xl font-semibold text-slate-900">{name}</h1>
        <p className="text-sm text-slate-600 mt-1">
          {targetCompany}
          {sector ? ` · ${sector}` : ""}
        </p>
      </div>
    </div>
  );
}

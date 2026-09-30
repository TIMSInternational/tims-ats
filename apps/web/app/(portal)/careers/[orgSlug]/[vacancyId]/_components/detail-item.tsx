export function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[#F6F6F6] p-3">
      <p className="text-[11px] text-[#8B8B8B]">{label}</p>
      <p className="mt-0.5 text-[13px] font-medium text-[#333]">{value}</p>
    </div>
  );
}

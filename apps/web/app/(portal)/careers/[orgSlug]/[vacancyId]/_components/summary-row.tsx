export function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-[12px] text-[#585858]">{label}:</span>
      <span className="max-w-[60%] truncate text-right text-[12px] font-medium text-[#333]">{value}</span>
    </div>
  );
}

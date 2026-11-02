// Small coloured dot used as the KPI-card icon across the role dashboards.

export const CARD_DOT_COLORS = ['bg-blue-400', 'bg-green-400', 'bg-purple-400', 'bg-teal-400', 'bg-indigo-400'];

export const CARD_BG_COLORS = ['bg-blue-50', 'bg-green-50', 'bg-purple-50', 'bg-teal-50', 'bg-indigo-50'];

export function Dot({ index }: { index: number }) {
  return (
    <span className={`w-2.5 h-2.5 rounded-full inline-block ${CARD_DOT_COLORS[index % CARD_DOT_COLORS.length]}`} />
  );
}

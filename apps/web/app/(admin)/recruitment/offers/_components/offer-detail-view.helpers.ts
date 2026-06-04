export const OFFER_STATUS_LABEL: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-gray-500/20', text: 'text-gray-300', label: 'Borrador' },
  pending_approval: { bg: 'bg-amber-500/20', text: 'text-amber-300', label: 'Pendiente' },
  approved: { bg: 'bg-blue-500/20', text: 'text-blue-300', label: 'Aprobada' },
  sent: { bg: 'bg-violet-500/20', text: 'text-violet-300', label: 'Enviada' },
  accepted: { bg: 'bg-green-500/20', text: 'text-green-300', label: 'Oferta Aceptada' },
  declined: { bg: 'bg-red-500/20', text: 'text-red-300', label: 'Rechazada' },
};

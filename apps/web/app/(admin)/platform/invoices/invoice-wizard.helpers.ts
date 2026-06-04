import { formatCurrency } from '../../../../lib/format-utils';

export function fmtCurrency(value: number, currency = 'USD') { return formatCurrency(value, currency, 2); }

export interface LineItem { description: string; quantity: number; unitPrice: number; }

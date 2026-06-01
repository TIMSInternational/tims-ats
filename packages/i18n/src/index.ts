import en from "../messages/en.json";
import es from "../messages/es.json";

export const messages = { en, es } as const;

export type Locale = keyof typeof messages;
export type Messages = (typeof messages)[Locale];

export { en, es };

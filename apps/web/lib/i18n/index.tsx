'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import es from './es.json';
import en from './en.json';

type Locale = 'ES' | 'EN';
type Translations = typeof es;

const translations: Record<Locale, Translations> = { ES: es, EN: en };

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translations;
}

const I18nContext = createContext<I18nContextType>({
  locale: 'ES',
  setLocale: () => {},
  t: es,
});

const LOCALE_KEY = 'tims-locale';

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('ES');

  useEffect(() => {
    const saved = localStorage.getItem(LOCALE_KEY) as Locale | null;
    if (saved && (saved === 'ES' || saved === 'EN')) {
      setLocaleState(saved);
    }
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem(LOCALE_KEY, l);
    document.documentElement.lang = l === 'ES' ? 'es' : 'en';
  }, []);

  return (
    <I18nContext.Provider value={{ locale, setLocale, t: translations[locale] }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

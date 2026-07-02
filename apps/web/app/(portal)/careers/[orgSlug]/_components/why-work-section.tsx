'use client';

import { useI18n } from '../../../../../lib/i18n';

const values = [
  {
    title: 'Evaluacion Cientifica',
    description: 'Nuestras evaluaciones se basan en metodologias cientificas que identifican el mejor talento de forma objetiva.',
    bgColor: 'bg-[#F0EEFB]',
    iconColor: 'text-[#1F114C]',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
        <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
      </svg>
    ),
  },
  {
    title: 'Proceso Transparente',
    description: 'Mantente informado en cada etapa del proceso con actualizaciones en tiempo real y comunicacion clara.',
    bgColor: 'bg-[#E8F8F5]',
    iconColor: 'text-[#2A9D8F]',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
        <path fillRule="evenodd" d="M14.615 1.595a.75.75 0 01.359.852L12.982 9.75h7.268a.75.75 0 01.548 1.262l-10.5 11.25a.75.75 0 01-1.272-.71l1.992-7.302H3.75a.75.75 0 01-.548-1.262l10.5-11.25a.75.75 0 01.913-.143z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    title: 'Entrevistas Digitales',
    description: 'Participa en entrevistas desde cualquier lugar con nuestra plataforma de video integrada y flexible.',
    bgColor: 'bg-[#FEE8E7]',
    iconColor: 'text-[#DD0C15]',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
        <path d="M4.5 4.5a3 3 0 00-3 3v9a3 3 0 003 3h8.25a3 3 0 003-3v-9a3 3 0 00-3-3H4.5zM19.94 18.75l-2.69-2.69V7.94l2.69-2.69c.944-.945 2.56-.276 2.56 1.06v11.38c0 1.336-1.616 2.005-2.56 1.06z" />
      </svg>
    ),
  },
  {
    title: 'Desarrollo Profesional',
    description: 'Accede a oportunidades de crecimiento y desarrollo continuo dentro de las mejores empresas.',
    bgColor: 'bg-[#FFF7E6]',
    iconColor: 'text-[#F59E0B]',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
        <path d="M11.7 2.805a.75.75 0 01.6 0A60.65 60.65 0 0122.83 8.72a.75.75 0 01-.231 1.337 49.949 49.949 0 00-9.902 3.912l-.003.002-.34.18a.75.75 0 01-.707 0A50.009 50.009 0 007.5 12.174v-.224c0-.131.067-.248.172-.311a54.614 54.614 0 014.653-2.52.75.75 0 00-.65-1.352 56.129 56.129 0 00-4.78 2.589 1.858 1.858 0 00-.859 1.228 49.803 49.803 0 00-4.634-1.527.75.75 0 01-.231-1.337A60.653 60.653 0 0111.7 2.805z" />
        <path d="M13.06 15.473a48.45 48.45 0 017.666-3.282c.134 1.414.22 2.843.255 4.285a.75.75 0 01-.46.71 47.878 47.878 0 00-8.105 4.342.75.75 0 01-.832 0 47.877 47.877 0 00-8.104-4.342.75.75 0 01-.461-.71c.035-1.442.121-2.87.255-4.286A48.4 48.4 0 016 13.18v1.27a1.5 1.5 0 00-.14 2.508c-.09.38-.222.753-.397 1.11.452.213.901.434 1.346.661a6.729 6.729 0 00.551-1.608 1.5 1.5 0 00.14-2.67v-.645a48.549 48.549 0 013.44 1.668 2.25 2.25 0 002.12 0z" />
        <path d="M4.462 19.462c.42-.419.753-.89 1-1.394.453.213.902.434 1.347.661a6.743 6.743 0 01-1.286 1.794.75.75 0 11-1.06-1.06z" />
      </svg>
    ),
  },
];

export function WhyWorkSection() {
  const { t } = useI18n();
  return (
    <section className="bg-[#F6F6F6] px-8 py-10">
      <div className="mx-auto max-w-5xl text-center">
        <h2 className="text-[20px] font-bold text-[#1F114C]">{t.portal.whyWorkTitle}</h2>
        <p className="mx-auto mt-2 max-w-lg text-[13px] text-[#585858]">
          {t.portal.whyWorkSubtitle}
        </p>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {values.map((v) => (
            <div key={v.title} className="rounded-xl bg-white p-5 text-center shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
              <div className={`mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl ${v.bgColor} ${v.iconColor}`}>
                {v.icon}
              </div>
              <h3 className="text-[13px] font-semibold text-[#1F114C]">{v.title}</h3>
              <p className="mt-1.5 text-[11px] leading-relaxed text-[#585858]">{v.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

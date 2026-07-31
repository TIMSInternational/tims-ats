'use client';

import { useI18n } from '../../../../../../lib/i18n';

const inputCls =
  'w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C] disabled:opacity-50 disabled:bg-[#FAFAFA]';
const labelCls = 'block text-xs font-medium text-[#585858] mb-1';

interface ApplyModalStep1Props {
  firstName: string;
  setFirstName: (v: string) => void;
  lastName: string;
  setLastName: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  phone: string;
  setPhone: (v: string) => void;
  location: string;
  setLocation: (v: string) => void;
}

export function ApplyModalStep1({
  firstName,
  setFirstName,
  lastName,
  setLastName,
  email,
  setEmail,
  phone,
  setPhone,
  location,
  setLocation,
}: ApplyModalStep1Props) {
  const { t } = useI18n();
  const p = t.portal;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>{p.firstNameLabel}</label>
          <input
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            maxLength={100}
            className={inputCls}
            placeholder="Maria"
            autoFocus
          />
        </div>
        <div>
          <label className={labelCls}>{p.lastNameLabel}</label>
          <input
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            maxLength={100}
            className={inputCls}
            placeholder={p.lastNamePlaceholder}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>{p.emailLabel}</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
            className={inputCls}
            placeholder="maria.lopez@gmail.com"
          />
        </div>
        <div>
          <label className={labelCls}>Telefono</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={30}
            className={inputCls}
            placeholder="+57 310 123 4567"
          />
        </div>
      </div>
      <div>
        <label className={labelCls}>Ubicacion</label>
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          maxLength={200}
          className={inputCls}
          placeholder={p.cityCountryPlaceholder}
        />
      </div>
    </div>
  );
}

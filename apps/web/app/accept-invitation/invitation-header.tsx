export function InvitationHeader({ language, toggle }: { language: string; toggle: () => void }) {
  return (
    <div className="mb-8 flex items-center justify-between">
      <a href="/login" className="text-xl font-bold tracking-tight">
        TIMS <span className="font-normal">ATS</span>
      </a>
      <button type="button" className="text-sm underline" onClick={toggle}>
        {language}
      </button>
    </div>
  );
}

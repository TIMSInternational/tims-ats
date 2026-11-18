export const usePathname = (): string => '/';
export const useRouter = () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined });
export const useSearchParams = () => new URLSearchParams();

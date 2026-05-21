import en from './locales/en.json'

export type LocaleKey = keyof typeof en

// Register additional locales here as they become available, e.g.:
// import es from './locales/es.json'
// locales['es'] = es
const locales: Record<string, Partial<Record<LocaleKey, string>>> = { en }

export function addLocale(lang: string, strings: Partial<Record<LocaleKey, string>>): void {
	locales[lang] = strings
}

function getLang(): string {
	try { return localStorage.getItem('language') ?? 'en' }
	catch { return 'en' }
}

export function t(key: LocaleKey): string {
	const strings = locales[getLang()] ?? locales['en']
	return strings?.[key] ?? en[key] ?? key
}

// t with {placeholder} interpolation
export function tf(key: LocaleKey, vars: Record<string, string | number>): string {
	let s = t(key)
	for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v))
	return s
}

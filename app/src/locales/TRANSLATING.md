# Translating SecuChat

Thank you for helping translate SecuChat! This guide explains how to add a new language.

## How it works

SecuChat uses [react-i18next](https://react.i18next.com/) for internationalization. All translations are stored as JSON files in `app/src/locales/`.

## Adding a new language

### 1. Copy the English translation file

```bash
cp app/src/locales/en.json app/src/locales/XX.json
```

Replace `XX` with the [ISO 639-1 language code](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes) (e.g., `fr` for French, `es` for Spanish, `ja` for Japanese).

### 2. Translate the strings

Open your new `XX.json` file and translate all values (right side of the colon). **Do not change the keys** (left side).

Example — translating to French:

```json
{
  "common": {
    "back": "Retour",
    "next": "Suivant",
    "cancel": "Annuler"
  }
}
```

#### Important rules

- **Keep `{{variables}}`** — These are placeholders that get replaced at runtime. Example: `"Hello {{name}}"` → `"Bonjour {{name}}"`
- **Keep the JSON structure** — Don't add, remove, or rename keys
- **Translate all strings** — Missing translations will fall back to English

### 3. Register the language

Open `app/src/i18n.ts` and add your language:

```typescript
import de from '@/locales/de.json';
import en from '@/locales/en.json';
import fr from '@/locales/fr.json';  // ← Add import

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      de: { translation: de },
      en: { translation: en },
      fr: { translation: fr },  // ← Add resource
    },
    // ...
  });
```

### 4. Add the language to the selector

Open `app/src/components/custom/Settings.tsx` and find the language `<Select>` component. Add a new `<SelectItem>`:

```tsx
<SelectContent>
  <SelectItem value="de">Deutsch</SelectItem>
  <SelectItem value="en">English</SelectItem>
  <SelectItem value="fr">Français</SelectItem>  {/* ← Add option */}
</SelectContent>
```

### 5. Test

```bash
cd app
npm run dev
```

Open the app → Settings → Language → select your language.

## Tips

- Use `en.json` as the reference — it's always up to date
- Run `npm run build` to check for JSON syntax errors
- The app auto-detects the browser language on first visit. If your language is registered, it will be selected automatically.

## Current languages

| Code | Language | Status |
|------|----------|--------|
| `de` | Deutsch  | ✓ Complete |
| `en` | English  | ✓ Complete |

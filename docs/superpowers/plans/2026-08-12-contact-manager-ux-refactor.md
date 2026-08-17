# Contact Manager UX Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete-Button in "Kontakte verwalten" auf Android wieder klickbar machen und technische Felder (Fingerprint, i2pAdresse) aus der Liste entfernen — durch Aufteilung in zwei Views (Liste + Detail-Modal).

**Architecture:** Zwei-View-Pattern: `ContactManager.tsx` rendert eine kompakte, klickbare Liste (nur Avatar + Name + Badges). Klick öffnet ein neues `ContactDetailModal.tsx`, das alle technischen Felder read-only mit Copy-Buttons zeigt und den roten Lösch-Button enthält. Keine Änderung an Storage, Domain-Logik oder `Contact`-Type.

**Tech Stack:** React 19, TypeScript, shadcn/ui (Dialog, AlertDialog, Button, Badge, Avatar), Tailwind v4, lucide-react (Icons), date-fns@^4.1.0, react-i18next.

## Global Constraints

- **Plattform-Coverage:** Jede Änderung muss auf **Android** (Capacitor-WebView) UND **Electron** (Desktop) visuell und funktional identisch funktionieren.
- **Build-Reihenfolge:** `tsc --noEmit` → `npm run lint` → `npm run build` → Android-`assembleDebug` → Electron-Build. Jeder Schritt muss grün sein, bevor der nächste läuft.
- **Locales:** Jeder UI-String muss in **beide** Locale-Dateien (`app/src/locales/de.json` UND `app/src/locales/en.json`) eingefügt werden. Englische Keys = identische Keys wie deutsch, nur übersetzte Werte.
- **Keine Storage-Änderungen:** `app/src/services/storage/**` darf nicht angefasst werden. `Contact`-Type (`app/src/types/index.ts:18-27`) bleibt unverändert. `removeContact` in `AppContext.tsx:893-902` bleibt unverändert.
- **Code-Style:** Matche das Pattern von `ContactVerificationDialog.tsx:87-92` für Clipboard-Operationen (sync `writeText` + `setTimeout`-Reset, kein Promise-Chain).
- **Commit-Style:** Conventional Commits, Deutsch für Spec/Plan, Englisch für Code-Commits (`feat:`, `chore:`, `fix:`, `docs:`).
- **Bundle-Bloat:** Keine neuen Runtime-Deps. `date-fns@^4.1.0` ist bereits in `app/package.json`.

---

## File Structure

| Datei | Verantwortlichkeit |
|-------|--------------------|
| `app/src/components/custom/ContactManager.tsx` (modify) | Liste rendern, Klick-State halten, Filterlogik, Detail-Modal einbinden |
| `app/src/components/custom/ContactDetailModal.tsx` (create) | Read-only Detail-View mit Copy-Buttons und Delete-Bestätigung |
| `app/src/locales/de.json` (modify) | Neue Keys unter `contacts.detail.*` |
| `app/src/locales/en.json` (modify) | Englische Pendants |

Keine weiteren Dateien werden angefasst.

---

## Task 1: Locale-Erweiterungen (de + en)

**Files:**
- Modify: `app/src/locales/de.json` — Block `contacts` um `detail` erweitern
- Modify: `app/src/locales/en.json` — Block `contacts` um `detail` erweitern

**Interfaces:**
- Consumes: nichts (Bottom-Up-Task, keine Abhängigkeiten)
- Produces: Translation-Keys `contacts.detail.*` für Components

- [ ] **Step 1: Aktuellen Stand beider Dateien prüfen**

Lies die `contacts`-Blöcke beider Dateien, um sicherzustellen, dass der existierende Inhalt erhalten bleibt:

```bash
sed -n '367,375p' /home/g/dev/SecuChat/app/src/locales/de.json
sed -n '367,375p' /home/g/dev/SecuChat/app/src/locales/en.json
```

Erwartet: Bestehende Keys `title`, `description`, `searchContacts`, `noContacts`, `deleteContact`, `deleteContactDesc` in beiden Dateien.

- [ ] **Step 2: Deutsche Locale-Datei erweitern**

Editiere `app/src/locales/de.json` so, dass der `contacts`-Block wie folgt aussieht (achten: Reihenfolge der bestehenden Keys bleibt, `detail` wird **daneben** ergänzt, nicht ersetzt):

```json
{
  "title": "Kontakte verwalten",
  "description": "Verwalte deine Kontakte und ihre Verschlüsselungs-Keys.",
  "searchContacts": "Kontakte suchen...",
  "noContacts": "Keine Kontakte gefunden",
  "deleteContact": "Kontakt löschen?",
  "deleteContactDesc": "Dieser Kontakt wird dauerhaft gelöscht. Alle Nachrichten werden ebenfalls entfernt.",
  "detail": {
    "openLabel": "Details zu {{name}} öffnen",
    "fingerprint": "PGP-Fingerprint",
    "i2pAddress": "I2P-Adresse",
    "i2pAddressMissing": "Nicht hinterlegt",
    "p2pIdentifier": "P2P-Identifier",
    "addedOn": "Hinzugefügt am",
    "lastSeen": "Zuletzt gesehen",
    "lastSeenUnknown": "Unbekannt",
    "copyLabel": "Kopieren",
    "copied": "Kopiert!",
    "copyFailed": "Kopieren fehlgeschlagen",
    "deleteButton": "Kontakt löschen"
  }
}
```

**Wichtig:** Die exakten deutschen Texte aus dem Spec übernehmen. `openLabel` nutzt `{{name}}` (i18next-Syntax).

- [ ] **Step 3: Englische Locale-Datei erweitern**

Editiere `app/src/locales/en.json` analog:

```json
{
  "title": "Manage contacts",
  "description": "Manage your contacts and their encryption keys.",
  "searchContacts": "Search contacts...",
  "noContacts": "No contacts found",
  "deleteContact": "Delete contact?",
  "deleteContactDesc": "This contact will be permanently deleted. All messages will also be removed.",
  "detail": {
    "openLabel": "Open details for {{name}}",
    "fingerprint": "PGP fingerprint",
    "i2pAddress": "I2P address",
    "i2pAddressMissing": "Not provided",
    "p2pIdentifier": "P2P identifier",
    "addedOn": "Added on",
    "lastSeen": "Last seen",
    "lastSeenUnknown": "Unknown",
    "copyLabel": "Copy",
    "copied": "Copied!",
    "copyFailed": "Copy failed",
    "deleteButton": "Delete contact"
  }
}
```

- [ ] **Step 4: JSON-Syntax validieren**

```bash
cd /home/g/dev/SecuChat/app && node -e "JSON.parse(require('fs').readFileSync('src/locales/de.json', 'utf8')); JSON.parse(require('fs').readFileSync('src/locales/en.json', 'utf8')); console.log('OK');"
```

Erwartet: `OK`. Falls JSON-Parse-Fehler: Klammern, Kommata, fehlende Anführungszeichen prüfen.

- [ ] **Step 5: Commit**

```bash
git add app/src/locales/de.json app/src/locales/en.json
git commit -m "feat(i18n): add contacts.detail.* keys for contact detail modal"
```

---

## Task 2: ContactDetailModal-Komponente (neu)

**Files:**
- Create: `app/src/components/custom/ContactDetailModal.tsx`

**Interfaces:**
- Consumes: `Contact` type (`app/src/types/index.ts:18-27`), `useApp()` für `removeContact`, `useTranslation()` für i18n
- Produces: Komponente, die der ContactManager einbindet (Task 3 definiert die genaue Mount-Stelle)

- [ ] **Step 1: Datei-Skeleton anlegen**

Erstelle `app/src/components/custom/ContactDetailModal.tsx` mit folgendem Inhalt:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, Trash2, Network, User } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { de, enUS } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useApp } from '@/contexts/AppContext';
import { AnonymityBadge } from './AnonymityBadge';
import type { Contact } from '@/types';

interface ContactDetailModalProps {
  contact: Contact | null;
  isOpen: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

const localeMap = {
  de,
  en: enUS,
} as const;

export function ContactDetailModal({
  contact,
  isOpen,
  onClose,
  onDeleted,
}: ContactDetailModalProps) {
  const { t, i18n } = useTranslation();
  const { removeContact, i2pStatus } = useApp();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  if (!contact) return null;

  const getInitials = (name: string) =>
    name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);

  const getAnonymityLevel = (): 'green' | 'yellow' | 'red' => {
    if (i2pStatus?.samConnected && contact.i2pAddress) return 'green';
    return 'red';
  };

  const handleCopy = async (value: string, fieldId: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(fieldId);
      setTimeout(() => setCopiedField(null), 1500);
    } catch {
      // Silent fail — UI zeigt weiterhin Copy-Icon
    }
  };

  const handleDelete = async () => {
    await removeContact(contact.id);
    setShowDeleteConfirm(false);
    onDeleted();
  };

  const dateLocale = localeMap[i18n.language as keyof typeof localeMap] ?? enUS;

  const formattedLastSeen = contact.lastSeen
    ? formatDistanceToNow(new Date(contact.lastSeen), {
        addSuffix: true,
        locale: dateLocale,
      })
    : t('contacts.detail.lastSeenUnknown');

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <Avatar className="h-12 w-12">
                <AvatarFallback>{getInitials(contact.name)}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <DialogTitle className="text-lg">{contact.name}</DialogTitle>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {contact.status === 'online' && (
                    <Badge variant="secondary" className="text-xs">
                      Online
                    </Badge>
                  )}
                  <AnonymityBadge level={getAnonymityLevel()} size="sm" />
                  {contact.i2pAddress && (
                    <Badge variant="outline" className="text-xs">
                      <Network className="h-3 w-3 mr-1" />
                      I2P
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <DialogDescription className="sr-only">
              {t('contacts.title')}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 mt-4">
            {/* PGP-Fingerprint */}
            <FieldRow
              label={t('contacts.detail.fingerprint')}
              value={contact.fingerprint}
              fieldId="fingerprint"
              copiedField={copiedField}
              onCopy={handleCopy}
            />

            {/* I2P-Adresse */}
            {contact.i2pAddress && (
              <FieldRow
                label={t('contacts.detail.i2pAddress')}
                value={contact.i2pAddress}
                fieldId="i2pAddress"
                copiedField={copiedField}
                onCopy={handleCopy}
              />
            )}

            {/* P2P-Identifier (optional) */}
            {contact.p2pIdentifier && (
              <FieldRow
                label={t('contacts.detail.p2pIdentifier')}
                value={contact.p2pIdentifier}
                fieldId="p2pIdentifier"
                copiedField={copiedField}
                onCopy={handleCopy}
              />
            )}

            {/* Last seen */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">
                {t('contacts.detail.lastSeen')}
              </p>
              <p className="text-sm">{formattedLastSeen}</p>
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t mt-4">
            <Button
              variant="destructive"
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {t('contacts.detail.deleteButton')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('contacts.deleteContact')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('contacts.deleteContactDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface FieldRowProps {
  label: string;
  value: string;
  fieldId: string;
  copiedField: string | null;
  onCopy: (value: string, fieldId: string) => void;
}

function FieldRow({ label, value, fieldId, copiedField, onCopy }: FieldRowProps) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
      <div className="flex items-start gap-2">
        <code className="flex-1 text-xs font-mono break-all bg-muted px-2 py-1.5 rounded">
          {value}
        </code>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onCopy(value, fieldId)}
          aria-label={label}
          className="flex-shrink-0"
        >
          {copiedField === fieldId ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
```

**Hinweise zum Code:**

- `date-fns/locale` für `de` und `enUS` werden importiert. Falls `date-fns/locale` in v4 anders heißt (z. B. `date-fns/locale/en-US`), passe die Imports an: `import { de, enUS } from 'date-fns/locale';` ist der Standard für v3+ und funktioniert auch in v4.
- `sr-only` auf der `DialogDescription`, damit Screenreader den Titel bekommen, der visuelle Dialog aber keine sichtbare Beschreibung braucht.
- `<code>`-Tag mit `break-all` statt `truncate` — vollständige Adressen sind sichtbar.
- `<FieldRow>` als interne Hilfskomponente am Datei-Ende.

- [ ] **Step 2: Type-Check**

```bash
cd /home/g/dev/SecuChat/app && npx tsc --noEmit
```

Erwartet: Exit 0. Falls Type-Errors: meist fehlende Imports oder falsche Locale-Key-Strings.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/custom/ContactDetailModal.tsx
git commit -m "feat(contacts): add ContactDetailModal with copy buttons and delete confirmation"
```

---

## Task 3: ContactManager-Refactor

**Files:**
- Modify: `app/src/components/custom/ContactManager.tsx` — Liste verkleinern, Klickbarkeit hinzufügen, Modal einbinden

**Interfaces:**
- Consumes: `ContactDetailModal` (aus Task 2), `useApp()` für `contacts`, `useTranslation()`
- Produces: Modal-Öffnung über `selectedContactId`-State

- [ ] **Step 1: Imports aufräumen**

Ersetze die Imports in `ContactManager.tsx`. Der vollständige neue Import-Block:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserPlus, Search, User, Network } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useApp } from '@/contexts/AppContext';
import { AddContactDialog } from './AddContactDialog';
import { AnonymityBadge } from './AnonymityBadge';
import { ContactDetailModal } from './ContactDetailModal';
import type { Contact } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
```

**Entfernt:** `Trash2` aus lucide-react. Komplette Imports von `@/components/ui/alert-dialog` (alle 8 Subkomponenten).

- [ ] **Step 2: State und removeContact-Verwendung entfernen**

Im `ContactManager`-Funktions-Body, ersetze die State-Deklarationen und Hook-Aufrufe:

**Vorher:**
```tsx
const { t } = useTranslation();
const { contacts, addContact, removeContact, i2pStatus } = useApp();
const [showAddDialog, setShowAddDialog] = useState(false);
const [showDeleteDialog, setShowDeleteDialog] = useState<string | null>(null);
const [searchQuery, setSearchQuery] = useState('');
```

**Nachher:**
```tsx
const { t } = useTranslation();
const { contacts, addContact, i2pStatus } = useApp();
const [showAddDialog, setShowAddDialog] = useState(false);
const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
const [searchQuery, setSearchQuery] = useState('');

const selectedContact = selectedContactId
  ? contacts.find(c => c.id === selectedContactId) ?? null
  : null;
```

**Entferne die Funktionen** `handleDelete` und `getContactAnonymityLevel` komplett.

- [ ] **Step 3: Filterlogik umstellen**

**Vorher:**
```tsx
const filteredContacts = contacts.filter(contact =>
  contact.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
  contact.fingerprint.toLowerCase().includes(searchQuery.toLowerCase())
);
```

**Nachher:**
```tsx
const filteredContacts = contacts.filter(contact =>
  contact.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
  (contact.p2pIdentifier?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
);
```

- [ ] **Step 4: `getInitials` und `getContactAnonymityLevel` anpassen**

`getInitials` bleibt unverändert.

**Entferne** die Funktion `getContactAnonymityLevel` (sie wird im Detail-Modal wiederverwendet — dort ist die Logik identisch, aber `contact` ist nun das ausgewählte Element).

- [ ] **Step 5: Render — Listen-Item umbauen**

Ersetze das gesamte `<div>` für jedes Listen-Item (`ContactManager.tsx:115-156` im Original):

**Vorher:**
```tsx
filteredContacts.map(contact => (
  <div
    key={contact.id}
    className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent transition-colors"
  >
    <Avatar className="h-10 w-10">
      <AvatarFallback>{getInitials(contact.name)}</AvatarFallback>
    </Avatar>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="font-medium">{contact.name}</p>
        {contact.status === 'online' && (
          <Badge variant="secondary" className="text-xs">Online</Badge>
        )}
        <AnonymityBadge
          level={getContactAnonymityLevel(contact)}
          size="sm"
        />
        {contact.i2pAddress && (
          <Badge variant="outline" className="text-xs">
            <Network className="h-3 w-3 mr-1" />
            I2P
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground font-mono truncate">
        {contact.fingerprint}
      </p>
      {contact.i2pAddress && (
        <p className="text-xs text-muted-foreground font-mono truncate">
          {contact.i2pAddress}
        </p>
      )}
    </div>
    <Button
      variant="ghost"
      size="icon"
      className="text-destructive hover:text-destructive"
      onClick={() => setShowDeleteDialog(contact.id)}
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  </div>
))
```

**Nachher:**
```tsx
filteredContacts.map(contact => {
  const anonymityLevel: 'green' | 'red' =
    i2pStatus?.samConnected && contact.i2pAddress ? 'green' : 'red';
  return (
    <button
      key={contact.id}
      type="button"
      onClick={() => setSelectedContactId(contact.id)}
      aria-label={t('contacts.detail.openLabel', { name: contact.name })}
      className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent transition-colors text-left"
    >
      <Avatar className="h-10 w-10 flex-shrink-0">
        <AvatarFallback>{getInitials(contact.name)}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium truncate">{contact.name}</p>
          {contact.status === 'online' && (
            <Badge variant="secondary" className="text-xs">
              Online
            </Badge>
          )}
          <AnonymityBadge level={anonymityLevel} size="sm" />
          {contact.i2pAddress && (
            <Badge variant="outline" className="text-xs">
              <Network className="h-3 w-3 mr-1" />
              I2P
            </Badge>
          )}
        </div>
      </div>
    </button>
  );
})
```

**Wichtig:** Der Wrapper ist jetzt ein echtes `<button type="button">` (nicht `<div role="button">`), damit Tastatur-Navigation und Touch-Target out-of-the-box funktionieren. `text-left` behält Linksbündigkeit wie zuvor.

- [ ] **Step 6: Detail-Modal einbinden, alten AlertDialog entfernen**

**Füge** am Ende des `ContactManager`-Returns (nach `<AddContactDialog />`, vor dem schließenden Fragment-Tag) ein:

```tsx
<ContactDetailModal
  contact={selectedContact}
  isOpen={selectedContactId !== null}
  onClose={() => setSelectedContactId(null)}
  onDeleted={() => setSelectedContactId(null)}
/>
```

**Entferne** den gesamten `<AlertDialog>`-Block am Datei-Ende (`ContactManager.tsx:169-184` im Original), inkl. der Imports.

- [ ] **Step 7: Type-Check**

```bash
cd /home/g/dev/SecuChat/app && npx tsc --noEmit
```

Erwartet: Exit 0. Häufigste Fehler: `Trash2`-Import nicht entfernt; `removeContact` im Body noch referenziert; `AlertDialog*` noch referenziert.

- [ ] **Step 8: Lint**

```bash
cd /home/g/dev/SecuChat/app && npm run lint
```

Erwartet: Exit 0. Häufigste Warnungen: unused imports (vor allem `Trash2`, `AlertDialog*`).

- [ ] **Step 9: Production-Build**

```bash
cd /home/g/dev/SecuChat/app && npm run build
```

Erwartet: Exit 0, Vite-Bundle wird erstellt.

- [ ] **Step 10: Commit**

```bash
git add app/src/components/custom/ContactManager.tsx
git commit -m "feat(contacts): split manager into compact list + detail modal

Lösch-Button war auf schmalen Android-Viewports (≤360 dp) außerhalb
des klickbaren Bereichs, weil zwei monospace-Zeilen (Fingerprint +
i2pAdresse) den horizontalen Layout-Slot überlappten. Liste zeigt
jetzt nur Avatar + Name + Badges und ist als Ganzes klickbar;
technische Details (Fingerprint, i2pAdresse, lastSeen) sind im neuen
ContactDetailModal read-only mit Copy-Buttons erreichbar. Delete
ist ausschließlich im Detail-Modal verfügbar."
```

---

## Task 4: Verifikation Android + Electron Build

**Files:**
- Keine Code-Änderungen

- [ ] **Step 1: Android-Build**

```bash
cd /home/g/dev/SecuChat/app && npx cap sync android && cd android && ./gradlew assembleDebug
```

Erwartet: Exit 0, APK wird in `android/app/build/outputs/apk/debug/` erzeugt. Falls Gradle-Plugin-Fehler: `cd /home/g/dev/SecuChat/app/android && ./gradlew clean && ./gradlew assembleDebug`.

- [ ] **Step 2: Electron-Build**

```bash
cat /home/g/dev/SecuChat/electron/package.json | grep -A 2 '"scripts"'
```

Den genauen Build-Befehl aus `electron/package.json` ablesen (z. B. `npm run build` oder `npm run dist`). Ausführen:

```bash
cd /home/g/dev/SecuChat/electron && npm run build  # oder wie in package.json definiert
```

Erwartet: Exit 0. Falls Build-Script-Fehler: Issue im Electron-Build-Script prüfen, nicht in den neuen Komponenten.

- [ ] **Step 3: Manuelle Smoke-Tests**

**Android (z. B. A50 oder A52):**
1. APK installieren: `adb install android/app/build/outputs/apk/debug/app-debug.apk`
2. App öffnen, Kontakte-Manager öffnen (über Header-Button)
3. Verifizieren:
   - Liste zeigt nur Avatar + Name + Badges
   - Keine langen Strings (Fingerprint, i2pAdresse) mehr sichtbar
   - Auf einen Kontakt tippen → Detail-Modal öffnet sich
   - Alle Felder (Fingerprint, i2pAdresse, lastSeen) sichtbar mit Copy-Buttons
   - Copy-Button antippen → visuelles Feedback (Check-Icon)
   - "Kontakt löschen"-Button antippen → AlertDialog → Bestätigen → Kontakt verschwindet, Modal schließt

**Electron (Desktop):**
1. Electron-App starten (via `electron/package.json`-Dev-Script)
2. Identische Tests wie Android

- [ ] **Step 4: Falls Fehler auftreten — Debugging-Loop**

Falls einer der Schritte 1-3 fehlschlägt:
- Type-/Lint-Errors → zurück zu Task 3, Step 7-8.
- Visuelle Regression → öffne `ContactManager.tsx` und `ContactDetailModal.tsx` parallel, prüfe Tailwind-Klassen und shadcn-Komponenten-Props.
- Build-Error im Android- oder Electron-Schritt, der nichts mit den neuen Komponenten zu tun hat → Issue separat behandeln (nicht in diesem Plan).

- [ ] **Step 5: Finaler Commit (nur falls Fixes nötig waren)**

Falls Debugging Änderungen an Code-Dateien erfordert hat:

```bash
git status
git add <geänderte Dateien>
git commit -m "fix(contacts): address smoke-test regressions from contact-manager-ux-refactor"
```

Falls keine Fixes nötig waren: nichts committen.

---

## Success Criteria Checklist

Nach Abschluss aller Tasks verifizieren:

- [ ] `app/src/components/custom/ContactManager.tsx` enthält **keine** Referenzen mehr auf `fingerprint.toLowerCase()` im Filter, **keine** `<p>`-Tags mit `font-mono truncate` mehr für Fingerprint/i2pAddress, **keinen** `Trash2`-Button mehr, **keinen** `AlertDialog` mehr.
- [ ] `app/src/components/custom/ContactDetailModal.tsx` existiert mit `ContactDetailModalProps`-Interface, `FieldRow`-Hilfskomponente, Copy-Buttons, AlertDialog für Delete.
- [ ] `app/src/locales/de.json` und `app/src/locales/en.json` haben identische Key-Struktur unter `contacts.detail.*`.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run build` exiten mit 0.
- [ ] Android-`assembleDebug` baut erfolgreich.
- [ ] Electron-Build läuft erfolgreich.
- [ ] Manuelle Smoke-Tests auf Android und Electron bestätigen alle Success-Criteria aus dem Spec (Punkt 1-5 in `docs/superpowers/specs/2026-08-12-contact-manager-ux-refactor.md`).
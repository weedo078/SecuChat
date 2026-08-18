# Contact Manager UX Refactor

**Date:** 2026-08-12
**Branch:** feat/android-port
**Author:** Brainstorming session

## Problem

In der "Kontakte verwalten"-Ansicht (modaler Dialog) gibt es drei zusammenhängende UX-Probleme:

1. **Lösch-Button nicht klickbar auf Android**: Auf schmalen Android-Bildschirmen (≤ 360 dp) wird der rechts positionierte `Trash2`-Button durch die langen monospace-Strings (Fingerprint + i2pAdresse) aus dem sichtbaren Bereich geschoben.
2. **Technische Details sichtbar in der Liste**: `fingerprint` (60+ Zeichen PGP-Fingerprint) und `i2pAddress` (b32.i2p) werden unter dem Namen als monospace-Text gerendert. Für Endnutzer ist das Rauschen — die Daten gehören in einen Detail-View.
3. **Muss auf beiden Build-Zielen laufen**: Android (Capacitor → WebView) und Electron (Desktop-App).

## Root Cause (heutige Implementierung)

`app/src/components/custom/ContactManager.tsx:113-156` rendert pro Kontakt eine einzige Flex-Row mit:

- Avatar (fix 40×40 px, links)
- Mittelteil (`flex-1 min-w-0`): Name + Status-Badges + **zwei lange `<p>`-Zeilen mit `truncate`** (Fingerprint, i2pAddress)
- Delete-Button (`<Button variant="ghost" size="icon">` mit `Trash2`-Icon, rechts)

Das Problem ist nicht `truncate` — die Strings werden korrekt gekürzt. Das Problem ist, dass die gesamte Zeile **zwei sichtbare Textzeilen** belegt, während Avatar und Delete-Button in einer **horizontalen** Zeile sitzen. Auf schmalen Viewports überlappt die zweite Textzeile (i2pAddress) mit der Position des Delete-Buttons, weil `truncate` zwar visuell kürzt, aber das Layout nicht auf eine Zeile reduziert wird.

## Solution

Trennung der Kontakt-Anzeige in zwei Views:

- **Liste** (compact): nur Identifikation — Avatar, Name, Status-Badges (Online / AnonymityBadge / I2P-Badge). Klickbar.
- **Detail-Modal** (neu): alle technischen Felder (Fingerprint, i2pAdresse, lastSeen, Erstellungsdatum) read-only mit Copy-Buttons. Delete-Button hier.

### Komponenten-Änderungen

#### 1. `app/src/components/custom/ContactManager.tsx` (refactor)

**Entfernen:**

- Die zwei `<p className="text-xs ... font-mono truncate">` Zeilen für `fingerprint` und `i2pAddress` (`ContactManager.tsx:138-145`).
- Den `<Button variant="ghost" size="icon">` mit `Trash2`-Icon (`ContactManager.tsx:147-154`).
- Die zugehörigen Imports (`Trash2`, `AlertDialog*`).
- Die zugehörigen States (`showDeleteDialog`).
- Die `handleDelete`-Funktion und den `<AlertDialog>` für Lösch-Bestätigung (`ContactManager.tsx:169-184`).

**Hinzufügen / ändern:**

- Neuer State: `const [selectedContactId, setSelectedContactId] = useState<string | null>(null);`
- Filterlogik: `contact.fingerprint.toLowerCase().includes(...)` ersetzen durch `contact.p2pIdentifier?.toLowerCase().includes(...)` (P2P-Identifier bleibt ein technisches Feld und ist für Power-User via Suche erreichbar).
- Wrapper `<div>` → `<button>` (oder `<div role="button" tabIndex={0}>` mit Keyboard-Handler), damit die ganze Zeile klickbar ist. `onClick={() => setSelectedContactId(contact.id)}`. A11y: `aria-label={t('contacts.detail.openLabel', { name: contact.name })}`.
- Neue Render-Komponente `<ContactDetailModal>` am Ende, mit `contact={selectedContact}` + `onClose={() => setSelectedContactId(null)}` + `onDeleted={() => setSelectedContactId(null)}` Props.

#### 2. `app/src/components/custom/ContactDetailModal.tsx` (neu)

Neue Datei. Verwendet shadcn `Dialog`, `Button`, `Badge`, `Avatar`, `AlertDialog`.

**Props:**

```ts
interface ContactDetailModalProps {
  contact: Contact | null;
  isOpen: boolean;
  onClose: () => void;
  onDeleted: () => void;
}
```

**Layout:**

- `DialogContent className="max-w-lg max-h-[85vh] flex flex-col"`
- Header: `DialogHeader` mit Avatar (h-12 w-12) + Name (text-lg font-medium) + Badges (Online/AnonymityBadge/I2P-Badge). `DialogTitle` = `contact.name`, `DialogDescription` = nichts/leer.
- Body (scrollable, `flex-1 overflow-y-auto`):
  - Feld "PGP-Fingerprint": `contact.fingerprint` in monospace, **vollständig** (nicht truncated), in einer Card/Box. Rechts daneben ein `<Button size="icon" variant="ghost">` mit `<Copy>`-Icon → `navigator.clipboard.writeText(contact.fingerprint)`.
  - Feld "I2P-Adresse": `contact.i2pAddress` falls vorhanden, sonst "Nicht hinterlegt" (muted). Mit Copy-Button. Conditional rendern.
  - Feld "P2P-Identifier": `contact.p2pIdentifier` falls vorhanden, sonst nicht rendern. Mit Copy-Button.
  - Feld "Hinzugefügt am": falls `createdAt` auf `Contact` existiert → format mit `new Intl.DateTimeFormat(i18n.language).format(new Date(contact.createdAt))`. Falls nicht → weglassen.
  - Feld "Zuletzt gesehen": `contact.lastSeen ? formatDistanceToNow(new Date(contact.lastSeen), { addSuffix: true, locale: i18n.language }) : 'Unbekannt'`. `date-fns` ist möglicherweise nicht im Deps-Set — vor Verwendung prüfen. Alternative: einfache `Intl.RelativeTimeFormat`-basierte Helper-Funktion inline.
- Footer (rechtsbündig): `<Button variant="destructive" onClick={() => setShowDeleteConfirm(true)}>` mit `<Trash2 className="h-4 w-4 mr-2" />` und Label aus `contacts.detail.deleteButton`.

**Delete-Bestätigung:**

- Innerhalb des Modals ein `AlertDialog` mit `open={showDeleteConfirm}`, Trigger: roter Button.
- `AlertDialogAction onClick={handleDelete}` ruft `removeContact(contact.id)` aus `useApp()`, dann `onDeleted()` aufrufen.
- Nach erfolgreichem Löschen: `onDeleted()` → ContactManager schließt Detail-Modal automatisch.

**Copy-Button-Verhalten:**

- Click → `navigator.clipboard.writeText(value).then(() => { setCopiedField(value); setTimeout(() => setCopiedField(null), 1500) })`.
- Bei Fehler: `toast.error(t('contacts.detail.copyFailed'))` (oder inline-Fehlermeldung).
- Wenn `copiedField === value`: zeige `<Check>`-Icon statt `<Copy>`.

#### 3. Locale-Erweiterungen

**`app/src/locales/de.json`** und **`en.json`** — neuer Block unter `contacts`:

```json
{
  "contacts": {
    "title": "...",
    "description": "...",
    "searchContacts": "...",
    "noContacts": "...",
    "deleteContact": "...",
    "deleteContactDesc": "...",
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
}
```

Englische Pendants mit identischen Keys.

## Build & Test Strategy

### Code-only-Änderungen (plattformneutral)

Die Refactor betrifft ausschließlich View-Layer-Code in `app/src/components/custom/` und Locale-Dateien. Keine Änderungen an:

- `app/src/services/storage/` (alle drei Provider bleiben identisch)
- `app/src/contexts/AppContext.tsx` (`removeContact` bleibt)
- `app/src/types/index.ts` (`Contact`-Interface bleibt)
- `app/android/` (Capacitor-Build-Konfiguration)
- `electron/` (Electron-Build-Konfiguration)

Damit wirkt der Refactor automatisch auf beiden Plattformen.

### Verifikations-Pipeline (in dieser Reihenfolge)

1. `cd app && npx tsc --noEmit` — Type-Check
2. `cd app && npm run lint` — ESLint
3. `cd app && npm run build` — Vite-Production-Build
4. `cd app && npx cap sync android && cd android && ./gradlew assembleDebug` — Android-APK
5. Electron-Build: `npm --prefix electron run build` (genauer Befehl laut `electron/package.json`)

Jeder Schritt muss ohne Fehler exiten, bevor der nächste läuft.

### Manuelle Smoke-Test-Pfade (für die Verifikation der UX)

**Android (A50 oder A52):**

1. App öffnen → Kontakte-Manager öffnen
2. Visuell prüfen: Liste zeigt nur Name + Badges, **keine** langen Strings mehr
3. Auf einen Kontakt tippen → Detail-Modal öffnet sich
4. Visuell prüfen: alle Felder vollständig sichtbar (Fingerprint, i2pAdresse, lastSeen)
5. Copy-Button für Fingerprint antippen → "Kopiert!"-Feedback sichtbar
6. "Kontakt löschen"-Button antippen → AlertDialog → Bestätigen → Kontakt verschwindet, Liste zeigt ihn nicht mehr, Modal schließt sich
7. **Kritischer Regression-Test**: Lösch-Button im Modal funktioniert auch auf 360-dp-Viewports ohne Überlappung

**Electron (Desktop):**

1. App öffnen → Kontakte-Manager öffnen
2. Liste-Darstellung wie auf Android
3. Klick auf Reihe → Detail-Modal
4. Copy-Buttons (navigator.clipboard funktioniert in Electron ohne Permission-Prompt)
5. Delete-Pfad identisch

### Test-Mode / DevBridge

Bestehende Test-Hooks (`secuchat_test_mode`, `secuchat_dev_bridge`) bleiben unangetastet. Keine neuen Endpoints nötig für dieses Refactor. Falls Verifikation via DevBridge nötig wird, kann `list-all-users` + `delete-contact` bestehend verwendet werden.

## Out of Scope

- Storage-Änderungen (alle drei Provider bleiben)
- `Contact`-Type-Änderungen in `types/index.ts:18-27`
- `removeContact`-Logik in `AppContext.tsx:893-902` (kaskadierendes Chat-Löschen bleibt)
- Edit-Funktionalität für Kontakte (nur Read-only-Detail)
- Kontakt-Verifikation-Flow (`ContactVerificationDialog`)
- `ContactVerificationDialog` bleibt erreichbar über separaten Trigger (falls gewünscht: späteres Add-on)
- `AddContactDialog`, `QRContactScanner` bleiben unverändert
- Suchfilter-Verhalten: nur `name` und `p2pIdentifier` durchsuchbar — `fingerprint` ist nicht mehr im Listen-Kontext sichtbar, daher nicht durchsuchbar (das ist explizit gewollt, da Fingerprint nicht mehr in der Liste steht)

## Edge-Cases

| Fall | Verhalten |
|------|-----------|
| Kontakt ohne `i2pAddress` | I2P-Badge fehlt in Liste; Detail zeigt "I2P-Adresse: Nicht hinterlegt" (muted) |
| Kontakt ohne `lastSeen` | Detail zeigt "Zuletzt gesehen: Unbekannt" |
| Kontakt ohne `createdAt` | Feld "Hinzugefügt am" wird gar nicht gerendert (kein leerer Block) |
| Kontakt ohne `p2pIdentifier` | Feld wird nicht gerendert |
| Clipboard-API nicht verfügbar (z. B. Android-WebView ohne Permission) | `navigator.clipboard.writeText` wirft → catch → inline-Fehlermeldung "Kopieren fehlgeschlagen — bitte manuell markieren" |
| Liste leer | Empty-State bleibt identisch |
| Suche aktiv beim Öffnen des Detail | Suche wird beibehalten, Filter wirkt weiter |
| Mehrere Kontakte mit gleichem Namen | Liste disambiguiert per Avatar + Badges; Klick öffnet jeweils das richtige Detail (über `id`-Selektion) |
| Lange Namen | `truncate` weiterhin auf Name; Layout bleibt stabil |

## Risk Assessment

- **Niedriges Risiko**: Storage- und Domain-Logik werden nicht angefasst.
- **Mittleres Risiko**: Visuelle Regression in Electron (Desktop) ist möglich — Verifikation per `npm run build` + Smoke-Test nötig.
- **Bekannte Lücke**: Implementierungs-Phase muss klären, ob `date-fns` (für `formatDistanceToNow`) bereits in `app/package.json` als Dep vorhanden ist. Falls nicht, kommt eine 30-Zeilen-`Intl.RelativeTimeFormat`-Helper-Funktion zum Einsatz — kein neuer Dep, kein neues Bundle-Bloat.

## Success Criteria

1. Auf Android (A50 oder A52, 360 dp Breite) ist der Lösch-Button **nicht mehr** außerhalb des sichtbaren Bereichs.
2. Die Kontakte-Liste zeigt **keine** technischen Felder (Fingerprint, i2pAdresse).
3. Alle technischen Felder sind im Detail-Modal mit Copy-Buttons zugänglich.
4. Delete funktioniert ausschließlich über das Detail-Modal.
5. `npm run build`, `npm run lint`, `tsc --noEmit`, Android-`assembleDebug` und Electron-Build laufen alle ohne Fehler durch.
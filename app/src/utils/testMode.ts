// TEST-ONLY — niemals in Production aktivieren.
//
// Wenn im localStorage 'secuchat_test_mode' auf '1' gesetzt ist, betreibt die App
// einen festen Test-Modus: das Auto-Onboarding erzeugt den PGP-Key mit der hier
// definierten Passphrase, und der AppContext entsperrt beim Start automatisch
// (ohne UnlockDialog). So wird die Passphrase-Pflicht für automatisierte E2E-Tests
// zuverlässig umgangen — unabhängig davon, ob ein flüchtiges localStorage-Flag
// ('secuchat_test_pw') noch vorhanden ist oder nicht.
//
// Der Test-Mode muss bewusst von außen (CDP/ADB localStorage.setItem) aktiviert
// werden; er lässt sich nicht aus der UI einschalten.

export const TEST_MODE_KEY = 'secuchat_test_mode';

// Feste Passphrase für Test-Keys. MUSS mit dem Wert im Auto-Onboarding
// (Onboarding.tsx) übereinstimmen — dort wird derselbe Konstantenwert verwendet.
export const TEST_PASSPHRASE = 'testpass123';

export function isTestMode(): boolean {
  return typeof localStorage !== 'undefined'
    && localStorage.getItem(TEST_MODE_KEY) === '1';
}

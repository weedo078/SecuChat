# Implementierungsplan: Kontakte & Chats löschen

## Status: Bereit zur Umsetzung

Dieser Plan beschreibt die Implementierung von zwei fehlenden Kernfunktionen:
1. **Kontakte entfernen** aus der Kontaktübersicht
2. **Chats löschen** aus der Chat-Ansicht

---

## Analyse: Aktueller Stand

### Bereits implementiert ✅
- `storageService.deleteContact(id)` - Löscht Kontakt aus IndexedDB
- `storageService.deleteChat(id)` - Löscht Chat aus IndexedDB
- `storageService.deleteMessagesByChat(chatId)` - Löscht alle Nachrichten eines Chats
- `AppContext.removeContact(id)` - Entfernt Kontakt + zugehörigen Chat
- `AppContext.deleteChat(id)` - Löscht Chat + Nachrichten

### Fehlend ❌
- UI-Trigger in ContactManager für Kontakt-Löschung
- UI-Trigger in ChatView für Chat-Löschung
- Kontextmenü/Swipe-Action in Sidebar für schnelles Chat-Löschen

---

## Teil 1: Kontakte entfernen

### Ziel
Nutzer können Kontakte aus der Kontaktübersicht (ContactManager) entfernen.

### Implementierung

#### 1.1 ContactManager.tsx erweitern
**Datei:** `app/src/components/custom/ContactManager.tsx`

**Aktionen:**
1. Importiere `Trash2` Icon von lucide-react
2. Füge pro Kontakt einen Löschen-Button hinzu
3. Implementiere Bestätigungs-Dialog mit AlertDialog
4. Rufe `removeContact()` aus AppContext auf

**UI-Design:**
```
┌─────────────────────────────────────┐
│ Kontakt: Max Mustermann      [🗑️] │  ← Löschen-Button
├─────────────────────────────────────┤
│ Fingerabdruck: ABC123...            │
│ Status: Online                      │
└─────────────────────────────────────┘
```

**Code-Vorlage:**
```tsx
// In der Kontakt-Liste
<Button 
  variant="ghost" 
  size="icon"
  onClick={() => setContactToDelete(contact)}
>
  <Trash2 className="h-4 w-4 text-destructive" />
</Button>

// Bestätigungs-Dialog
<AlertDialog open={!!contactToDelete} onOpenChange={() => setContactToDelete(null)}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Kontakt löschen?</AlertDialogTitle>
      <AlertDialogDescription>
        Möchtest du {contactToDelete?.name} wirklich löschen? 
        Der Chat-Verlauf wird ebenfalls gelöscht.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Abbrechen</AlertDialogCancel>
      <AlertDialogAction onClick={handleDelete} className="bg-destructive">
        Löschen
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

#### 1.2 AppContext sicherstellen
**Datei:** `app/src/contexts/AppContext.tsx`

**Prüfung:**
- `removeContact` muss existieren und exportiert werden
- Sollte zugehörigen Chat automatisch mitlöschen (bereits implementiert)

---

## Teil 2: Chats löschen

### Ziel
Nutzer können Chats aus der Chat-Ansicht löschen.

### Implementierung

#### 2.1 ChatView.tsx - Dropdown-Menü aktivieren
**Datei:** `app/src/components/custom/ChatView.tsx`

**Aktionen:**
1. Füge `onDeleteChat` Prop hinzu oder nutze `deleteChat` aus AppContext
2. Aktiviere den bestehenden "Chat löschen" Dropdown-Menüpunkt
3. Füge Bestätigungs-Dialog hinzu

**UI-Design:**
```
┌─────────────────────────────────────┐
│ Max Mustermann          [...] [📎] │  ← Drei-Punkte-Menü
│ Online                              │
├─────────────────────────────────────┤
│                                     │
│   Nachrichten...                    │
│                                     │
└─────────────────────────────────────┘

Drei-Punkte-Menü:
├── Kontaktinfo
├── Nachrichten suchen
└── Chat löschen ⚠️       ← Klickbar machen
```

**Code-Vorlage:**
```tsx
// Dropdown-Menü in ChatView Header
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="ghost" size="icon">
      <MoreVertical className="h-5 w-5" />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuItem onClick={() => setShowContactInfo(true)}>
      Kontaktinfo
    </DropdownMenuItem>
    <DropdownMenuItem onClick={() => setShowSearch(true)}>
      Nachrichten suchen
    </DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem 
      className="text-destructive"
      onClick={() => setShowDeleteConfirm(true)}
    >
      <Trash2 className="h-4 w-4 mr-2" />
      Chat löschen
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>

// Bestätigungs-Dialog
<AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Chat löschen?</AlertDialogTitle>
      <AlertDialogDescription>
        Möchtest du diesen Chat wirklich löschen? 
        Alle Nachrichten werden unwiderruflich gelöscht.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Abbrechen</AlertDialogCancel>
      <AlertDialogAction 
        onClick={handleDeleteChat}
        className="bg-destructive"
      >
        Löschen
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

#### 2.2 Chat löschen Handler
```tsx
const handleDeleteChat = async () => {
  if (!activeChat) return;
  
  await deleteChat(activeChat.id);
  setShowDeleteConfirm(false);
  
  // Optional: Toast-Benachrichtigung
  toast.success('Chat gelöscht');
};
```

---

## Teil 3: Optional - Schnell-Löschen in Sidebar

### Ziel
Nutzer können Chats direkt aus der Sidebar löschen (ohne Chat zu öffnen).

### Implementierung

#### 3.1 Sidebar.tsx erweitern
**Datei:** `app/src/components/custom/Sidebar.tsx`

**Optionen:**
1. **Kontextmenü** (Rechtsklick auf Chat)
2. **Swipe-Action** (für Touch-Geräte)
3. **Hover-Button** (Desktop)

**Empfohlene Lösung: Hover-Button**
```tsx
// In der Chat-Liste
<button
  onClick={() => handleChatClick(chat)}
  className="... group"
>
  {/* Chat-Info */}
  <div className="flex-1">...</div>
  
  {/* Löschen-Button (nur bei Hover) */}
  <Button
    variant="ghost"
    size="icon"
    className="opacity-0 group-hover:opacity-100 transition-opacity"
    onClick={(e) => {
      e.stopPropagation();
      setChatToDelete(chat);
    }}
  >
    <Trash2 className="h-4 w-4 text-destructive" />
  </Button>
</button>
```

---

## Test-Checkliste

### Kontakt löschen
- [ ] Kontakt wird aus IndexedDB gelöscht
- [ ] Zugehöriger Chat wird automatisch gelöscht
- [ ] Kontakt verschwindet aus der Liste
- [ ] Bestätigungs-Dialog wird angezeigt
- [ ] "Abbrechen" bricht Löschung ab

### Chat löschen
- [ ] Chat wird aus IndexedDB gelöscht
- [ ] Alle Nachrichten werden gelöscht
- [ ] Chat verschwindet aus Sidebar
- [ ] Bei aktivem Chat: Chat-Ansicht wird geschlossen
- [ ] Bestätigungs-Dialog wird angezeigt

---

## Dateien zum Ändern

| Datei | Änderung |
|-------|----------|
| `app/src/components/custom/ContactManager.tsx` | Kontakt-Löschung hinzufügen |
| `app/src/components/custom/ChatView.tsx` | Chat-Löschung aktivieren |
| `app/src/components/custom/Sidebar.tsx` | Optional: Schnell-Löschen |

## Geschätzter Aufwand

- **Kontakt löschen:** 30-45 Minuten
- **Chat löschen:** 20-30 Minuten  
- **Sidebar Schnell-Löschen:** 15-20 Minuten (optional)
- **Testing:** 15-20 Minuten

**Gesamt:** ~1.5 - 2 Stunden

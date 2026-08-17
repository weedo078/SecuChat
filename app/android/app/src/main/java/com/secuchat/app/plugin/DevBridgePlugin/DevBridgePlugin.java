// app/android/app/src/main/java/com/secuchat/app/plugin/DevBridgePlugin/DevBridgePlugin.java
//
// TEST-ONLY — niemals in Production aktivieren.
//
// Dieser Capacitor-Plugin öffnet einen lokalen TCP-Server (127.0.0.1:8787), der
// JSON-RPC-ähnliche HTTP-Requests entgegennimmt und an JavaScript-Funktionen
// unter window.__secuchatDevBridge weiterleitet. Über `adb reverse tcp:8787
// tcp:8787` ist der Server vom Host aus erreichbar.
//
// HINWEIS: Auch wenn dieser Plugin immer im Production-Build enthalten ist,
// bleibt er ohne explizites `setEnabled(true)` aus dem JavaScript-Layer inaktiv.
// Der Aufruf erfolgt nur, wenn localStorage 'secuchat_test_mode' === '1' ist
// (siehe app/src/services/devBridge.ts). Damit ist sichergestellt, dass eine
// Production-APK niemals den Port öffnet.
//
// SICHERHEIT eval(): Wir nutzen `getBridge().eval(...)` absichtlich, weil das
// der einzige Weg ist, eine JavaScript-Funktion aus dem nativen Layer
// aufzurufen. Das ist dasselbe Pattern, das bereits in MainActivity.java:108
// (notifyContactImport) verwendet wird — nur in unserem Fall werden
// ausschließlich vordefinierte Aufrufe gegen window.__secuchatDevBridge
// ausgeführt, deren Implementierung fest in devBridge.ts verdrahtet ist.
// Der ServerSocket ist auf 127.0.0.1 gebunden (nicht über das Netz erreichbar)
// und nur aktiv, wenn explizit setEnabled(true) gerufen wurde.

package com.secuchat.app.plugin.DevBridgePlugin;

import android.util.Log;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

@CapacitorPlugin(name = "DevBridge")
public class DevBridgePlugin extends Plugin {
    private static final String TAG = "SecuChat:DevBridge";
    // Port 8787 ist auf vielen Android-Versionen von adbd für `adb reverse`
    // belegt. 8888 ist im unprivilegierten Bereich und frei.
    private static final int PORT = 8888;

    private final ExecutorService exec = Executors.newCachedThreadPool();
    private final AtomicBoolean running = new AtomicBoolean(false);
    private ServerSocket server;

    @Override
    public void load() {
        // Server wird NUR gestartet, wenn JS explizit setEnabled(true) ruft.
        // Das verhindert, dass eine Production-APK ohne test_mode jemals den
        // Port öffnet.
        Log.d(TAG, "DevBridgePlugin loaded (server inactive, awaiting setEnabled)");
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        if (enabled) {
            startServer();
        } else {
            stopServer();
        }
        call.resolve();
    }

    private void startServer() {
        // Vor jedem Start jeden alten ServerSocket sauber schließen —
        // sonst EADDRINUSE bei wiederholtem setEnabled(true) (z. B. nach
        // Page.reload, wenn die alte Instanz den Port noch hält).
        // Kurz warten, damit der alte Worker-Thread seine BindException
        // verarbeitet und `running.set(false)` ausgeführt hat, bevor wir
        // den neuen binden.
        stopServer();
        try { Thread.sleep(150); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); }
        exec.submit(() -> {
            try {
                server = new ServerSocket();
                server.setReuseAddress(true);  // wichtig: nach schnellem close() erneut binden
                server.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), PORT), 8);
                running.set(true);
                Log.i(TAG, "DevBridge listening on 127.0.0.1:" + PORT);
                acceptLoop();
            } catch (IOException e) {
                Log.e(TAG, "DevBridge start failed: " + e.getMessage(), e);
                running.set(false);
            }
        });
    }

    private void stopServer() {
        running.set(false);
        if (server != null && !server.isClosed()) {
            try {
                server.close();
            } catch (IOException ignored) {
            }
        }
        server = null;
        Log.i(TAG, "DevBridge stopped");
    }

    private void acceptLoop() {
        while (running.get() && server != null && !server.isClosed()) {
            try {
                Socket client = server.accept();
                exec.submit(() -> handleClient(client));
            } catch (SocketException e) {
                // Wird beim stopServer() geworfen — sauberes Beenden.
                if (running.get()) Log.w(TAG, "accept SocketException", e);
            } catch (IOException e) {
                if (running.get()) Log.e(TAG, "accept failed", e);
            }
        }
    }

    private void handleClient(Socket client) {
        try (Socket c = client;
             BufferedReader in = new BufferedReader(new InputStreamReader(c.getInputStream()));
             PrintWriter out = new PrintWriter(c.getOutputStream(), true)) {

            // HTTP-Request-Line lesen
            String requestLine = in.readLine();
            if (requestLine == null || requestLine.isEmpty()) return;

            // Headers parsen — Content-Length ermitteln
            int contentLength = 0;
            String header;
            while ((header = in.readLine()) != null && !header.isEmpty()) {
                String lower = header.toLowerCase();
                if (lower.startsWith("content-length:")) {
                    contentLength = Integer.parseInt(header.substring(15).trim());
                }
            }

            // Body lesen
            StringBuilder body = new StringBuilder();
            if (contentLength > 0) {
                char[] buf = new char[contentLength];
                int read = 0;
                while (read < contentLength) {
                    int n = in.read(buf, read, contentLength - read);
                    if (n < 0) break;
                    read += n;
                }
                body.append(buf, 0, read);
            }

            // Route dispatchen
            String response = dispatch(requestLine, body.toString());
            out.print("HTTP/1.1 200 OK\r\n");
            out.print("Content-Type: application/json; charset=utf-8\r\n");
            out.print("Access-Control-Allow-Origin: *\r\n");
            out.print("Content-Length: " + response.length() + "\r\n");
            out.print("Connection: close\r\n");
            out.print("\r\n");
            out.print(response);
            out.flush();
        } catch (IOException e) {
            Log.w(TAG, "client handler failed: " + e.getMessage());
        }
    }

    /**
     * Zerlegt die Request-Line ("GET /path HTTP/1.1") und routet zu evalJs().
     */
    private String dispatch(String requestLine, String body) {
        String[] parts = requestLine.split(" ");
        if (parts.length < 2) return jsonError("bad request");
        String method = parts[0];
        String path = parts[1];
        // Query-String abschneiden
        int q = path.indexOf('?');
        if (q >= 0) path = path.substring(0, q);

        try {
            switch (path) {
                case "/identity":
                    return evalJsAsync("window.__secuchatDevBridge.getIdentity()");
                case "/contacts":
                    return evalJsAsync("window.__secuchatDevBridge.getContacts()");
                case "/state":
                    return evalJsAsync("window.__secuchatDevBridge.getState()");
                case "/export-contact":
                    if (!"POST".equalsIgnoreCase(method)) return jsonError("POST required");
                    return evalJsAsync("window.__secuchatDevBridge.exportContact()");
                case "/import-contact":
                    if (!"POST".equalsIgnoreCase(method)) return jsonError("POST required");
                    return evalJsAsync(
                        "window.__secuchatDevBridge.importContact(" + jsString(body) + ")");
                case "/create-chat":
                    if (!"POST".equalsIgnoreCase(method)) return jsonError("POST required");
                    return evalJsAsync(
                        "window.__secuchatDevBridge.createChat(" + jsString(body) + ")");
                case "/send-message":
                    if (!"POST".equalsIgnoreCase(method)) return jsonError("POST required");
                    return evalJsAsync(
                        "window.__secuchatDevBridge.sendMessage(" + jsString(body) + ")");
                case "/delete-contact":
                    if (!"POST".equalsIgnoreCase(method)) return jsonError("POST required");
                    return evalJsAsync(
                        "window.__secuchatDevBridge.deleteContact(" + jsString(body) + ")");
                case "/unlock":
                    if (!"POST".equalsIgnoreCase(method)) return jsonError("POST required");
                    return evalJsAsync(
                        "window.__secuchatDevBridge.unlock(" + jsString(body) + ")");
                case "/enable-test-mode":
                    return evalJsAsync("window.__secuchatDevBridge.enableTestMode()");
                case "/trigger-auto-onboard":
                    return evalJsAsync(
                        "window.__secuchatDevBridge.triggerAutoOnboard(" + jsString(body) + ")");
                case "/debug-state":
                    return evalJsAsync("window.__secuchatDevBridge.debugState()");
                case "/eval":
                    if (!"POST".equalsIgnoreCase(method)) return jsonError("POST required");
                    // Body ist roher JS-Ausdruck. Wird via Capacitor-Bridge
                    // evaluiert; Ergebnis wird als JSON-String zurückgegeben.
                    // ACHTUNG: nur in test_mode aktiv und nur localhost-gebunden.
                    return evalJsAsync(body);
                case "/list-all-users":
                    return evalJsAsync("window.__secuchatDevBridge.listAllUsers()");
                case "/clear-all-users":
                    return evalJsAsync("window.__secuchatDevBridge.clearAllUsers()");
                case "/clear-stale-contacts":
                    return evalJsAsync("window.__secuchatDevBridge.clearStaleContacts()");
                case "/app-debug-state":
                    return evalJsAsync("window.__secuchatDevBridge.appDebugState()");
                case "/try-decrypt":
                    return evalJsAsync("window.__secuchatDevBridge.tryDecrypt()");
                case "/try-decrypt-self":
                    return evalJsAsync("window.__secuchatDevBridge.tryDecryptSelf()");
                case "/try-decrypt-realistic":
                    return evalJsAsync("window.__secuchatDevBridge.tryDecryptRealistic()");
                case "/health":
                    return "{\"ok\":true,\"running\":" + running.get() + "}";
                default:
                    return jsonError("unknown route: " + path);
            }
        } catch (Exception e) {
            return jsonError(e.getMessage());
        }
    }

    /**
     * Evaluiert einen synchronen JS-Ausdruck via Capacitor-Bridge. Da
     * Bridge.eval() in Capacitor 8 `void` zurückgibt, wickeln wir das Ergebnis
     * über einen AtomicReference-Callback. Android-WebView.evaluateJavascript
     * liefert synchronen JS den stringifizierten Return-Wert direkt im
     * ValueCallback — das genügt für unsere sync-Routen.
     * Liefert null, wenn innerhalb 1s kein Callback feuert.
     */
    private String evalJsSync(String js) {
        AtomicReference<String> result = new AtomicReference<>(null);
        getBridge().eval(js, result::set);
        for (int i = 0; i < 100; i++) {
            String v = result.get();
            if (v != null) {
                Log.d(TAG, "evalJsSync got result after " + (i+1) + " polls: " + (v.length() > 50 ? v.substring(0,50)+"..." : v));
                return v;
            }
            try { Thread.sleep(10); } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                return null;
            }
        }
        Log.w(TAG, "evalJsSync TIMEOUT for js: " + (js.length() > 80 ? js.substring(0,80)+"..." : js));
        return null;
    }

    /**
     * Evaluiert einen JS-Ausdruck, der ein Promise zurückgibt. Da
     * Bridge.eval() auch im Promise-Fall nur den synchronen Wert ("undefined")
     * an den Callback liefert, wickeln wir das Promise in einen window-Slot,
     * der dann via evalJsSync() gelesen wird.
     */
    private String evalJsAsync(String js) {
        Log.d(TAG, "evalJsAsync START for: " + (js.length() > 60 ? js.substring(0,60)+"..." : js));
        String wrapped =
            "(function(){try{var __p=(" + js + ");" +
            "if(__p&&typeof __p.then==='function'){" +
            "  __p.then(v=>{window.__secuchatDevBridgeLast=v;" +
            "             window.__secuchatDevBridgeReady=true;}," +
            "         e=>{window.__secuchatDevBridgeLast={ok:false,error:String(e)};" +
            "             window.__secuchatDevBridgeReady=true;});" +
            "}else{window.__secuchatDevBridgeLast=__p;" +
            "      window.__secuchatDevBridgeReady=true;}" +
            "}catch(e){window.__secuchatDevBridgeLast={ok:false,error:String(e)};" +
            "          window.__secuchatDevBridgeReady=true;}})();";
        // Trigger feuert (Hauptaufgabe: Promise-Wrapping in window ablegen)
        getBridge().eval(wrapped, null);
        // Dann das synchronisierte window-Ergebnis lesen
        for (int i = 0; i < 200; i++) {
            String ready = evalJsSync("JSON.stringify(!!window.__secuchatDevBridgeReady)");
            // webView.evaluateJavascript liefert JS-Boolean true als Java-String "true" (4 chars),
            // aber JS-String "true" als "\"true\"" (6 chars). Wir akzeptieren beide.
            boolean isReady = "true".equals(ready) || "\"true\"".equals(ready);
            if (isReady) {
                // evalJsSync liefert für window.__secuchatDevBridgeLast (ein JS-Objekt)
                // den JSON-stringified Wert — also genau das, was wir wollen.
                String json = evalJsSync("window.__secuchatDevBridgeLast");
                // Cleanup
                getBridge().eval(
                    "window.__secuchatDevBridgeLast=null;window.__secuchatDevBridgeReady=null;", null);
                Log.d(TAG, "evalJsAsync OK after " + (i+1) + " polls, json_len=" + (json==null?-1:json.length()));
                return json != null ? json : jsonError("result read null");
            }
            try { Thread.sleep(10); } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                break;
            }
        }
        Log.w(TAG, "evalJsAsync TIMEOUT after 200 polls");
        return jsonError("async timeout");
    }


    /** Baut einen JS-String-Literal aus einem Java-String. */
    private static String jsString(String s) {
        if (s == null) return "''";
        StringBuilder sb = new StringBuilder(s.length() + 8);
        sb.append("'");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '\\': sb.append("\\\\"); break;
                case '\'': sb.append("\\'"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                case '\b': sb.append("\\b"); break;
                case '\f': sb.append("\\f"); break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        sb.append("'");
        return sb.toString();
    }

    private static String jsonError(String msg) {
        return "{\"ok\":false,\"error\":\"" +
            (msg == null ? "unknown" : msg.replace("\\", "\\\\").replace("\"", "\\\"")) + "\"}";
    }

    @Override
    protected void handleOnDestroy() {
        stopServer();
        super.handleOnDestroy();
    }
}
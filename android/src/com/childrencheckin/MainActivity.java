package com.childrencheckin;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.util.AtomicFile;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONObject;

public class MainActivity extends Activity {
    private static final String ORIGIN = "https://children.checkin.local/";
    private static final int EXPORT = 41, IMPORT = 42, MAX_BYTES = 20000000;
    private WebView webView;
    private AtomicFile dataFile;
    private File pendingExport;
    private final Object dataLock = new Object();

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        dataFile = new AtomicFile(new File(getFilesDir(), "children-check-in.json"));
        pendingExport = new File(getCacheDir(), "pending-export.txt");
        getWindow().setStatusBarColor(Color.rgb(30,42,74));
        getWindow().setNavigationBarColor(Color.rgb(30,42,74));
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(242,244,247));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(false); // Records use an atomic file in private app storage.
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setBlockNetworkLoads(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return localResource(request.getUrl());
            }
        });
        webView.addJavascriptInterface(new LocalBridge(), "ChildrenAndroid");
        setContentView(webView);
        webView.loadUrl(ORIGIN + "index.html");
    }

    private WebResourceResponse localResource(Uri uri) {
        try {
            if (!"https".equals(uri.getScheme()) || !"children.checkin.local".equals(uri.getHost())) throw new FileNotFoundException();
            String file = uri.getPath().substring(1);
            String mime;
            switch (file) {
                case "index.html": mime = "text/html"; break;
                case "app.js": case "store.js": mime = "application/javascript"; break;
                case "style.css": mime = "text/css"; break;
                case "icon.svg": mime = "image/svg+xml"; break;
                default: throw new FileNotFoundException();
            }
            Map<String,String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-store");
            return new WebResourceResponse(mime,"UTF-8",200,"OK",headers,getAssets().open("www/"+file));
        } catch (Exception error) {
            return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",new HashMap<String,String>(),new ByteArrayInputStream(new byte[0]));
        }
    }

    private String readText(InputStream input) throws Exception {
        try (InputStream in = input; ByteArrayOutputStream buffer = new ByteArrayOutputStream()) {
            byte[] bytes = new byte[8192]; int n;
            while ((n = in.read(bytes)) != -1) {
                if (buffer.size()+n > MAX_BYTES) throw new Exception("This file is larger than 20 MB.");
                buffer.write(bytes,0,n);
            }
            return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
        }
    }
    private void writeAtomic(String json) throws Exception {
        FileOutputStream output = null;
        try {
            output = dataFile.startWrite();
            output.write(json.getBytes(StandardCharsets.UTF_8));
            dataFile.finishWrite(output);
        } catch (Exception error) { if (output != null) dataFile.failWrite(output); throw error; }
    }
    private JSONObject loadData() throws Exception {
        try { return new JSONObject(readText(dataFile.openRead())); }
        catch (FileNotFoundException missing) {
            // Only a true first install is seeded. Never replace unreadable saved data.
            if (dataFile.getBaseFile().exists() || new File(dataFile.getBaseFile().getPath()+".bak").exists()) throw missing;
            String seed = readText(getAssets().open("seed.json"));
            JSONObject parsed = new JSONObject(seed);
            writeAtomic(seed);
            return parsed;
        }
    }
    private String success(Object value) {
        try { return new JSONObject().put("ok",true).put("data",value).toString(); }
        catch (Exception error) { return failure("Could not read saved data."); }
    }
    private String failure(String message) {
        try { return new JSONObject().put("ok",false).put("error",message).toString(); }
        catch (Exception error) { return "{\"ok\":false,\"error\":\"Storage error\"}"; }
    }
    private void message(final String text) {
        runOnUiThread(() -> {
            if (webView != null) webView.evaluateJavascript("window.nativeMessage && window.nativeMessage("+JSONObject.quote(text)+")",null);
            else Toast.makeText(this,text,Toast.LENGTH_LONG).show();
        });
    }
    public class LocalBridge {
        @JavascriptInterface public String readData() {
            synchronized (dataLock) {
                try { return success(loadData()); }
                catch (Exception error) { return failure("Could not read this tablet's saved data. "+error.getMessage()); }
            }
        }
        @JavascriptInterface public String saveData(String json, int expectedRevision) {
            synchronized (dataLock) {
                try {
                    if (json.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) throw new Exception("Storage limit reached. Export a backup before continuing.");
                    JSONObject current = loadData(), next = new JSONObject(json);
                    if (current.getInt("revision") != expectedRevision || next.getInt("revision") != expectedRevision+1) throw new Exception("Records changed. Close and reopen the app before saving.");
                    if (next.getInt("version") != 2) throw new Exception("Unsupported data format.");
                    next.getJSONArray("kids"); next.getJSONArray("checkins");
                    writeAtomic(json);
                    return success(true);
                } catch (Exception error) { return failure("Changes were not saved. "+error.getMessage()); }
            }
        }
        @JavascriptInterface public void exportFile(String filename, String mime, String content) {
            try {
                byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
                if (bytes.length > MAX_BYTES) throw new Exception("Export is larger than 20 MB.");
                try (FileOutputStream out = new FileOutputStream(pendingExport)) { out.write(bytes); }
                runOnUiThread(() -> {
                    try {
                        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                        intent.addCategory(Intent.CATEGORY_OPENABLE);
                        intent.setType(mime);
                        intent.putExtra(Intent.EXTRA_TITLE, filename);
                        startActivityForResult(intent, EXPORT);
                    } catch (Exception error) { message("Could not open Save File: "+error.getMessage()); }
                });
            } catch (Exception error) { message("Could not export: "+error.getMessage()); }
        }
        @JavascriptInterface public void openBackup() {
            runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    startActivityForResult(intent, IMPORT);
                } catch (Exception error) { message("Could not open file picker: "+error.getMessage()); }
            });
        }
        @JavascriptInterface public void printReport(String html) { runOnUiThread(() -> startPrint(html)); }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request,result,data);
        if (result != RESULT_OK || data == null || data.getData() == null) {
            if (request == EXPORT) pendingExport.delete();
            return;
        }
        final Uri uri = data.getData();
        new Thread(() -> {
            try {
                if (request == EXPORT) {
                    try (InputStream in = new java.io.FileInputStream(pendingExport); OutputStream out = getContentResolver().openOutputStream(uri,"wt")) {
                        if (out == null) throw new Exception("Could not open destination.");
                        byte[] bytes = new byte[8192]; int n;
                        while ((n = in.read(bytes)) != -1) out.write(bytes,0,n);
                        out.flush();
                    }
                    pendingExport.delete(); message("File saved.");
                } else if (request == IMPORT) {
                    String raw = readText(getContentResolver().openInputStream(uri));
                    runOnUiThread(() -> webView.evaluateJavascript("window.receiveBackup("+JSONObject.quote(raw)+")",null));
                }
            } catch (Exception error) { message("Could not read or save the file: "+error.getMessage()); }
        }).start();
    }
    private void startPrint(String html) {
        final WebView report = new WebView(this);
        report.getSettings().setJavaScriptEnabled(false);
        report.getSettings().setBlockNetworkLoads(true);
        report.getSettings().setAllowFileAccess(false);
        report.getSettings().setAllowContentAccess(false);
        report.setWebViewClient(new WebViewClient() {
            private boolean printed = false;
            @Override public void onPageFinished(WebView view, String url) {
                if (printed) return; printed = true;
                try {
                    PrintManager manager = (PrintManager)getSystemService(PRINT_SERVICE);
                    if (manager == null) throw new Exception("Printing is unavailable on this device.");
                    final PrintDocumentAdapter delegate = report.createPrintDocumentAdapter("Children Check In attendance");
                    PrintDocumentAdapter adapter = new PrintDocumentAdapter() {
                        @Override public void onStart() { delegate.onStart(); }
                        @Override public void onLayout(PrintAttributes oldAttrs, PrintAttributes newAttrs, CancellationSignal cancellation, LayoutResultCallback callback, Bundle extras) { delegate.onLayout(oldAttrs,newAttrs,cancellation,callback,extras); }
                        @Override public void onWrite(PageRange[] pages, ParcelFileDescriptor output, CancellationSignal cancellation, WriteResultCallback callback) { delegate.onWrite(pages,output,cancellation,callback); }
                        @Override public void onFinish() { delegate.onFinish(); report.post(report::destroy); }
                    };
                    manager.print("Children Check In attendance",adapter,new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4.asLandscape()).build());
                } catch (Exception error) { message("Could not print: "+error.getMessage()); report.destroy(); }
            }
        });
        report.loadDataWithBaseURL(ORIGIN,html,"text/html","UTF-8",null);
    }
    @Override public void onBackPressed() {
        webView.evaluateJavascript("window.handleBack ? window.handleBack() : false",result -> { if (!"true".equals(result)) moveTaskToBack(true); });
    }
    @Override protected void onDestroy() {
        if (webView != null) { webView.removeJavascriptInterface("ChildrenAndroid"); webView.destroy(); webView = null; }
        super.onDestroy();
    }
}

package com.eranthawelikala.cricketlk;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/**
 * The few things Android's WebView doesn't do by itself, called from mobile/web/native-bridge.js:
 * the share sheet (navigator.share), saving an image (an &lt;a download&gt;) and printing
 * (window.print, i.e. Export PDF). No permissions needed for any of them.
 */
@CapacitorPlugin(name = "CricketNative")
public class CricketNativePlugin extends Plugin {

    /** Text and/or one image (base64 "data") through the Android share sheet. */
    @PluginMethod
    public void share(PluginCall call) {
        String text = call.getString("text", "");
        String title = call.getString("title", "");
        String data = call.getString("data");
        Intent send = new Intent(Intent.ACTION_SEND);
        if (!text.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, text);
        if (!title.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, title);
        if (data != null) {
            try {
                File dir = new File(getContext().getCacheDir(), "shared");
                // Only the latest share image is kept (res/xml/file_paths.xml exposes just this folder).
                File[] old = dir.listFiles();
                if (old != null) for (File f : old) f.delete();
                if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("can't create " + dir);
                File file = new File(dir, safeFileName(call.getString("fileName", "image.png")));
                try (FileOutputStream out = new FileOutputStream(file)) {
                    out.write(Base64.decode(data, Base64.DEFAULT));
                }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
                send.setType(call.getString("mimeType", "image/png"));
                send.putExtra(Intent.EXTRA_STREAM, uri);
                send.setClipData(ClipData.newRawUri(null, uri)); // lets the share sheet show a preview
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (IOException | IllegalArgumentException e) {
                call.reject("Couldn't prepare the image: " + e.getMessage());
                return;
            }
        } else {
            send.setType("text/plain");
        }
        Intent chooser = Intent.createChooser(send, null);
        getActivity().runOnUiThread(() -> {
            getActivity().startActivity(chooser);
            call.resolve();
        });
    }

    /** An image (base64 "data") into Pictures/Cricket.lk, where the Gallery shows it. */
    @PluginMethod
    public void saveImage(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("No image to save");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            // Before Android 10, writing to shared storage needs a storage permission this app doesn't
            // ask for. The share sheet saves it instead (Drive, Files, Gallery apps...).
            share(call);
            return;
        }
        String name = safeFileName(call.getString("fileName", "image.png"));
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, name);
        values.put(MediaStore.Images.Media.MIME_TYPE, call.getString("mimeType", "image/png"));
        values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Cricket.lk");
        values.put(MediaStore.Images.Media.IS_PENDING, 1);
        Uri uri = resolver.insert(MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values);
        if (uri == null) {
            call.reject("Couldn't save the image");
            return;
        }
        try (OutputStream out = resolver.openOutputStream(uri)) {
            if (out == null) throw new IOException("no output stream");
            out.write(Base64.decode(data, Base64.DEFAULT));
        } catch (IOException | IllegalArgumentException e) {
            resolver.delete(uri, null, null);
            call.reject("Couldn't save the image: " + e.getMessage());
            return;
        }
        values.clear();
        values.put(MediaStore.Images.Media.IS_PENDING, 0);
        resolver.update(uri, values, null, null);
        getActivity().runOnUiThread(() -> Toast.makeText(getContext(), "Saved to Pictures/Cricket.lk", Toast.LENGTH_SHORT).show());
        call.resolve();
    }

    /** The page as it is now, with its print styles, in Android's print dialog (it has "Save as PDF"). */
    @PluginMethod
    public void print(PluginCall call) {
        String name = call.getString("name", "Cricket.lk");
        getActivity().runOnUiThread(() -> {
            PrintManager printManager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
            PrintDocumentAdapter adapter = getBridge().getWebView().createPrintDocumentAdapter(name);
            printManager.print(name, adapter, new PrintAttributes.Builder().build());
            call.resolve();
        });
    }

    private static String safeFileName(String name) {
        String clean = name == null ? "" : name.replaceAll("[^A-Za-z0-9._ -]", "_").trim();
        if (clean.length() > 80) clean = clean.substring(clean.length() - 80);
        return clean.isEmpty() ? "image.png" : clean;
    }
}

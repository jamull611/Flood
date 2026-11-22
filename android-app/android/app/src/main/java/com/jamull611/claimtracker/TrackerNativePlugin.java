package com.jamull611.claimtracker;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * What the tracker page can ask the phone to do when it runs inside the Android app:
 * send a text, start/stop an "On my way" trip, open Google Maps navigation, and collect
 * texts the app sent on its own so they get logged on the claim.
 */
@CapacitorPlugin(
    name = "TrackerNative",
    permissions = {
        @Permission(alias = "sms", strings = { Manifest.permission.SEND_SMS }),
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
        @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" })
    }
)
public class TrackerNativePlugin extends Plugin {

    @PluginMethod
    public void info(PluginCall call) {
        JSObject r = new JSObject();
        try { r.put("version", getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0).versionName); }
        catch (Exception e) { r.put("version", "?"); }
        r.put("sms", getPermissionState("sms") == PermissionState.GRANTED);
        r.put("location", getPermissionState("location") == PermissionState.GRANTED);
        call.resolve(r);
    }

    // ---------- texting ----------
    @PluginMethod
    public void sendSms(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) { requestPermissionForAlias("sms", call, "afterSmsPermission"); return; }
        doSend(call);
    }

    @PermissionCallback
    private void afterSmsPermission(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) { call.reject("Texting permission was not allowed", "denied"); return; }
        doSend(call);
    }

    private void doSend(PluginCall call) {
        String to = call.getString("to", ""), body = call.getString("body", "");
        try {
            Sms.send(getContext(), to, body);
            JSObject r = new JSObject(); r.put("ok", true); call.resolve(r);
        } catch (Exception e) { call.reject(e.getMessage(), "failed"); }
    }

    // ---------- On my way trips ----------
    // Asks for location, then texting, then notifications (Android 13+), one after another.
    @PluginMethod
    public void startTrip(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) { requestPermissionForAlias("location", call, "tripPermissions"); return; }
        if (getPermissionState("sms") != PermissionState.GRANTED) { requestPermissionForAlias("sms", call, "tripPermissions"); return; }
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED && !call.getBoolean("askedNotifications", false)) {
            call.getData().put("askedNotifications", true);
            requestPermissionForAlias("notifications", call, "tripPermissions");
            return;
        }
        beginTrip(call);
    }

    @PermissionCallback
    private void tripPermissions(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) { call.reject("Location permission was not allowed", "location"); return; }
        if (getPermissionState("sms") != PermissionState.GRANTED) { call.reject("Texting permission was not allowed", "sms"); return; }
        startTrip(call);
    }

    private void beginTrip(PluginCall call) {
        Double lat = call.getDouble("lat"), lng = call.getDouble("lng");
        String phone = call.getString("phone", ""), message = call.getString("message", "");
        if (lat == null || lng == null) { call.reject("The claim has no map location", "input"); return; }
        if (phone.isEmpty() || message.isEmpty()) { call.reject("A phone number and message are needed", "input"); return; }
        TripService.prefs(getContext()).edit()
            .clear()
            .putBoolean("active", true)
            .putString("claimId", call.getString("claimId", ""))
            .putString("insured", call.getString("insured", ""))
            .putString("phone", phone)
            .putString("message", message)
            .putLong("lat", Double.doubleToRawLongBits(lat))
            .putLong("lng", Double.doubleToRawLongBits(lng))
            .putInt("leadMin", call.getInt("leadMin", 20))
            .putInt("delaySec", call.getInt("delaySec", 10))
            .putLong("startedAt", System.currentTimeMillis())
            .apply();
        Intent i = new Intent(getContext(), TripService.class).setAction(TripService.ACTION_START);
        ContextCompat.startForegroundService(getContext(), i);
        call.resolve(tripState());
    }

    @PluginMethod
    public void stopTrip(PluginCall call) {
        if (TripService.prefs(getContext()).getBoolean("active", false)) {
            Intent i = new Intent(getContext(), TripService.class).setAction(TripService.ACTION_CANCEL);
            getContext().startService(i);
        }
        call.resolve();
    }

    @PluginMethod
    public void getTrip(PluginCall call) { call.resolve(tripState()); }

    private JSObject tripState() {
        SharedPreferences p = TripService.prefs(getContext());
        JSObject r = new JSObject();
        r.put("active", p.getBoolean("active", false));
        r.put("claimId", p.getString("claimId", ""));
        r.put("insured", p.getString("insured", ""));
        r.put("lastMin", p.getInt("lastMin", 0));
        r.put("leadMin", p.getInt("leadMin", 20));
        return r;
    }

    // Texts the app sent on its own; returned once, so the tracker logs each one a single time.
    @PluginMethod
    public void takeSentTexts(PluginCall call) {
        JSONArray a = TripService.Sent.take(getContext());
        JSObject r = new JSObject();
        try { r.put("texts", new JSArray(a.toString())); } catch (Exception e) { r.put("texts", new JSArray()); }
        call.resolve(r);
    }

    // ---------- navigation and settings ----------
    @PluginMethod
    public void openNavigation(PluginCall call) {
        Double lat = call.getDouble("lat"), lng = call.getDouble("lng");
        String address = call.getString("address", "");
        String q = lat != null && lng != null ? lat + "," + lng : Uri.encode(address);
        Intent nav = new Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=" + q)).setPackage("com.google.android.apps.maps").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { getContext().startActivity(nav); call.resolve(); return; } catch (ActivityNotFoundException ignored) { }
        Intent any = new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=" + Uri.encode(address.isEmpty() ? q : address))).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { getContext().startActivity(any); call.resolve(); } catch (ActivityNotFoundException e) { call.reject("No maps app found", "maps"); }
    }

    // Saves a file the tracker made (photo zip, photo report PDF) to Downloads/Claim Tracker.
    @PluginMethod
    public void saveFile(PluginCall call) {
        String name = call.getString("name", "file").replaceAll("[\\\\/:*?\"<>|]", " ").trim();
        String mime = call.getString("mime", "application/octet-stream");
        String data = call.getString("data", "");
        getBridge().execute(() -> {
            try {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                String where;
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    v.put(MediaStore.Downloads.MIME_TYPE, mime);
                    v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Claim Tracker");
                    Uri uri = getContext().getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) throw new Exception("Couldn't create the file");
                    try (OutputStream out = getContext().getContentResolver().openOutputStream(uri)) { out.write(bytes); }
                    where = "Downloads/Claim Tracker";
                } else {
                    File dir = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "Claim Tracker");
                    if (!dir.exists() && !dir.mkdirs()) throw new Exception("Couldn't create the folder");
                    try (FileOutputStream out = new FileOutputStream(new File(dir, name))) { out.write(bytes); }
                    where = dir.getAbsolutePath();
                }
                JSObject r = new JSObject(); r.put("where", where + "/" + name);
                call.resolve(r);
            } catch (Exception e) { call.reject(e.getMessage(), "save"); }
        });
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }
}

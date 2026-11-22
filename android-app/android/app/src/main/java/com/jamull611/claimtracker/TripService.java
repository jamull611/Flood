package com.jamull611.claimtracker;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Runs while you drive to an inspection ("On my way"). Watches your position, checks the drive time
 * about once a minute, and when you're within the lead time (20 minutes) texts the insured from your
 * phone, after a short countdown you can cancel from the notification.
 */
public class TripService extends Service {
    static final String PREFS = "trip";
    static final String ACTION_START = "start", ACTION_CANCEL = "cancel", ACTION_SEND_NOW = "send_now";
    private static final String CH_TRIP = "trip", CH_ALERT = "trip_alerts";
    private static final int NOTIF_TRIP = 2001, NOTIF_DONE = 2002;
    private static final long CHECK_EVERY_MS = 60_000, MAX_TRIP_MS = 4 * 3600_000L;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService net = Executors.newSingleThreadExecutor();
    private LocationManager lm;
    private Location last;
    private long lastCheck = 0;
    private boolean counting = false, checking = false;
    private int countdown = 0;

    private final LocationListener listener = new LocationListener() {
        @Override public void onLocationChanged(Location loc) { last = loc; maybeCheck(false); }
        @Override public void onProviderEnabled(String p) { }
        @Override public void onProviderDisabled(String p) { }
        @Override public void onStatusChanged(String p, int s, Bundle b) { }
    };

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, MODE_PRIVATE); }

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null && intent.getAction() != null ? intent.getAction() : ACTION_START;
        channels();
        if (ACTION_CANCEL.equals(action)) {
            String who = prefs(this).getString("insured", "");
            clearTrip(this);
            notifyDone("Trip cancelled", "No text will be sent" + (who.isEmpty() ? "." : " to " + who + "."));
            stop();
            return START_NOT_STICKY;
        }
        if (!prefs(this).getBoolean("active", false)) { stop(); return START_NOT_STICKY; }
        startInForeground("Getting your location…");
        if (ACTION_SEND_NOW.equals(action)) { sendNow(null); return START_NOT_STICKY; }
        startLocation();
        main.postDelayed(ticker, 5_000);
        return START_STICKY;
    }

    // ---------- location ----------
    private void startLocation() {
        lm = (LocationManager) getSystemService(LOCATION_SERVICE);
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
                && ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            update("Location is off for Claim Tracker, so the trip can't be tracked.");
            return;
        }
        try {
            for (String p : new String[]{LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER}) {
                if (lm.isProviderEnabled(p)) {
                    lm.requestLocationUpdates(p, 20_000, 50, listener, Looper.getMainLooper());
                    Location l = lm.getLastKnownLocation(p);
                    if (l != null && (last == null || l.getTime() > last.getTime())) last = l;
                }
            }
        } catch (SecurityException e) {
            update("Location is off for Claim Tracker, so the trip can't be tracked.");
        }
        if (last != null) maybeCheck(true);
    }

    private final Runnable ticker = new Runnable() {
        @Override public void run() {
            SharedPreferences p = prefs(TripService.this);
            if (!p.getBoolean("active", false)) { stop(); return; }
            if (System.currentTimeMillis() - p.getLong("startedAt", 0) > MAX_TRIP_MS) {
                clearTrip(TripService.this);
                notifyDone("Trip ended", "On my way stopped after 4 hours without arriving. No text was sent.");
                stop();
                return;
            }
            maybeCheck(false);
            main.postDelayed(this, 30_000);
        }
    };

    private void maybeCheck(boolean force) {
        if (counting || checking || last == null) return;
        if (!force && System.currentTimeMillis() - lastCheck < CHECK_EVERY_MS) return;
        lastCheck = System.currentTimeMillis();
        checking = true;
        final double fromLat = last.getLatitude(), fromLng = last.getLongitude();
        final SharedPreferences p = prefs(this);
        final double toLat = Double.longBitsToDouble(p.getLong("lat", 0)), toLng = Double.longBitsToDouble(p.getLong("lng", 0));
        net.execute(() -> {
            double min = driveMinutes(fromLat, fromLng, toLat, toLng);
            main.post(() -> { checking = false; onEta(min); });
        });
    }

    private void onEta(double min) {
        SharedPreferences p = prefs(this);
        if (!p.getBoolean("active", false) || counting) return;
        int lead = p.getInt("leadMin", 20);
        int m = (int) Math.max(1, Math.round(min));
        p.edit().putInt("lastMin", m).putLong("lastCheck", System.currentTimeMillis()).apply();
        if (m <= lead) startCountdown(m);
        else update("About " + m + " min away. Texting " + p.getString("insured", "them") + " at " + lead + " min out.");
    }

    // Road drive time from the public routing service, plus 10%; straight-line estimate if it's unreachable.
    static double driveMinutes(double fLat, double fLng, double tLat, double tLng) {
        try {
            URL u = new URL(String.format(Locale.US, "https://router.project-osrm.org/route/v1/driving/%.6f,%.6f;%.6f,%.6f?overview=false", fLng, fLat, tLng, tLat));
            HttpURLConnection c = (HttpURLConnection) u.openConnection();
            c.setConnectTimeout(10_000); c.setReadTimeout(10_000);
            c.setRequestProperty("User-Agent", "ClaimTracker-Android");
            try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream()))) {
                StringBuilder sb = new StringBuilder(); String line;
                while ((line = r.readLine()) != null) sb.append(line);
                JSONObject j = new JSONObject(sb.toString());
                if ("Ok".equals(j.optString("code"))) return j.getJSONArray("routes").getJSONObject(0).getDouble("duration") / 60.0 * 1.1;
            }
        } catch (Exception ignored) { }
        float[] d = new float[1];
        Location.distanceBetween(fLat, fLng, tLat, tLng, d);
        return d[0] / 1000.0 * 1.3 / 72.0 * 60.0;
    }

    // ---------- countdown and sending ----------
    private void startCountdown(int minutes) {
        counting = true;
        countdown = prefs(this).getInt("delaySec", 10);
        prefs(this).edit().putInt("sendMin", minutes).apply();
        main.post(countdownTick);
    }

    private final Runnable countdownTick = new Runnable() {
        @Override public void run() {
            SharedPreferences p = prefs(TripService.this);
            if (!p.getBoolean("active", false)) { stop(); return; }
            if (countdown <= 0) { sendNow(p.getInt("sendMin", p.getInt("leadMin", 20))); return; }
            NotificationManager nm = getSystemService(NotificationManager.class);
            nm.notify(NOTIF_TRIP, tripNotification("Texting " + p.getString("insured", "") + " in " + countdown + " s",
                    "\"" + message(p, p.getInt("sendMin", 20)) + "\"", true));
            countdown--;
            main.postDelayed(this, 1_000);
        }
    };

    private void sendNow(Integer minutes) {
        SharedPreferences p = prefs(this);
        if (!p.getBoolean("active", false)) { stop(); return; }
        int m = minutes != null ? minutes : p.getInt("lastMin", p.getInt("leadMin", 20));
        if (m < 1) m = p.getInt("leadMin", 20);
        String body = message(p, m), to = p.getString("phone", ""), who = p.getString("insured", "");
        try {
            Sms.send(this, to, body);
            Sent.record(this, p.getString("claimId", ""), to, body, true, null);
            notifyDone("✓ Texted " + who, body);
        } catch (Exception e) {
            Sent.record(this, p.getString("claimId", ""), to, body, false, e.getMessage());
            notifyDone("Couldn't text " + who, "Open Claim Tracker to send it yourself. (" + e.getMessage() + ")");
        }
        clearTrip(this);
        stop();
    }

    static String message(SharedPreferences p, int minutes) {
        return p.getString("message", "").replace("{minutes}", String.valueOf(minutes));
    }

    static void clearTrip(Context c) { prefs(c).edit().clear().apply(); }

    // ---------- notifications ----------
    private void channels() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(CH_TRIP, "On my way trips", NotificationManager.IMPORTANCE_LOW));
            NotificationChannel a = new NotificationChannel(CH_ALERT, "On my way texts", NotificationManager.IMPORTANCE_HIGH);
            a.enableVibration(true);
            nm.createNotificationChannel(a);
        }
    }

    private PendingIntent action(String a, int code) {
        Intent i = new Intent(this, TripService.class).setAction(a);
        return PendingIntent.getService(this, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private PendingIntent openApp() {
        Intent i = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 3, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification tripNotification(String title, String text, boolean urgent) {
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, urgent ? CH_ALERT : CH_TRIP)
                .setSmallIcon(R.drawable.ic_stat_trip)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setOngoing(true)
                .setOnlyAlertOnce(!urgent || countdown < prefs(this).getInt("delaySec", 10))
                .setContentIntent(openApp())
                .addAction(0, "Cancel text", action(ACTION_CANCEL, 1));
        if (urgent) b.addAction(0, "Send now", action(ACTION_SEND_NOW, 2)).setPriority(NotificationCompat.PRIORITY_HIGH);
        return b.build();
    }

    private void startInForeground(String text) {
        SharedPreferences p = prefs(this);
        Notification n = tripNotification("On my way to " + p.getString("insured", "inspection"), text, false);
        int type = Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION : 0;
        ServiceCompat.startForeground(this, NOTIF_TRIP, n, type);
    }

    private void update(String text) {
        if (counting) return;
        SharedPreferences p = prefs(this);
        getSystemService(NotificationManager.class).notify(NOTIF_TRIP, tripNotification("On my way to " + p.getString("insured", "inspection"), text, false));
    }

    private void notifyDone(String title, String text) {
        Notification n = new NotificationCompat.Builder(this, CH_ALERT)
                .setSmallIcon(R.drawable.ic_stat_trip)
                .setContentTitle(title).setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setAutoCancel(true).setContentIntent(openApp())
                .build();
        getSystemService(NotificationManager.class).notify(NOTIF_DONE, n);
    }

    private void stop() {
        main.removeCallbacksAndMessages(null);
        if (lm != null) try { lm.removeUpdates(listener); } catch (Exception ignored) { }
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override public void onDestroy() {
        main.removeCallbacksAndMessages(null);
        if (lm != null) try { lm.removeUpdates(listener); } catch (Exception ignored) { }
        net.shutdownNow();
        super.onDestroy();
    }

    /** Texts sent by the app, kept until the tracker logs them on the claim. */
    static class Sent {
        static synchronized void record(Context c, String claimId, String to, String body, boolean ok, String error) {
            SharedPreferences p = c.getSharedPreferences("sent", MODE_PRIVATE);
            try {
                JSONArray a = new JSONArray(p.getString("list", "[]"));
                JSONObject o = new JSONObject();
                o.put("claimId", claimId); o.put("to", to); o.put("body", body); o.put("ok", ok);
                o.put("at", System.currentTimeMillis()); if (error != null) o.put("error", error);
                a.put(o);
                p.edit().putString("list", a.toString()).apply();
            } catch (Exception ignored) { }
        }
        static synchronized JSONArray take(Context c) {
            SharedPreferences p = c.getSharedPreferences("sent", MODE_PRIVATE);
            JSONArray a;
            try { a = new JSONArray(p.getString("list", "[]")); } catch (Exception e) { a = new JSONArray(); }
            p.edit().remove("list").apply();
            return a;
        }
    }
}

package com.jamull611.claimtracker;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.telephony.SmsManager;

import androidx.core.content.ContextCompat;

import java.util.ArrayList;

/** Sends a text from this phone's own number. */
final class Sms {
    private Sms() { }

    static String digits(String phone) {
        String d = phone == null ? "" : phone.replaceAll("[^0-9+]", "");
        String n = d.replace("+", "");
        if (n.length() == 10) return "+1" + n;
        if (n.length() == 11 && n.startsWith("1")) return "+" + n;
        return d;
    }

    static void send(Context c, String to, String body) throws Exception {
        if (ContextCompat.checkSelfPermission(c, Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED)
            throw new Exception("Texting permission is off for Claim Tracker");
        String num = digits(to);
        if (num.replace("+", "").length() < 10) throw new Exception("No valid phone number");
        if (body == null || body.trim().isEmpty()) throw new Exception("The message is empty");
        SmsManager sms = Build.VERSION.SDK_INT >= 31 ? c.getSystemService(SmsManager.class) : SmsManager.getDefault();
        if (sms == null) throw new Exception("This phone can't send texts");
        ArrayList<String> parts = sms.divideMessage(body);
        if (parts.size() > 1) sms.sendMultipartTextMessage(num, null, parts, null, null);
        else sms.sendTextMessage(num, null, body, null, null);
    }
}

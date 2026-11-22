package com.jamull611.claimtracker;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TrackerNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}

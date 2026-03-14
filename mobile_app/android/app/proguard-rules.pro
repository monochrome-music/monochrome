# Capacitor
-keep class com.getcapacitor.** { *; }
-keep class tf.monochrome.app.** { *; }

# Keep JavaScript interface methods
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# WebView
-keepattributes JavascriptInterface
-keepattributes *Annotation*

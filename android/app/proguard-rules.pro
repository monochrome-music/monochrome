# Keep JavascriptInterface methods
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep MediaSession classes
-keep class androidx.media.** { *; }
-keep class android.support.v4.media.** { *; }

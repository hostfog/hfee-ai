# HFee AI for Android and iOS

By HostFog Ltd.

The apps open your HFee AI site in a full-screen app with its own icon,
microphone and camera access. They need your site to be online first.

The quickest option needs no app store: open your site on the phone and
choose **Install app** (Android, Chrome) or **Share → Add to Home Screen**
(iPhone, Safari).

## Android

Needs Node 22, JDK 21 and the Android SDK (Android Studio installs it).

```bash
cd mobile
npm ci
HFEE_URL=https://chat.example.com npm run android
cd android && ./gradlew assembleDebug    # app/build/outputs/apk/debug/app-debug.apk
```

Tagged releases build the APK automatically when the repository variable
`HFEE_URL` is set. To sign it for Google Play, add the secrets
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_ALIAS`.

## iOS

Needs a Mac with Xcode and an Apple Developer account.

```bash
cd mobile
npm ci
HFEE_URL=https://chat.example.com npm run ios
npx cap open ios                          # then Product → Archive in Xcode
```

Apple can reject apps that only show a website (App Store guideline 4.2).
If that happens, the Add to Home Screen option above gives the same app
without the App Store.

// Creates or updates the native project for one platform: adds it if
// missing, generates icons and splash screens, asks for the microphone and
// camera (voice input, photos) and copies the config in.
//
//   HFEE_URL=https://chat.example.com node scripts/prepare.js android
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const platform = process.argv[2];
if (!['android', 'ios'].includes(platform)) {
  console.error('usage: node scripts/prepare.js android|ios');
  process.exit(1);
}

const npx = (...args) => execFileSync('npx', args, { stdio: 'inherit', shell: process.platform === 'win32' });

if (!existsSync(platform)) npx('cap', 'add', platform);
npx('capacitor-assets', 'generate', `--${platform}`, '--iconBackgroundColor', '#d87858', '--splashBackgroundColor', '#ffffff');

// Adds `text` before `marker` in `file` unless `check` is already there.
function patch(file, check, marker, text) {
  const src = readFileSync(file, 'utf8');
  if (src.includes(check)) return;
  if (!src.includes(marker)) throw new Error(`${file}: can't find ${marker}`);
  writeFileSync(file, src.replace(marker, text + marker));
}

if (platform === 'android') {
  const manifest = 'android/app/src/main/AndroidManifest.xml';
  for (const p of ['RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS', 'CAMERA']) {
    patch(manifest, `android.permission.${p}"`, '</manifest>', `    <uses-permission android:name="android.permission.${p}" />\n`);
  }
} else {
  const plist = 'ios/App/App/Info.plist';
  patch(plist, 'NSMicrophoneUsageDescription', '</dict>\n</plist>',
    '\t<key>NSMicrophoneUsageDescription</key>\n\t<string>Speak your messages instead of typing.</string>\n');
  patch(plist, 'NSCameraUsageDescription', '</dict>\n</plist>',
    '\t<key>NSCameraUsageDescription</key>\n\t<string>Take a photo to ask HFee about it.</string>\n');
  patch(plist, 'NSPhotoLibraryUsageDescription', '</dict>\n</plist>',
    '\t<key>NSPhotoLibraryUsageDescription</key>\n\t<string>Attach pictures to your messages.</string>\n');
}

npx('cap', 'sync', platform);

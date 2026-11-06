import type { CapacitorConfig } from '@capacitor/cli';

// The app opens your HFee AI site, so it needs its address:
//   HFEE_URL=https://chat.example.com npm run android
const url = process.env.HFEE_URL;
if (!url) {
  throw new Error('Set HFEE_URL to your HFee AI address, e.g. HFEE_URL=https://chat.example.com');
}

const config: CapacitorConfig = {
  appId: 'com.hostfog.hfeeai',
  appName: 'HFee AI',
  webDir: 'www',
  backgroundColor: '#ffffff',
  server: {
    url,
    errorPath: 'index.html', // shown when the site can't be reached
    cleartext: url.startsWith('http://'),
  },
};

export default config;

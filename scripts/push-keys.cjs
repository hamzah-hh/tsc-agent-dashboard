// Makes the key pair web push needs. Run once on your own computer: npm run push:keys
// Put the two values in Vercel (Settings > Environment Variables) as VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY,
// then redeploy. Keep the private key out of the code, chat and email.
const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();
console.log('');
console.log('VAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);
console.log('');

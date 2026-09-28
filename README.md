# UA Deck Analyzer — Firebase login

This version adds email/password login and cloud-saved private decks using Firebase Authentication + Cloud Firestore.

Setup:
1. Create a Firebase project.
2. Add a Web app and copy its config.
3. Copy `firebase-config.example.js` to `firebase-config.js` and paste the config.
4. Firebase Console → Authentication → Sign-in method → enable Email/Password.
5. Firebase Console → Firestore Database → create database.
6. Set Firestore rules from `firestore.rules`.
7. Authentication → Settings → Authorized domains → add `yhgimochii.github.io`.
8. Upload all files to GitHub Pages.

Each user's decks live under `users/{uid}/decks`, and the rules only permit that signed-in user to read/write that path.

The Firebase web config is okay to include in the browser; do not expose service-account private keys.

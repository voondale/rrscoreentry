
# One‑Set League Tracker (v5 – Firestore)

This build stores **all data in Firestore** so everyone sees the same results on your GitHub Pages site.

## Firebase Setup (once)
1. Create a Firebase project and Firestore database.
2. Add a Web App and copy the config (already embedded in `index.html`).
3. Enable **Anonymous Auth** (Authentication → Sign‑in method → Anonymous → Enable).
4. Firestore rules (basic):
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read: if true;
      // Require a signed-in user (anonymous is fine)
      allow write: if request.auth != null;
    }
  }
}
```
> For stronger protection, enable **App Check** and/or restrict writes via custom logic.

## Collections used
- `matches/{matchId}`: `{ round, team1, team2 }`
- `results/{matchId}`: `{ set: {team1, team2}, winnerTeam, updatedAt }`

## Admin Actions
- **Upload Schedule to Firestore**: Overwrites `matches` and clears `results`.
- **Delete All Results**: Clears the `results` collection.

## Local Development
Serve via a local HTTP server to avoid CORS for local files:
```bash
python3 -m http.server 8080
```
Then open `http://localhost:8080/score-tracker-one-set-v5/`.
